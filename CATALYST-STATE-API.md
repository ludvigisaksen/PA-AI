# Catalyst State API Notes (`/catalyst/pa_state_api/`)

This document extends `PA-NOTES.md` and **does not change the architecture**.  
It specifies how the Zoho Catalyst function `pa_state_api` must behave and how it may be modified.

## 0) Scope

- Folder: `/catalyst/pa_state_api/`
- Entry file: `index.js`
- Runtime: Zoho Catalyst Node/Advanced I/O function
- Purpose: provide a minimal, stable state API for PA-AI (tasks now, projects later).

This API is consumed by the bridge (`services/catalyst.js`) via:

```text
CATALYST_BASE_URL = https://pa-ai-20110549563.development.catalystserverless.eu/server/pa_state_api
