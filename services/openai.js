// services/openai.js
//
// Single responsibility: turn raw Discord logs into a canonical_event
// using the OpenAI Chat / Responses API (no Workflows).
//
// Exported:
//   - runSummarizerWorkflow(rawLogs): Promise<canonical_event>
//   - runDailyBriefingAgent(tasks): Promise<{ daily_message, actionable_list }>

const { OPENAI_API_KEY } = process.env;
const BASE_URL = 'https://api.openai.com/v1';

// Simple sleep helper (kept for future use if needed)
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Build a safe fallback canonical_event so index.js never crashes
function buildEmptyCanonicalEvent(reason) {
  return {
    event_type: 'discord_mass_input_summary',
    source: {
      platform: 'discord',
      server: null,
      channel: null,
      time_window: null
    },
    content: reason || 'No summary available.',
    tasks: [],
    meta: {
      now: new Date().toISOString(),
      locale: 'en-DK',
      importance: 'low'
    }
  };
}

/**
 * Run the Discord summarizer on raw logs, returning canonical_event JSON.
 *
 * @param {string} rawLogs - The pasted Discord logs.
 * @returns {Promise<object>} canonical_event JSON.
 */
export async function runSummarizerWorkflow(rawLogs) {
  if (!rawLogs || !rawLogs.trim()) {
    throw new Error('runSummarizerWorkflow called with empty logs');
  }

  if (!OPENAI_API_KEY) {
    console.error('[summarizer] Missing OPENAI_API_KEY – returning empty canonical_event.');
    return buildEmptyCanonicalEvent(
      'Summarizer not configured (missing OPENAI_API_KEY) – no tasks created.'
    );
  }

  const systemPrompt = `
You are Ludvig’s Discord Summarizer agent for FINE CHAOS.

INPUT:
- You receive raw Discord logs as a single text block.
- They look like either:
  1) "Name — DD/MM/YYYY, HH.mm: message"
  2) A "header" line with "Name — DD/MM/YYYY, HH.mm" on one line and the message content on the following line.
- Treat every sender + date/time combination as one message.

YOUR GOAL:
1) Understand what happened in these messages.
2) Produce a concise written summary.
3) Extract tasks and project signals relevant for Ludvig’s work.
4) Return a SINGLE JSON OBJECT in the canonical event schema below.
5) NEVER invent tasks, deadlines, or projects. Only use what is clearly implied by the logs.
6) Respond with ONLY valid JSON. No backticks, no prose.

CANONICAL EVENT SCHEMA (what you MUST return):

{
  "event_type": "discord_mass_input_summary",
  "source": {
    "platform": "discord",
    "server": "fc-internal" | "pa-ai" | null,
    "channel": "string or null",
    "time_window": "string or null"
  },
  "content": "string – a concise natural-language summary of what happened in the logs.",
  "tasks": [
    {
      "id": null,
      "title": "concrete action Ludvig or team must do",
      "context": "short explanation with enough info to recognise it later",
      "due": "YYYY-MM-DD or null",
      "priority_hint": "high" | "medium" | "low" | null,
      "project_hint": "string or null",
      "source_ref": "string or null"
    }
  ],
  "meta": {
    "now": "ISO-8601 datetime string (your current time)",
    "locale": "en-DK",
    "importance": "high" | "normal" | "low" | null
  }
}

export async function runDailyBriefingAgent(tasks) {
  const normalizedTasks = Array.isArray(tasks) ? tasks : [];

  if (!OPENAI_API_KEY) {
    console.error('[daily-briefing] Missing OPENAI_API_KEY – returning fallback payload.');
    return buildDailyBriefingFallback(normalizedTasks, 'OpenAI key missing');
  }

  const systemPrompt = `You are Ludvig's Daily Briefing agent for PA-AI.

You evaluate the current Catalyst task list and create:
1. A Discord-ready daily briefing message for #agent-daily.
2. A mirrored actionable list for #ludvig-inbox where each numbered line maps 1:1 with actionable_list.tasks.

Scoring rules:
- Score 5: Critical blockers or overdue deliverables with high priority.
- Score 4: Due within 2 days or explicitly flagged as high priority.
- Score 3: Important tasks without immediate deadlines.
- Score 2: Nice-to-have or long-term follow ups.
- Score 1: Low-priority reminders.

Prioritize tasks that are status "open" or "blocked". Avoid tasks already marked "done" or "removed" unless they need follow-up.

Formatting:
- daily_message must start with "**Daily Briefing – YYYY-MM-DD**" and include short sections ("Highlights", "Risks", "Next Actions"). Use Discord Markdown only.
- actionable_list.message must be a numbered list starting at 1 with bold task titles and short context lines, ready for posting in #ludvig-inbox.
- Ensure numbering in actionable_list.message matches actionable_list.tasks order exactly.

Output JSON schema:
{
  "daily_message": "string",
  "actionable_list": {
    "message": "Discord formatted numbered list",
    "tasks": [
      {
        "id": "Catalyst ROWID as string",
        "title": "task title",
        "status": "open|blocked|done|removed",
        "score": 1-5,
        "due": "YYYY-MM-DD or null",
        "priority_hint": "high|medium|low|null",
        "project_hint": "string or null",
        "context": "short reasoning for the scoring"
      }
    ]
  }
}

Always return valid JSON only.`.trim();

  const userPrompt = `Today's date: ${new Date().toISOString().slice(0, 10)}.
Here is the latest Catalyst task list as JSON:

${JSON.stringify(normalizedTasks, null, 2)}

Apply the scoring and formatting rules. Focus on the 8 most actionable tasks.`.trim();

  let apiResp;
  try {
    apiResp = await fetch(`${BASE_URL}/responses`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-mini',
        temperature: 0.35,
        max_output_tokens: 1200,
        input: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
  } catch (err) {
    console.error('[daily-briefing] Network/HTTP error calling OpenAI:', err);
    return buildDailyBriefingFallback(normalizedTasks, 'OpenAI network error');
  }

  if (!apiResp.ok) {
    const text = await apiResp.text().catch(() => '');
    console.error('[daily-briefing] OpenAI error response:', apiResp.status, text);
    return buildDailyBriefingFallback(normalizedTasks, `OpenAI error ${apiResp.status}`);
  }

  let data;
  try {
    data = await apiResp.json();
  } catch (err) {
    console.error('[daily-briefing] Failed to parse JSON from OpenAI response:', err);
    return buildDailyBriefingFallback(normalizedTasks, 'Invalid JSON from OpenAI');
  }

  const rawText = extractResponsesText(data);
  if (!rawText) {
    console.error('[daily-briefing] Empty content from OpenAI responses payload.');
    return buildDailyBriefingFallback(normalizedTasks, 'Empty model response');
  }

  let parsed;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    console.error('[daily-briefing] Model returned non-JSON content:', rawText);
    return buildDailyBriefingFallback(normalizedTasks, 'Model returned non-JSON content');
  }

  if (!parsed || typeof parsed !== 'object') {
    return buildDailyBriefingFallback(normalizedTasks, 'Model output malformed');
  }

  if (!parsed.actionable_list || typeof parsed.actionable_list !== 'object') {
    parsed.actionable_list = { message: '', tasks: [] };
  }

  if (!Array.isArray(parsed.actionable_list.tasks)) {
    parsed.actionable_list.tasks = [];
  }

  parsed.actionable_list.tasks = parsed.actionable_list.tasks.map((task) => ({
    id: task?.id ? String(task.id) : null,
    title: task?.title || 'Untitled task',
    status: task?.status || 'open',
    score: typeof task?.score === 'number' ? task.score : null,
    due: task?.due || null,
    priority_hint: task?.priority_hint || null,
    project_hint: task?.project_hint || null,
    context: task?.context || ''
  })).filter((task) => task.id);

  parsed.daily_message = parsed.daily_message || '**Daily Briefing – (missing content)**';
  parsed.actionable_list.message = parsed.actionable_list.message || '**Actionable list unavailable.**';

  return parsed;
}

function extractResponsesText(data) {
  if (!data) return null;
  if (Array.isArray(data.output)) {
    for (const block of data.output) {
      if (Array.isArray(block.content)) {
        const textChunk = block.content.find((entry) => entry?.type === 'output_text');
        if (textChunk?.text) {
          return textChunk.text.trim();
        }
        const plain = block.content.find((entry) => entry?.text);
        if (plain?.text) {
          return plain.text.trim();
        }
      }
    }
  }

  if (Array.isArray(data.output_text) && data.output_text[0]) {
    return String(data.output_text[0]).trim();
  }

  if (typeof data.content === 'string') {
    return data.content.trim();
  }

  return null;
}

function buildDailyBriefingFallback(tasks, reason) {
  const shortlist = tasks.filter((t) => t && t.status !== 'done').slice(0, 5);
  const header = '**Daily Briefing – unavailable**';
  const lines = shortlist.map((task, idx) => `${idx + 1}. **${task.title}** – ${task.context || ''}`);
  return {
    daily_message: `${header}\nReason: ${reason}.`,
    actionable_list: {
      message: ['**Actionable list (fallback)**', ...lines].join('\n'),
      tasks: shortlist
    }
  };
}

DETAILED RULES:
- NEVER invent tasks, deadlines, or projects.
- Only create tasks that are clearly relevant for Ludvig as sender or recipient.
- Leave "due" = null unless there is a clear date or strong hint (e.g. "by Friday" -> use the next calendar Friday and mention this assumption in "context").
- "project_hint" is for big initiatives (e.g. "Yu-Gi-Oh February launch", "Linesheet for next season").
- "source_ref" can be something like "discord:#channel@YYYY-MM-DD" derived from the logs if possible; if not, you may leave it null.
- "server" and "channel" should be filled if obvious from the log text; otherwise null is acceptable.
- "time_window" can be an approximate date range if visible in the logs (e.g. "2025-10-29 to 2025-11-12"); otherwise null.

OUTPUT:
- Respond with ONLY the JSON object above, no explanation or extra text.
- JSON must be valid: double-quoted keys, double-quoted strings, no trailing commas.
`.trim();

  const userPrompt = `
Here are raw Discord logs:

${rawLogs}

Remember:
- Parse them as described.
- Return exactly ONE JSON object in the canonical_event schema.
- Do NOT wrap it in backticks.
- Do NOT add any commentary.
`.trim();

  let apiResp;
  try {
    apiResp = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'gpt-4.1-nano',
        temperature: 0.1,
        max_tokens: 1200,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
        ]
      })
    });
  } catch (err) {
    console.error('[summarizer] Network/HTTP error calling OpenAI:', err);
    return buildEmptyCanonicalEvent('Error calling OpenAI – no tasks created.');
  }

  if (!apiResp.ok) {
    const text = await apiResp.text().catch(() => '');
    console.error(
      `[summarizer] OpenAI responded with error ${apiResp.status}: ${text}`
    );
    return buildEmptyCanonicalEvent(
      `OpenAI error ${apiResp.status} – no tasks created.`
    );
  }

  let data;
  try {
    data = await apiResp.json();
  } catch (err) {
    console.error('[summarizer] Failed to parse OpenAI JSON response:', err);
    return buildEmptyCanonicalEvent('Failed to parse OpenAI JSON response.');
  }

  const rawContent =
    data?.choices?.[0]?.message?.content && String(data.choices[0].message.content).trim();

  if (!rawContent) {
    console.error('[summarizer] Empty content from model');
    return buildEmptyCanonicalEvent('Model returned empty content – no tasks created.');
  }

  let canonical;
  try {
    canonical = JSON.parse(rawContent);
  } catch (err) {
    console.error('[summarizer] Failed to parse model JSON content:', err, rawContent);
    return buildEmptyCanonicalEvent(
      'Model returned non-JSON content – no tasks created.'
    );
  }

  // Basic normalisation so index.js can rely on fields existing
  if (typeof canonical !== 'object' || canonical === null) {
    return buildEmptyCanonicalEvent('Model output was not an object – no tasks created.');
  }

  if (!canonical.event_type) {
    canonical.event_type = 'discord_mass_input_summary';
  }
  if (!canonical.source || typeof canonical.source !== 'object') {
    canonical.source = {
      platform: 'discord',
      server: null,
      channel: null,
      time_window: null
    };
  }
  if (!Array.isArray(canonical.tasks)) {
    canonical.tasks = [];
  }
  if (!canonical.meta || typeof canonical.meta !== 'object') {
    canonical.meta = {
      now: new Date().toISOString(),
      locale: 'en-DK',
      importance: 'normal'
    };
  }

  return canonical;
}