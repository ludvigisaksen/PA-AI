# PA-AI System Notes (Single Source of Truth)
All decisions, implementation steps, architecture choices, and future development must strictly follow this document. Codex is not allowed to introduce new patterns or pivots unless explicitly instructed. This file defines:

- The system architecture (bridge + summarizer + Catalyst + PA agent)
- The channel structure
- The ingestion workflows
- The Catalyst APIs
- The canonical event schema
- The boundaries between MVP and later phases
- The no-pivot rule

0) Core rule (no pivoting)

All decisions, workflows, architecture and next steps must always refer back to these Notes.
This document is now updated to reflect an explicit pivot: Workflows removed.
The Notes act as the single source of truth.
If any new idea, optimisation or alternative approach deviates from the Notes, it must not be adopted unless it is explicitly approved by Ludvig and added to the Notes.
We do not pivot silently or spontaneously.
We always align updates to the Notes first, then execute.

1) State & data

1.1 Zoho Catalyst state store (tasks + projects API)
    • Endpoints:
      - GET /state/tasks
      - POST /state/tasks
      - GET /state/projects
      - POST /state/projects
    • Used by the PA to read/write tasks and big projects.
    URL: https://pa-ai-20110549563.development.catalystserverless.eu/server/pa_state_api
Status: ✅ DONE (tested via curl, returns empty arrays today).

1.2 Canonical event schema (events → tasks/projects)
    • Common schema for anything the PA consumes:
      - event_type, source, content, tasks[], meta
    • Implemented as structured JSON output of the Discord Summarizer workflow.
Status: ✅ Defined + implemented (Discord path only, email postponed).

⸻

2) Ingestion & understanding

2.0 Discord server + bot
Channels set up
1. #ludvig-inbox
2. #agent-input
	•	Purpose: Ludvig pastes raw logs here (from FC internal server).
	•	Visibility: Only you + the bot.
	•	This is the “ingestion trigger channel”.

2. #agent-review
	•	Purpose: The bridge posts the summarizer result (summary + proposed tasks).
	•	Ludvig replies with:
	•	keep: 1,3
	•	drop: 2
	•	or a cleaned/edited list
	•	Visibility: Only you + the bot.

3. #agent-daily
	•	Purpose: You manually trigger daily briefings:
briefing for today?

4. #agent-projects (optional now)
	•	Purpose: Later, the PA posts project overviews here.

5. #agent-log
	•	Purpose: Debug.
	•	The bridge writes internal logs here (errors, validations, weird inputs).
	•	But only if needed — it should never spam.

Bot set up “PA-Bridge”, Application ID: 1439294057900671037, Public Key: 1aadd943fa656ae267aad3f2f1804291a586be7d4eb1b4d745dd710bdae52411, Token: MTQzOTI5NDA1NzkwMDY3MTAzNw.GuB0ch.Daat1F2uaPIN-L6BNfsJUrj5vj4yvCwwRsouwE

2.1 Discord mass input → Summarizer workflow
Pivot: NO Workflows
	1.	Ludvig pastes raw FC internal logs into #agent-input.
	2.	Ludvig types:
“summarize this” / “process this”
	3.	Bridge extracts the last log block.
	4.	Bridge calls Chat Completions / Responses API:
model: "gpt-4.1-nano"
input:
    - Summarizer system prompt
    - Full canonical-event specification
    - rawLogs
	5.	Assistant returns canonical_event JSON.
	6.	Bridge posts:
	•	Summary → #agent-input
	•	Proposed tasks → #ludvig-inbox
	7.	Ludvig approves via:
	•	keep: 1,3
	•	keep all
	8.	Approved tasks → Catalyst /state/tasks.

Status:
	✅ Functional.
	OpenAI calls working locally.
	Bridge logic tested.



2.1b Channel behaviour (CONFIRMED)

#agent-input
	•	Ludvig pastes logs
	•	Says “summarize this”
	•	Bot replies:
	•	“Processing…”
	•	Summary only
	•	No tasks here.

#ludvig-inbox
	•	Bridge posts tasks with numbers
	•	Ludvig says “keep: …”
	•	Bot stores tasks in Catalyst
	•	This becomes Ludvig’s action hub.

#agent-review

Deprecated for v1. Replaced by #ludvig-inbox task flow.

Flow v1:
	1.	Ludvig pastes logs → #agent-input.
	2.	Ludvig types trigger (“summarize this”).
	3.	Bridge sends logs → Summarizer WF → gets canonical_event.
	4.	Bridge posts summary only → #agent-input.
	5.	Bridge posts task list → #ludvig-inbox.
	6.	Ludvig replies with “keep: …”.
	7.	Bridge POSTs approved tasks → Catalyst /state/tasks.

2.2 Starred email ingestion
    • Take starred emails → summarizer → canonical_event → tasks/projects.
    • Same pattern as Discord but using email as source.
Status: ⏸ Deferred to v1.5 (not in MVP).

⸻

3) Executive PA (what Ludvig experiences)

