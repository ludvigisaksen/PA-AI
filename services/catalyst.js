// services/catalyst.js
//
// Responsibility: talk to Zoho Catalyst state API for tasks.
//
// Uses the pa_state_api function you already deployed:
//   GET  {CATALYST_BASE_URL}/state/tasks
//   POST {CATALYST_BASE_URL}/state/tasks

const { CATALYST_BASE_URL } = process.env;

if (!CATALYST_BASE_URL) {
  console.error(
    '[catalyst] CATALYST_BASE_URL missing – task creation will no-op until configured.'
  );
}

function buildResponseSnippet(text = '', max = 180) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function sanitizeTaskForCatalyst(task) {
  const sanitized = {
    title: typeof task.title === 'string' && task.title.trim()
      ? task.title.trim()
      : 'Untitled task',
    context: typeof task.context === 'string' ? task.context : '',
    status: task.status || 'open'
  };

  if (task.id) sanitized.id = task.id;
  if (task.due) sanitized.due = task.due;
  if (task.priority_hint) sanitized.priority_hint = task.priority_hint;
  if (task.project_hint) sanitized.project_hint = task.project_hint;
  if (task.project_id) sanitized.project_id = task.project_id;
  if (task.source_ref) sanitized.source_ref = task.source_ref;

  return sanitized;
}

/**
 * Create tasks in Catalyst.
 * @param {Array<object>} tasks - canonical_event.tasks, enriched with source_ref etc.
 * @returns {Promise<Array<object>>} tasks returned from Catalyst.
 */
export async function createTasksInCatalyst(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    throw new Error('createTasksInCatalyst called with no tasks to persist');
  }

  if (!CATALYST_BASE_URL) {
    throw new Error('CATALYST_BASE_URL is not configured');
  }

  const payload = {
    tasks: tasks.map(sanitizeTaskForCatalyst)
  };

  try {
    const resp = await fetch(`${CATALYST_BASE_URL}/state/tasks`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
        // No auth header needed, endpoint is already allow-unauthenticated
      },
      body: JSON.stringify(payload)
    });

    const respText = await resp.text().catch(() => '');

    if (!resp.ok) {
      throw new Error(
        `[catalyst] POST /state/tasks failed (${resp.status}): ${buildResponseSnippet(respText)}`
      );
    }

    let data = null;
    if (respText) {
      try {
        data = JSON.parse(respText);
      } catch (err) {
        throw new Error(
          `[catalyst] Could not parse /state/tasks response JSON: ${buildResponseSnippet(respText)}`
        );
      }
    }

    if (!data || !Array.isArray(data.tasks)) {
      throw new Error('[catalyst] Response missing tasks array');
    }

    if (!data.tasks.length) {
      throw new Error('[catalyst] Response did not return any created tasks');
    }

    return data.tasks;
  } catch (err) {
    if (err?.message?.startsWith('[catalyst]')) {
      throw err;
    }
    throw new Error(`[catalyst] Error calling /state/tasks: ${err.message}`);
  }
}