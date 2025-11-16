// catalyst/pa_state_api/index.js
//
// Advanced I/O function for PA state API.
// Exposes:
//   GET  /state/tasks
//   POST /state/tasks
//   GET  /state/projects
//   POST /state/projects
//
// Storage is kept in-memory per function instance (OK for MVP).
// Contract matches what the bridge expects:
//   - JSON { tasks: [...] } for tasks endpoints
//   - JSON { projects: [...] } for projects endpoints

// ----------- Helpers -----------

function sendJson(response, statusCode, body) {
  try {
    response.setStatusCode(statusCode);
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify(body || {}));
  } catch (err) {
    // Worst-case fallback if response helpers blow up
    try {
      response.setStatusCode(500);
      response.setHeader('Content-Type', 'application/json');
      response.end(JSON.stringify({ error: 'Response serialization error' }));
    } catch (_) {
      // nothing else we can do
    }
  }
}

// Robust JSON body parsing for Catalyst Advanced I/O
function parseJsonBody(request) {
  if (!request) return {};

  // If Catalyst already parsed JSON into an object
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) {
    return request.body;
  }

  const candidates = [request.body, request.rawBody, request.requestBody];

  for (const candidate of candidates) {
    if (!candidate) continue;

    if (typeof candidate === 'string') {
      const trimmed = candidate.trim();
      if (!trimmed) return {};
      return JSON.parse(trimmed);
    }

    if (Buffer.isBuffer(candidate)) {
      const str = candidate.toString('utf8').trim();
      if (!str) return {};
      return JSON.parse(str);
    }
  }

  return {};
}

// Simple in-memory stores (per function instance / container)
let TASKS = [];
let PROJECTS = [];
let NEXT_TASK_ID = 1;
let NEXT_PROJECT_ID = 1;

function sanitizeTask(input) {
  const id = input.id || `t_${NEXT_TASK_ID++}`;

  return {
    id,
    title:
      typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : 'Untitled task',
    context: typeof input.context === 'string' ? input.context : '',
    status: input.status || 'open',
    due: input.due || null,
    priority_hint: input.priority_hint || null,
    project_id: input.project_id || null,
    project_hint: input.project_hint || null,
    source_ref: input.source_ref || null
  };
}

function sanitizeProject(input) {
  const id = input.id || `p_${NEXT_PROJECT_ID++}`;

  return {
    id,
    title:
      typeof input.title === 'string' && input.title.trim()
        ? input.title.trim()
        : 'Untitled project',
    context: typeof input.context === 'string' ? input.context : '',
    status: input.status || 'open',
    due: input.due || null,
    importance: input.importance || null,
    source_ref: input.source_ref || null
  };
}

// ----------- Main handler -----------

module.exports = async (request, response) => {
  const url = request.url || '';
  const method = (request.method || 'GET').toUpperCase();

  try {
    // ---------- TASKS ----------
    if (url.endsWith('/state/tasks') && method === 'GET') {
      // Return all tasks currently in memory
      return sendJson(response, 200, { tasks: TASKS });
    }

    if (url.endsWith('/state/tasks') && method === 'POST') {
      let body;
      try {
        body = parseJsonBody(request);
      } catch (err) {
        console.error('Invalid JSON in POST /state/tasks:', err);
        return sendJson(response, 400, { error: 'Invalid JSON body' });
      }

      const incomingTasks = Array.isArray(body.tasks) ? body.tasks : null;
      if (!incomingTasks) {
        return sendJson(response, 400, { error: 'Body must include tasks array' });
      }

      const savedTasks = [];
      for (const raw of incomingTasks) {
        if (!raw || typeof raw !== 'object') continue;
        const sanitized = sanitizeTask(raw);
        TASKS.push(sanitized);
        savedTasks.push(sanitized);
      }

      console.log('[POST /state/tasks]', {
        incomingCount: incomingTasks.length,
        persisted: savedTasks.length
      });

      if (!savedTasks.length) {
        return sendJson(response, 400, { error: 'No valid tasks provided' });
      }

      return sendJson(response, 200, { tasks: savedTasks });
    }

    // ---------- PROJECTS (simple stub for now) ----------
    if (url.endsWith('/state/projects') && method === 'GET') {
      return sendJson(response, 200, { projects: PROJECTS });
    }

    if (url.endsWith('/state/projects') && method === 'POST') {
      let body;
      try {
        body = parseJsonBody(request);
      } catch (err) {
        console.error('Invalid JSON in POST /state/projects:', err);
        return sendJson(response, 400, { error: 'Invalid JSON body' });
      }

      const incomingProjects = Array.isArray(body.projects) ? body.projects : null;
      if (!incomingProjects) {
        return sendJson(response, 400, { error: 'Body must include projects array' });
      }

      const savedProjects = [];
      for (const raw of incomingProjects) {
        if (!raw || typeof raw !== 'object') continue;
        const sanitized = sanitizeProject(raw);
        PROJECTS.push(sanitized);
        savedProjects.push(sanitized);
      }

      console.log('[POST /state/projects]', {
        incomingCount: incomingProjects.length,
        persisted: savedProjects.length
      });

      if (!savedProjects.length) {
        return sendJson(response, 400, { error: 'No valid projects provided' });
      }

      return sendJson(response, 200, { projects: savedProjects });
    }

    // ---------- Fallback ----------
    return sendJson(response, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Unhandled error in pa_state_api:', err);
    return sendJson(response, 500, { error: 'Internal server error' });
  }
};