3.1 PA core agent (Agent Builder)
    • An Agent that:
      - Uses tools wrapping:
        · GET /state/tasks
        · POST /state/tasks
        · GET /state/projects
        · POST /state/projects
      - Understands Ludvig’s priorities and current workload.
      - Answers questions like:
        · “What do I need to move forward on today?”
        · “What’s the status of the YGO February launch tasks?”
    • This is the “brain” that turns stored tasks/projects into useful answers.
Status: ⭕ Not created yet
Will use only Catalyst tools, not Workflows.


🔄 Updated design (no workflows):

Will be done via bridge + Responses API, triggered by:
	•	Manual message in #agent-daily (v1)
	•	Google Cloud Scheduler (v2)

3.3 Project overview in #agent-projects
    • Channel: #agent-projects on PA-AI server.
    • PA agent can post or refresh summaries for the 3–6 big projects
      (YGO February launch, linesheet deadlines, etc.).
Status: ⭕ Not built yet – optional after 3.1.

⸻

4) Bridges & automation (later phases)

4.0 Cloud Run Bridge (UPDATED & WORKING)

The bridge is now the central orchestrator.

Responsibilities:
	•	Listen to Discord
	•	Extract logs
	•	Call Responses API
	•	Parse canonical_event
	•	Post summaries
	•	Post tasks
	•	Store tasks in Catalyst
	•	Serve /health for Cloud Run
	•	Will serve /cron/daily-briefing for scheduled briefs (v2)

Status:

✔ Running locally
⏳ Cloud Run deployment in progress

4.1 Discord bot UX improvements
    • Replace “confirm via text reply” with:
      - Buttons (Approve / Reject / Edit) on each candidate task.
      - Optional modals for editing tasks directly in Discord.
    • Only when MVP proves useful.

4.2 Email ingestion (v1.5)
    • Starred emails → Email Summarizer → canonical_event → Discord review → Catalyst.

4.3 Calendar integration (v1.5+)
    • PA suggests calendar blocks / reminders for tasks with due dates.

Status: ⏸ All 4.x deferred until core Discord-only MVP is useful.

4.1 Discord bot UX improvements

Later.

4.2 Email ingestion

Later.

4.3 Calendar

Later.


–––––––
5) Discord bot baseline (reference)

Bot status: invited & active in PA-AI server.

Configured capabilities:
	•	Message Content Intent: ON
	•	Server Members Intent: ON
	•	OAuth2 Scopes:
	•	bot
	•	applications.commands (optional, enabled)
	•	Bot Permissions:
	•	View Channels
	•	Send Messages
	•	Read Message History
	•	Embed Links (optional, enabled)

Restrictions:
	•	Bot is not in FC internal server
	•	Bot has no admin or management permissions
	•	No slash commands required in v1
	•	Bot will operate via natural-language triggers interpreted through LLM

Purpose in v1:
	•	Listen in #agent-input
	•	Trigger summarization workflow after Ludvig’s natural-language signal
	•	Post summaries + proposed tasks in #agent-review
	•	Wait for Ludvig’s natural-language confirmation
	•	Forward approved tasks to Catalyst


6) Current Code Components (As of Pivot)

1. index.js — The Bridge (Main Orchestrator)
	•	Connects to Discord.
	•	Detects summarization triggers in #agent-input.
	•	Extracts the relevant log block.
	•	Calls runSummarizer() from openai.js.
	•	Posts:
	•	Summary → #agent-input
	•	Tasks → #ludvig-inbox
	•	Handles keep: … confirmations.
	•	Sends approved tasks to Catalyst.
	•	Exposes /health endpoint for Cloud Run.

Status: Fully implemented and working locally.

⸻

2. services/openai.js — Summarizer (Responses API)
	•	Calls OpenAI Responses API (not workflows).
	•	Sends summarizer system prompt + canonical schema + raw logs.
	•	Extracts canonical_event JSON safely.
	•	Returns summary + tasks to the bridge.

Status: Working and stable.

⸻

3. services/catalyst.js — State Storage
	•	Provides:
	•	createTasksInCatalyst(tasks)
	•	Future: project-related functions
	•	Sends POST requests to Catalyst /state/tasks.

Status: Works with live Catalyst API.

⸻

4. services/parseKeepDrop.js — User Confirmation Parser
	•	Parses Ludvig’s replies in #ludvig-inbox:
	•	keep: 1,3
	•	keep all
	•	drop: 2
	•	Returns structured indices or “all”.

Status: Working.

⸻

5. services/extractLastLogBlock.js — Log Extraction
	•	Reads Discord history above the trigger message.
	•	Extracts the last contiguous block authored by Ludvig.
	•	Returns raw logs as a single string.

Status: Working and tested.

⸻

6. Docker + Cloud Run deployment wrapper
	•	Dockerfile runs:
	•	Node app
	•	HTTP health check
	•	Persistent Discord connection
	•	Cloud Run keeps the bot alive.

Status: Deployment in progress.
