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

/**
 * Create tasks in Catalyst.
 * @param {Array<object>} tasks - canonical_event.tasks, enriched with source_ref etc.
 * @returns {Promise<Array<object>>} tasks returned from Catalyst or [] on failure.
 */
export async function createTasksInCatalyst(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0) {
    return [];
  }

  if (!CATALYST_BASE_URL) {
    console.error(
      '[catalyst] No base URL configured – skipping task creation and returning [].'
    );
    return [];
  }

  const payload = {
    tasks: tasks.map((t) => ({
      id: t.id || null,
      title: t.title || '',
      context: t.context || '',
      status: t.status || 'open',
      due: t.due || null,
      priority_hint: t.priority_hint || null,
      project_id: t.project_id || null,
      project_hint: t.project_hint || null,
      source_ref: t.source_ref || null
    }))
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

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      console.error(
        `[catalyst] Failed to POST /state/tasks (${resp.status}): ${text}`
      );
      return [];
    }

    const data = await resp.json().catch(() => null);
    if (data && Array.isArray(data.tasks)) {
      return data.tasks;
    }

    console.error(
      '[catalyst] POST /state/tasks succeeded but response shape was unexpected.'
    );
    return [];
  } catch (err) {
    console.error('[catalyst] Error calling /state/tasks:', err);
    return [];
  }
}