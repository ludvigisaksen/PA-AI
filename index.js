// index.js
import 'dotenv/config';
import http from 'http';
import {
  Client,
  GatewayIntentBits,
  Partials
} from 'discord.js';

import { runSummarizerWorkflow } from './services/openai.js';
import { createTasksInCatalyst } from './services/catalyst.js';
import { parseKeepDrop } from './services/parseKeepDrop.js';
import { extractLastLogBlock } from './services/extractLastLogBlock.js';

const {
  DISCORD_TOKEN,
  DISCORD_INPUT_CHANNEL_ID,
  DISCORD_INBOX_CHANNEL_ID,
  DISCORD_LOG_CHANNEL_ID,
  LUDVIG_USER_ID
} = process.env;

// ---- Soft env validation (no hard throws so Cloud Run can start) ----

function envMissing(name) {
  console.error(`[config] Missing required env var: ${name}`);
  return false;
}

const DISCORD_CONFIG_OK =
  !!DISCORD_TOKEN ||
  !envMissing('DISCORD_TOKEN');

const INPUT_OK =
  !!DISCORD_INPUT_CHANNEL_ID ||
  !envMissing('DISCORD_INPUT_CHANNEL_ID');

const INBOX_OK =
  !!DISCORD_INBOX_CHANNEL_ID ||
  !envMissing('DISCORD_INBOX_CHANNEL_ID');

const LUDVIG_OK =
  !!LUDVIG_USER_ID ||
  !envMissing('LUDVIG_USER_ID');

const CAN_START_DISCORD =
  DISCORD_CONFIG_OK && INPUT_OK && INBOX_OK && LUDVIG_OK;

// In-memory last task batch (simple v1)
let lastTaskBatch = {
  tasks: [],
  sourceRef: null,
  meta: null
};

// ---------- Discord client ----------

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

