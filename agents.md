# Agent configuration for PA-AI

This repository contains a canonical architecture and process spec in `PA-NOTES.md`.

## Core rule for all code changes

- Before making **any** code change, read `PA-NOTES.md`.
- All implementation must follow `PA-NOTES.md` exactly.
- Do **not** introduce new patterns, pivots or alternative architectures unless:
  - Ludvig has explicitly requested it, **and**
  - `PA-NOTES.md` has been updated to reflect the change.

## Behaviour for this agent (Codex)

- Treat `PA-NOTES.md` as the single source of truth for:
  - System architecture (bridge + summarizer + Catalyst + PA agent)
  - Channel structure
  - Ingestion workflows
  - Catalyst APIs
  - Canonical event schema
  - MVP vs later phases
  - No-pivot rule

- When asked to modify code:
  1. Consult `PA-NOTES.md`.
  2. Verify that the requested change is consistent with those notes.
  3. If there is a conflict, **ask Ludvig to update PA-NOTES.md first** instead of silently pivoting.

- Never refactor or “simplify” the architecture in ways that conflict with `PA-NOTES.md`, even if it seems technically nicer.


## Meta-Protocol (Mandatory for Every Codex Run)

To ensure complete alignment with `PA-NOTES.md` and prevent accidental pivots, Codex must follow this protocol on every run — including `/plan`.

### 1. Pre-Execution Rules
- ALWAYS load and read `PA-NOTES.md` before modifying any code.
- ALWAYS load and read this file (`agents.md`) before executing changes.
- NEVER introduce new ideas, refactors, optimizations, or architectural changes unless Ludvig has first updated `PA-NOTES.md` to include them.
- If a requested change conflicts with `PA-NOTES.md`, Codex must STOP and ask Ludvig to update the Notes.

### 2. Execution Behaviour
- Only modify the minimal code necessary to achieve the requested change (surgical edits).
- Maintain the structure defined by:
  - `index.js` (bridge)
  - `services/openai.js`
  - `services/catalyst.js`
  - `services/extractLastLogBlock.js`
  - `services/parseKeepDrop.js`
  - Docker + Cloud Run wrapper
- Do NOT create new directories, tools, frameworks, or patterns unless explicitly allowed in `PA-NOTES.md`.

### 3. Post-Execution Run Report (Mandatory)
After completing any change request, Codex must output the following **verbatim** structure:

#### Run Report
**Changes Made**
- List each file modified.
- Brief explanation of each change.

**Diff Summary**
- Unified diff of exactly the changed lines (not whole files).

**Reasoning**
- 2–4 sentences explaining why each change is necessary **according to `PA-NOTES.md`**.

**Next Steps**
- Only include next steps that follow directly from `PA-NOTES.md`.
- Never propose new ideas or pivots.

### 4. Forbidden Actions
- Do NOT modify `PA-NOTES.md` unless Ludvig explicitly instructs.
- Do NOT invent new architecture.
- Do NOT integrate new APIs, SDKs or technologies.
- Do NOT relocate files or reorganise the repo.
- Do NOT interpret ambiguous instructions — request clarification instead.

This Meta-Protocol applies automatically to every run. Codex must treat it as binding.
