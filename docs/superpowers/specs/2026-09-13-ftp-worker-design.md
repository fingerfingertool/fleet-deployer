# FTP Deploy Worker — Vision + BRD (v0.1)

Date: 2026-09-13 | Path: Architectural (brainstorming) | Approach: B — panel-owned publish config, repo-script fallback

## 1. Vision

Fleet Harbor executes real deploys itself: queue a job (by button or GitHub
webhook), build the branch on the panel, publish over FTP to the cPanel
target, verify over HTTPS, and keep a permanent per-deployment run history
with reasons and retry. Deploy knowledge lives in the panel (product publish
config), so any repo — PHP, static, Node-built — ships without repo changes.

## 2. Scope v1 / Out of scope

**v1 IN:** in-process FIFO job runner with per-target serialization;
panel-owned `publish` config per product (`strategy ftp-static`,
`buildCommand`, `sourceDir`, `extraFiles`, `exclude`, `transport`);
repo-script fallback (`deploy-ftp.py` interface) when no config set;
FTP publish (plain + TLS) with creds from server env vault, never the DB;
`.fleet-sha` marker write + drift compare; HTTPS healthcheck;
status machine draft→queued→running→live|failed;
GitHub webhook (`push` → match repo+branch → queue; HMAC per-product secret);
run history (`runs` collection, triggers manual|webhook|retry, machine
reason + redacted log tail); Retry button per failed run; redeploy (HEAD)
and static rollback (re-publish prior SHA) as new runs; Deploy buttons wired
in UI (currently disabled placeholders).
**P2:** BullMQ/Redis queue, SFTP transport, VDS strategy execution,
per-run log streaming (tail only v1), deploy previews.
**Out:** DNS management, secret values in DB (forbidden), multi-step
pipelines, team RBAC.

## 3. Functional requirements

- FR-W1: Queue job per deployment; per-target serialization (one running
  job per target, rest wait FIFO); temp clones under
  `/tmp/fleet-build-<jobId>`, always removed after run.
- FR-W2: Clone shallow at deployment branch using product `repoKeyPath`
  (path-only) for private repos; public repos need no key.
- FR-W3: Build with product `buildCommand` (null = skip); build env from
  deployment `envValues`; secrets redacted from all stored logs.
- FR-W4: Publish per product `publish` config: upload `sourceDir` contents
  + `extraFiles` to target `remoteDir`, skip `exclude` (e.g. `*.json`);
  fallback to repo `deploy-ftp.py` with `FTP_HOST/USER/PASS/DIR` when no
  config set.
- FR-W5: Write `.fleet-sha` (commit SHA), HTTPS `GET https://domain/`
  healthcheck, record SHA, mark live/failed.
- FR-W6: Webhook `POST /api/fleet/webhooks/github`: verify HMAC
  (`X-Hub-Signature-256`) against the secret resolved from the product's
  `webhookSecretRef` via the server env vault; on `push`,
  queue jobs for deployments watching that repo+branch; `ping` → 200;
  non-matching pushes logged as `ignored`.
- FR-W7: Every run appended to `runs` with trigger, branch, commit,
  status, timestamps, machine reason on failure (`clone-failed`,
  `build-failed`, `upload-failed`, `healthcheck-failed`, `dirty-target`,
  `auth-failed`), human line, redacted log tail. History view per
  deployment, newest first, permanent.
- FR-W8: Retry button per failed run re-queues same branch/commit as new
  run (`trigger: retry`, linked to original). Redeploy = HEAD run.
  Rollback (static) = re-publish prior SHA as new run.
- FR-W9: UI: Deploy buttons enabled, run history in detail drawer with
  reason + Retry, webhook secret field in product edit, per-target queue
  position indicator.

## 4. Non-functional

- Panel disk/CPU sized for builds; build+clone timeouts (clone 60s,
  build 10min, upload 10min, healthcheck 60s); log tail capped (200KB).
- Secrets: FTP passwords and webhook secrets in server env vault only;
  key paths (max 512) in DB; never key material, passwords, or env
  values in DB or logs.
- Idempotent publish (re-run safe); concurrent deploys per target
  serialized; queue survives nothing (in-memory; restarts drop queued
  jobs, running job marked failed on boot).
- Audit: every run records trigger source (who/what queued it).

## 5. Data model (v1 additions)

Product += `publish {strategy, buildCommand, sourceDir, extraFiles[],
exclude[], transport{kind, tls}}`, `repoKeyPath`, `webhookSecretRef`
(secret name in vault, not the value).
Run(id, deploymentId, trigger, branch, commitSha, status, reason,
startedAt, finishedAt, logTail, retryOf?).
Deployment += `lastRunId`, `queuePosition` (transient).

## 6. Acceptance

Given ghostname product + ghost target + webhook registered, `git push`
to `ghostname-marketplace` auto-queues a run that goes live with valid
HTTPS in ~5 min; a forced failure (bad branch) shows machine reason in
history and Retry re-runs green; `npx jest fleet/` fully green.
