// index.js
import 'dotenv/config';
import http from 'http';
import {
  Client,
  GatewayIntentBits,
  Partials
} from 'discord.js';

import { runSummarizerWorkflow, runDailyBriefingAgent } from './services/openai.js';
import { createTasksInCatalyst, fetchTasksFromCatalyst } from './services/catalyst.js';
import { parseKeepDrop } from './services/parseKeepDrop.js';
import { extractLastLogBlock } from './services/extractLastLogBlock.js';

const {
  DISCORD_TOKEN,
  DISCORD_INPUT_CHANNEL_ID,
  DISCORD_INBOX_CHANNEL_ID,
  DISCORD_DAILY_CHANNEL_ID,
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

const DAILY_OK =
  !!DISCORD_DAILY_CHANNEL_ID ||
  !envMissing('DISCORD_DAILY_CHANNEL_ID');

const LUDVIG_OK =
  !!LUDVIG_USER_ID ||
  !envMissing('LUDVIG_USER_ID');

const CAN_START_DISCORD =
  DISCORD_CONFIG_OK && INPUT_OK && INBOX_OK && DAILY_OK && LUDVIG_OK;

// In-memory last task batch (simple v1)
let lastTaskBatch = {
  tasks: [],
  sourceRef: null,
  meta: null
};

// In-memory cache of last actionable list posted to #ludvig-inbox
let lastListedTasks = {
  tasks: [],
  postedAt: null,
  messageId: null
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

    // 2) #ludvig-inbox: keep/drop confirmation + task commands
    if (channelId === DISCORD_INBOX_CHANNEL_ID && message.author.id === LUDVIG_USER_ID) {
      await handleInboxMessage(message);
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

async function handleInboxMessage(message) {
  const handledKeepDrop = await handleKeepDrop(message);
  if (handledKeepDrop) return;

  await handleTaskUpdateCommands(message);
}

async function handleKeepDrop(message) {
  try {
    if (!lastTaskBatch.tasks.length) {
      const parsed = parseKeepDrop(message.content);
      if (parsed) {
        await message.reply('No pending tasks batch to confirm. Try processing new logs first.');
        return true;
      }
      return false;
    }

    const parsed = parseKeepDrop(message.content);
    if (!parsed) {
      // Not a keep/drop message – ignore silently
      return false;
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
      return true;
    }

    // Attach source_ref to each task if not present
    const enriched = tasksToStore.map((t) => ({
      ...t,
      source_ref: t.source_ref || lastTaskBatch.sourceRef || null
    }));

    // Send to Catalyst
    const createdTasks = await createTasksInCatalyst(enriched);

    await message.reply(`Stored ${createdTasks.length} task(s) in the PA.`);
    await logToAgentLog(
      `keep success: sent ${enriched.length} task(s), Catalyst returned ${createdTasks.length}.`
    );
    // Clear batch after successful store
    lastTaskBatch = { tasks: [], sourceRef: null, meta: null };
    return true;
  } catch (err) {
    console.error('handleKeepDrop error:', err);
    await message.reply('Error while storing tasks in the PA.');
    await logToAgentLog(`keep error: ${err.message}`);
    return true;
  }
}

async function handleTaskUpdateCommands(message) {
  const parsed = parseTaskUpdateCommand(message.content);
  if (!parsed) return false;

  if (!lastListedTasks.tasks.length) {
    await message.reply(
      'No actionable list is cached right now. Trigger a daily briefing before using these commands.'
    );
    return true;
  }

  const selectedTasks = parsed.indices
    .map((idx) => lastListedTasks.tasks[idx - 1])
    .filter(Boolean);

  if (!selectedTasks.length) {
    await message.reply('No matching task numbers from the latest actionable list.');
    return true;
  }

  try {
    const payload = buildTaskCommandPayload(parsed, selectedTasks);
    const updated = await createTasksInCatalyst(payload);

    // Refresh cached list with returned values
    updated.forEach((task) => {
      const idx = lastListedTasks.tasks.findIndex((t) => t.id === task.id);
      if (idx >= 0) {
        lastListedTasks.tasks[idx] = {
          ...lastListedTasks.tasks[idx],
          ...task
        };
      }
    });

    await message.reply(parsed.replyText);
  } catch (err) {
    console.error('handleTaskUpdateCommands error:', err);
    await message.reply('Failed to update the selected tasks in Catalyst.');
    await logToAgentLog(`task command error: ${err.message}`);
  }

  return true;
}

function parseTaskUpdateCommand(content) {
  if (!content) return null;
  const trimmed = content.trim();
  if (!trimmed) return null;

  const doneMatch = trimmed.match(/^(done|remove|reopen)\s*:\s*(.+)$/i);
  if (doneMatch) {
    const action = doneMatch[1].toLowerCase();
    const indices = parseIndices(doneMatch[2]);
    if (!indices.length) return null;

    const replyTextMap = {
      done: `Marked tasks ${indices.join(', ')} as done.`,
      remove: `Removed tasks ${indices.join(', ')} from the list.`,
      reopen: `Reopened tasks ${indices.join(', ')}.`
    };

    return {
      type: action,
      indices,
      replyText: replyTextMap[action]
    };
  }

  const projectMatch = trimmed.match(/^project\s+([0-9,\s]+):\s*(.+)$/i);
  if (projectMatch) {
    const indices = parseIndices(projectMatch[1]);
    const projectName = projectMatch[2].trim();
    if (!indices.length || !projectName) return null;

    return {
      type: 'project',
      indices,
      projectName,
      replyText: `Tagged tasks ${indices.join(', ')} with project "${projectName}".`
    };
  }

  return null;
}

function parseIndices(text) {
  if (!text) return [];
  const parts = text
    .split(/[,\s]+/)
    .map((p) => parseInt(p, 10))
    .filter((n) => Number.isInteger(n) && n > 0);
  const unique = [...new Set(parts)];
  return unique;
}

function buildTaskCommandPayload(parsed, selectedTasks) {
  const updates = selectedTasks.map((task) => ({
    id: task.id,
    title: task.title,
    context: task.context,
    due: task.due,
    priority_hint: task.priority_hint,
    project_id: task.project_id,
    project_hint: task.project_hint,
    source_ref: task.source_ref,
    status: task.status || 'open'
  }));

  switch (parsed.type) {
    case 'done':
      return updates.map((u) => ({ ...u, status: 'done' }));
    case 'remove':
      return updates.map((u) => ({ ...u, status: 'removed' }));
    case 'reopen':
      return updates.map((u) => ({ ...u, status: 'open' }));
    case 'project':
      return updates.map((u) => ({ ...u, project_hint: parsed.projectName }));
    default:
      return updates;
  }
}

async function handleDailyBriefingRequest(res) {
  try {
    const tasks = await fetchTasksFromCatalyst();
    const briefing = await runDailyBriefingAgent(tasks);

    await postDailyBriefingToDiscord(briefing);

    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('Daily briefing posted.\n');
  } catch (err) {
    console.error('handleDailyBriefingRequest error:', err);
    await logToAgentLog(`daily briefing error: ${err.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Failed to post daily briefing.\n');
  }
}

async function postDailyBriefingToDiscord(briefing) {
  if (!briefing) {
    throw new Error('No daily briefing payload was generated.');
  }

  const { daily_message, actionable_list } = briefing;

  if (daily_message) {
    await sendToChannel(DISCORD_DAILY_CHANNEL_ID, daily_message);
  }

  if (actionable_list?.message) {
    const inboxChannel = await client.channels.fetch(DISCORD_INBOX_CHANNEL_ID);
    if (!inboxChannel || !inboxChannel.isTextBased()) {
      throw new Error('Unable to post actionable list – inbox channel missing.');
    }

    const sent = await inboxChannel.send(actionable_list.message);
    storeLastListedTasks(actionable_list.tasks || [], sent?.id || null);
  } else {
    storeLastListedTasks([], null);
  }
}

async function sendToChannel(channelId, content) {
  if (!channelId) return;
  const channel = await client.channels.fetch(channelId);
  if (!channel || !channel.isTextBased()) {
    throw new Error(`Channel ${channelId} is not accessible or text-based.`);
  }
  await channel.send(content);
}

function storeLastListedTasks(tasks, messageId) {
  lastListedTasks = {
    tasks: Array.isArray(tasks)
      ? tasks.filter((task) => task && task.id)
      : [],
    postedAt: new Date().toISOString(),
    messageId: messageId || null
  };
}

// ---------- HTTP server for Cloud Run ----------

const PORT = process.env.PORT || 8080;

const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end('OK\n');
    return;
  }

  if (req.url === '/cron/daily-briefing' && req.method === 'GET') {
    handleDailyBriefingRequest(res);
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
