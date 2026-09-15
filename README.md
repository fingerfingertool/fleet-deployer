# Fleet Harbor — MissionControl

Central admin panel that deploys git branches to cPanel shared hosting over FTP.
Live at `http://89.116.171.48:3100/` (basic auth, see Credentials).

## Mental model (read this first)

- **Product** = git repo + pinned branch (+ deploy key path, publish config, webhook secret ref).
- **Target** = one host folder serving exactly one domain (`static-sftp` over FTP; `vds` kind exists but no executor).
- **Binding (deployment)** = exactly one product + one target (1:1 enforced both ways, 409 on conflict). Branch and domain are inherited, never typed.
- **Run** = one execution of a binding (triggers: `manual` | `webhook` | `retry`). Runs snapshot product/target/domain/branch at start, so editing a binding never rewrites history. **Deployments screen = global run history.**
- Panel builds nothing remotely: it clones shallow on the panel server, optionally runs `buildCommand`, uploads files, writes `.fleet-sha` (commit SHA), HTTPS-healthchecks, marks `live`/`failed` with a machine `reason`.

## Repo layout

```
fleet/server.js       Express API + basic auth + GitHub webhook (all routes; async handlers via ah())
fleet/store.js        Data layer: createStore (JSON file, sync) + createPgStore (Postgres, async)
fleet/worker.js       In-process FIFO queue, per-target serialization, run records
fleet/workerSteps.js  Clone → build → FTP publish (basic-ftp) → .fleet-sha → healthcheck
fleet/publish.js      planPublish(): panel-owned publish config, repo deploy-script fallback
fleet/deployer.js     Legacy VDS playbook strings (no executor; VDS kind is registry-only)
fleet/public/index.html  Harbor UI (vanilla JS, hash routes #/deployments #/bindings #/products #/targets)
fleet.Dockerfile      Panel image (node:22-alpine + git + openssh-client + python3)
compose.fleet.yml     Panel + postgres:16 (fleet-db) + volumes
fleet.env             SECRETS, gitignored (panel login, FTP vault, webhook secrets, pg password)
.keys/                Private keys, gitignored, mounted ro at /app/keys
docs/superpowers/     Specs + implementation plans (read before changing architecture)
```

## Data & secrets (critical)

- Postgres (`fleet-db` volume) is primary; `fleet.json` (in `fleet-data` volume) seeds it on first boot and stays as backup. One table: `fleet_docs(kind, id, data)`.
- **Paths-only rule:** DB stores key *paths* (≤512 chars), never key material/passwords/tokens. `privateKey|sshKey|password|keyMaterial` fields are stripped on write.
- Vault = `fleet.env` (server env): `FLEET_USER/FLEET_PASS` (panel login), `FTP_PASS_<targetId>` per-target FTP passwords, `FTP_PASS_DEFAULT` shared fallback, `<NAME>_HOOK` webhook secrets, `POSTGRES_PASSWORD/PGPASSWORD`.
- Deploy keys: per-repo ed25519 in `.keys/`, registered read-only on GitHub; products reference them via `repoKeyPath: /app/keys/<name>`.
- FTP accounts are jailed at the account home: worker normalizes cPanel-absolute `/home/<user>/<dir>` to jail-relative. `client.cd(remoteDir)` + relative uploads; absolute paths would land nested (past incident).
- Container env snapshots at **create** time: after editing `fleet.env`, you must `stop + rm + up -d` (plain `restart` keeps old env).

## Workflows

- **New repo → live:** deploy key → product (repo + branch + key + publish config) → bind to free target → Deploy. Pushes auto-deploy once the repo webhook exists (see below).
- **Publish config** (per product): `{strategy:'ftp-static', buildCommand|null, sourceDir, extraFiles[], exclude[]}`. Must match the branch layout; a missing `sourceDir` fails the run loudly (past silent-stale incidents). Flat branches use `sourceDir:'.'`; `public/`-layout branches use `'public'`. Dotfiles/`.git`/`deploy-ftp.py` are never uploaded.
- **Webhooks:** GitHub `push` → `POST /api/fleet/webhooks/github` (HMAC `X-Hub-Signature-256` vs secret from product `webhookSecretRef`, open endpoint by design). Matches **all** products sharing the secret whose branch equals the pushed ref. Register per repo via API (`/repos/{o}/{r}/hooks`); each product needs its `webhookSecretRef` set (POST **and** PUT accept it — POST silently dropped it once, regression-tested).
- **History/Repair:** every run keeps trigger/status/reason/redacted log tail. Retry re-queues same branch/commit. Static rollback = redeploy an older SHA (manual). Unbind keeps history.

## Gotchas learned the hard way

1. Branch layout changes (`public/` ↔ flat) silently froze sites green — now a missing `sourceDir` fails fast. Still, after any repo restructure, verify the product publish config.
2. `express.json()` + webhook HMAC: webhook route uses `express.raw` mounted **before** basicAuth; `curl --data` (not `--data-binary`) mangles newlines and breaks test signatures — GitHub sends raw bytes, fine.
3. `DELETE`/`PUT` guards: 409 when target bound / product has deployments / name taken / target already bound.
4. Browser caches the UI aggressively — hard-refresh (`Ctrl+Shift+R`) after every panel redeploy; page JS is verified with `node --check` before push.
5. cPanel host: SSH/SFTP closed (ports 22/2222 refused); FTP/21 only. Server hostname `dubstep.cleannameservers.com` = same shared IP `208.115.234.114`.

## Runbook

```bash
npx jest fleet/                       # full suite (pg test skips without DATABASE_URL)
node --check <(python3 -c "import re;s=open('fleet/public/index.html').read();print(re.search(r'<script>(.*)</script>',s,re.S).group(1))")
docker compose -f compose.fleet.yml build && docker stop fleet-panel && docker rm fleet-panel && docker compose -f compose.fleet.yml up -d
curl -u "$FLEET_USER:$FLEET_PASS" http://89.116.171.48:3100/api/fleet/health
```

## Current live state (2026-09-15)

| Target | Domain | Product | Branch | Status |
|---|---|---|---|---|
| ghost | ghost.ghostprovider.com | ghostsite | ghost | live |
| domains | domains.ghostprovider.com | nominee | nominee | live |
| names | names.ghostprovider.com | darkroom | darkroom | live |
| nominee | nominee.ghostprovider.com | nominee | nominee | live |
| main | ghostprovider.com | ghostproviderhome | master | live |

Repos: `fingerfingertool/ghostname` (webhook active), `fingerfingertool/ghostproviderhome` (webhook active).
Unclaimed product: `ghostname` (marketplace branch, kept for switch-back).
Open follow-ups: rotate chat-exposed FTP password + old `ghp_…` PAT; `queuePosition:0` badge noise; static rollback to prior SHA; per-target credential indicator in UI.
