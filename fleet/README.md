# fleet/ — panel implementation

Start with `../README.md` (full handoff: mental model, secrets, workflows, gotchas, live state).

Module map:

- `server.js` — all API routes (async handlers via `ah()`; webhook mounted before basicAuth with `express.raw` for HMAC). Store backend chosen in `buildApp`: `DATABASE_URL`/`PGHOST` → `createPgStore`, else file store.
- `store.js` — `createStore` (sync JSON) + `createPgStore` (async Postgres, table `fleet_docs(kind,id,data)`, seeds from JSON on first boot). Same method names; always `await` at call sites. **Never** persist key material/passwords (stripped); key paths ≤512 chars.
- `worker.js` — FIFO queue, per-target serialization; runs snapshot product/target/domain/branch at start (history must not join live bindings).
- `workerSteps.js` — clone (60s) → build (600s) → FTP publish (600s, `basic-ftp`) → `.fleet-sha` → HTTPS healthcheck (60s). FTP creds: `FTP_PASS_<targetId>` else `FTP_PASS_DEFAULT` (vault only). Jail-relative uploads after `cd(remoteDir)`. Missing `sourceDir` and missing `remoteDir` fail fast with coded reasons (`build-failed`/`upload-failed`); other codes: `clone-failed`, `auth-failed`, `healthcheck-failed`.
- `publish.js` — `planPublish()` (panel config first, `deploy-ftp.py` fallback) + `redactSecrets()`. Never uploads dotfiles/`.git`/`deploy-ftp.py`.
- `run.js` — boots `buildApp` + static UI + basicAuth on pages.
- `public/index.html` — Harbor UI (vanilla JS; hash routes `#/deployments #/bindings #/products #/targets`; 5s idle-only auto-refresh; field-level `field` error tags from API).
- `deployer.js`, `propagate.js` — legacy/unused (VDS playbook strings, Hotfix compare); no executor references them.

Conventions: TDD (failing test first, see `*.test.js`), `node --check` the page script before push, hard-refresh browsers after redeploy, `stop + rm + up -d` (never bare `restart`) after `fleet.env` changes.
