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