client.once('ready', () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on('error', (err) => {
  console.error('Discord client error:', err);
});

// Helper: safe log to #agent-log
async function logToAgentLog(text) {
  try {
    if (!DISCORD_LOG_CHANNEL_ID) return;
    const ch = await client.channels.fetch(DISCORD_LOG_CHANNEL_ID);
    if (!ch || !ch.isTextBased()) return;
    await ch.send(`⚠️ ${text}`);
  } catch (err) {
    console.error('Failed to log to #agent-log:', err);
  }
}

// Core trigger detection in #agent-input
function isSummarizeTrigger(msg) {
  if (!msg || !msg.content) return false;
  const c = msg.content.toLowerCase();
  return (
    c.includes('summarize this') ||
    c.includes('process this') ||
    c.includes('please process') ||
    c.includes('lav en opsummering') // dk flavour if you ever use it
  );
}

// Discord message handler
client.on('messageCreate', async (message) => {
  try {
    // Ignore bot messages
    if (message.author.bot) return;

    const channelId = message.channel.id;

    // 1) #agent-input: paste logs + trigger
    if (channelId === DISCORD_INPUT_CHANNEL_ID && message.author.id === LUDVIG_USER_ID) {
      if (isSummarizeTrigger(message)) {
        await handleSummarizeTrigger(message);
      }
      return;
    }

    // 2) #ludvig-inbox: keep/drop confirmation
    if (channelId === DISCORD_INBOX_CHANNEL_ID && message.author.id === LUDVIG_USER_ID) {
      await handleKeepDrop(message);
      return;
    }
  } catch (err) {
    console.error('Error in messageCreate handler:', err);
    await logToAgentLog(`messageCreate error: ${err.message}`);
  }
});

// ---------- Handlers ----------

async function handleSummarizeTrigger(triggerMessage) {
  const channel = triggerMessage.channel;

  try {
    await channel.send('Processing logs…');

    // 1) Extract last log block from Ludvig before this trigger
    const rawLogs = await extractLastLogBlock(channel, triggerMessage, LUDVIG_USER_ID);

    if (!rawLogs) {
      await channel.send('Could not find any logs above your trigger message.');
      return;
    }

    // 2) Run summarizer workflow
    const canonical = await runSummarizerWorkflow(rawLogs);

    if (!canonical || typeof canonical !== 'object') {
      await channel.send('Summarizer returned no structured data.');
      await logToAgentLog('Summarizer returned invalid canonical_event.');
      return;
    }

    const summaryText = canonical.content || '(no summary content)';
    const tasks = Array.isArray(canonical.tasks) ? canonical.tasks : [];
    const meta = canonical.meta || {};
    const source = canonical.source || {};

    // 3) Post summary in the SAME channel (#agent-input)
    await channel.send(`**Summary:**\n${summaryText}`);

    // 4) Post tasks in #ludvig-inbox
    const inboxChannel = await client.channels.fetch(DISCORD_INBOX_CHANNEL_ID);
    if (!inboxChannel || !inboxChannel.isTextBased()) {
      await channel.send('Could not find #ludvig-inbox to post tasks.');
      await logToAgentLog('DISCORD_INBOX_CHANNEL_ID not a text channel or not fetchable.');
      return;
    }

    if (!tasks.length) {
      await inboxChannel.send(
        `No clear actionable tasks detected from the latest logs in <#${DISCORD_INPUT_CHANNEL_ID}>.`
      );
      lastTaskBatch = { tasks: [], sourceRef: null, meta: null };
      return;
    }

    const listLines = tasks.map((t, idx) => {
      const i = idx + 1;
      const priority = t.priority_hint ? t.priority_hint.toUpperCase() : 'MEDIUM';
      const title = t.title || '(no title)';
      const context = t.context || '';
      const due = t.due ? ` (due: ${t.due})` : '';
      return `${i}. [${priority}] ${title}${due}\n    ${context}`;
    });

    const sourceRef =
      canonical.source_ref ||
      (source.channel
        ? `discord:${source.channel}@${source.time_window || ''}`
        : `discord:#agent-input@${meta.now || ''}`);

    const taskMsg = [
      `**Proposed tasks from latest logs in <#${DISCORD_INPUT_CHANNEL_ID}>:**`,
      '',
      ...listLines,
      '',
      '_Reply in this channel with `keep: 1,3` or `keep all` to store tasks in the PA._'
    ].join('\n');

    await inboxChannel.send(taskMsg);

    // 5) Update in-memory batch
    lastTaskBatch = {
      tasks,
      sourceRef,
      meta
    };
  } catch (err) {
    console.error('handleSummarizeTrigger error:', err);
    await triggerMessage.channel.send('Error while processing logs.');
    await logToAgentLog(`handleSummarizeTrigger error: ${err.message}`);
  }
}

async function handleKeepDrop(message) {
  try {
    if (!lastTaskBatch.tasks.length) {
      await message.reply('No pending tasks batch to confirm. Try processing new logs first.');
      return;
    }

    const parsed = parseKeepDrop(message.content);
    if (!parsed) {
      // Not a keep/drop message – ignore silently
      return;
    }

    let tasksToStore = [];

    if (parsed.mode === 'all') {
      tasksToStore = lastTaskBatch.tasks;
    } else if (parsed.mode === 'indices') {
      // Filter by 1-based indices
      tasksToStore = parsed.indices
        .map((i) => lastTaskBatch.tasks[i - 1])
        .filter(Boolean);
    }

    if (!tasksToStore.length) {
      await message.reply('No valid task numbers found to keep.');
      return;
    }

    // Attach source_ref to each task if not present
    const enriched = tasksToStore.map((t) => ({
      ...t,
      source_ref: t.source_ref || lastTaskBatch.sourceRef || null
    }));

    // Send to Catalyst
    const createdTasks = await createTasksInCatalyst(enriched);

    await message.reply(`Stored ${createdTasks.length} task(s) in the PA.`);
    // Optionally clear batch after storing
    lastTaskBatch = { tasks: [], sourceRef: null, meta: null };
  } catch (err) {
    console.error('handleKeepDrop error:', err);
    await message.reply('Error while storing tasks in the PA.');
    await logToAgentLog(`handleKeepDrop error: ${err.message}`);
  }
}

// ---------- HTTP server for Cloud Run ----------

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK\n');
    return;
  }
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not found\n');
});

server.listen(PORT, () => {
  console.log(`HTTP server listening on ${PORT}`);
});

// ---------- Start Discord client (only if config is OK) ----------

if (!CAN_START_DISCORD) {
  console.error(
    '[startup] Discord bot not started because required env vars are missing. ' +
      'HTTP health endpoint is running for Cloud Run. Fix env and redeploy to enable Discord.'
  );
} else {
  client.login(DISCORD_TOKEN).catch((err) => {
    console.error('Failed to login Discord client:', err);
    logToAgentLog(`Failed to login Discord client: ${err.message}`);
  });
}