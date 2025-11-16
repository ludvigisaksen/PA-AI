// index.js
const catalyst = require('zcatalyst-sdk-node');

// ---------- helpers ----------

// Normalize Catalyst Date column (e.g. "2025-11-15T00:00:00.000Z") to "YYYY-MM-DD"
function dateToYMD(val) {
  if (!val) return null;
  return String(val).substring(0, 10);
}

// If client passed null, keep null; otherwise assume "YYYY-MM-DD" string
function ymdOrNull(val) {
  if (!val) return null;
  return String(val); // Catalyst will store into DATE column
}

// Parse JSON body safely for Advanced I/O
function parseJsonBody(request) {
  try {
    if (request && typeof request.requestBody === 'string') {
      return JSON.parse(request.requestBody || '{}');
    }
  } catch (e) {
    console.error('Error parsing JSON body:', e);
  }
  return {};
}

// Unified JSON responder for Catalyst Advanced I/O
function sendJson(response, statusCode, payload) {
  response.statusCode = statusCode; // Node.js ServerResponse
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(payload));
}

// ---------- MAIN HANDLER ----------

module.exports = async (request, response) => {
  const app = catalyst.initialize(request);
  const url = request.url || '';
  const method = request.method || 'GET';

  try {
    if (url.startsWith('/state/tasks') && method === 'GET') {
      return await handleGetTasks(app, request, response);
    }

    if (url.startsWith('/state/tasks') && method === 'POST') {
      return await handlePostTasks(app, request, response);
    }

    if (url.startsWith('/state/projects') && method === 'GET') {
      return await handleGetProjects(app, request, response);
    }

    if (url.startsWith('/state/projects') && method === 'POST') {
      return await handlePostProjects(app, request, response);
    }

    // Fallback 404
    sendJson(response, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Error in pa_state_api:', err);
    sendJson(response, 500, { error: 'Internal server error' });
  }
};

// ---------- TASKS ----------

async function handleGetTasks(app, request, response) {
  const datastore = app.datastore();
  const tasksTable = datastore.table('tasks');

  const rows = await tasksTable.getAllRows();

  const tasks = rows.map(row => ({
    id: row.ROWID.toString(),
    title: row.title || '',
    context: row.context || '',
    status: row.status || 'open',
    due: dateToYMD(row.due),
    priority_hint: row.priority_hint || null,
    project_id: row.project_id || null,
    project_hint: row.project_hint || null,
    source_ref: row.source_ref || null,
    created_at: row.CREATED_TIME,
    updated_at: row.MODIFIED_TIME
  }));

  sendJson(response, 200, { tasks });
}

async function handlePostTasks(app, request, response) {
  const datastore = app.datastore();
  const tasksTable = datastore.table('tasks');

  const body = parseJsonBody(request);
  const incomingTasks = Array.isArray(body.tasks) ? body.tasks : [];

  const savedTasks = [];

  for (const t of incomingTasks) {
    if (!t || !t.title) continue;

    const rowDataBase = {
      title: t.title,
      context: t.context || '',
      status: t.status || 'open',
      due: ymdOrNull(t.due),
      priority_hint: t.priority_hint || '',
      project_id: t.project_id || '',
      project_hint: t.project_hint || '',
      source_ref: t.source_ref || ''
    };

    let row;
    if (!t.id) {
      // create
      row = await tasksTable.insertRow(rowDataBase);
    } else {
      // update
      row = await tasksTable.updateRow({
        ROWID: parseInt(t.id, 10),
        ...rowDataBase
      });
    }

    savedTasks.push({
      id: row.ROWID.toString(),
      title: row.title || '',
      context: row.context || '',
      status: row.status || 'open',
      due: dateToYMD(row.due),
      priority_hint: row.priority_hint || null,
      project_id: row.project_id || null,
      project_hint: row.project_hint || null,
      source_ref: row.source_ref || null,
      created_at: row.CREATED_TIME,
      updated_at: row.MODIFIED_TIME
    });
  }

  sendJson(response, 200, { tasks: savedTasks });
}

// ---------- PROJECTS ----------

async function handleGetProjects(app, request, response) {
  const datastore = app.datastore();
  const projectsTable = datastore.table('projects');

  const rows = await projectsTable.getAllRows();

  const projects = rows.map(row => ({
    id: row.ROWID.toString(),
    name: row.name || '',
    description: row.description || '',
    status: row.status || 'active',
    deadline: dateToYMD(row.deadline),
    milestones: row.milestones_json ? JSON.parse(row.milestones_json) : [],
    risks: row.risks_json ? JSON.parse(row.risks_json) : [],
    created_at: row.CREATED_TIME,
    updated_at: row.MODIFIED_TIME
  }));

  sendJson(response, 200, { projects });
}

async function handlePostProjects(app, request, response) {
  const datastore = app.datastore();
  const projectsTable = datastore.table('projects');

  const body = parseJsonBody(request);
  const incomingProjects = Array.isArray(body.projects) ? body.projects : [];

  const savedProjects = [];

  for (const p of incomingProjects) {
    if (!p || !p.name) continue;

    const rowDataBase = {
      name: p.name,
      description: p.description || '',
      status: p.status || 'active',
      deadline: ymdOrNull(p.deadline),
      milestones_json: JSON.stringify(p.milestones || []),
      risks_json: JSON.stringify(p.risks || [])
    };

    let row;
    if (!p.id) {
      // create
      row = await projectsTable.insertRow(rowDataBase);
    } else {
      // update
      row = await projectsTable.updateRow({
        ROWID: parseInt(p.id, 10),
        ...rowDataBase
      });
    }

    savedProjects.push({
      id: row.ROWID.toString(),
      name: row.name || '',
      description: row.description || '',
      status: row.status || 'active',
      deadline: dateToYMD(row.deadline),
      milestones: row.milestones_json ? JSON.parse(row.milestones_json) : [],
      risks: row.risks_json ? JSON.parse(row.risks_json) : [],
      created_at: row.CREATED_TIME,
      updated_at: row.MODIFIED_TIME
    });
  }

  sendJson(response, 200, { projects: savedProjects });
}