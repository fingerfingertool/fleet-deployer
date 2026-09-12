# Fleet Deployer — Vision + BRD (v0.2)

Date: 2026-09-11 | Path: Architectural (brainstorming) | Approach: A — Agentless SSH Deployer

## 1. Vision

Central admin panel to deploy **any product (git repo + Dockerfile/compose)** to **any manually-added VDS + manually-pointed domain**. Ecom is Product Type #1; system is product-agnostic. **Any branch = reskin/variant: deploy any branch of any connected repo to any VDS.**

Goal: 1 template → N live instances (own VDS + domain each) via one-click deploy, redeploy, rollback, logs, health.

## 2. Scope v1 / Out of scope

**v1 IN:** Product registry (gitUrl, default branch, compose file, env schema), branch picker per deployment (any branch = reskin), VDS manager (manual add: ip, ssh user/key, provider label), Deployment (product+branch+vds+domain+env overlay), agentless SSH playbook (fetch→checkout branch→build→up→Caddy reload→healthcheck), drift detection (VDS commit ≠ expected → flag/block), hotfix propagate view (behind-main + merge + rolling redeploy), deployment logs + status, basic auth + audit.
**P2:** Reskin/theme editor, DNS plugins (Cloudflare/Hetzner/DO), VDS auto-provisioning.
**P3:** Agent mode, team RBAC, metrics/alerts.
**Out:** Billing, multi-container orchestration beyond compose.

## 3. Functional requirements

- FR1: CRUD Product (gitUrl, defaultBranch, compose path, env schema JSON, build hints). List remote branches on demand.
- FR2: CRUD VDS host (name, ip, sshUser, sshKey secret ref, provider label, tags, reachable check via SSH+docker ping).
- FR3: CRUD Deployment (productId, branch, vdsId, domain, env values validated vs schema, status machine queued→running→live|failed|drifted|needs-attention).
- FR4: One-click Deploy: queue BullMQ job → SSH connect → `git fetch + checkout <branch>` → `docker compose up -d --build` → write Caddyfile snippet for domain → `caddy reload` → HTTPS via Let's Encrypt (Caddy automatic, requires DNS A already pointed) → HTTP healthcheck → record commit SHA → mark live, store logs.
- FR5: Redeploy (same branch, new pull), Rollback (previous commit SHA), Stop/Delete (down + remove Caddy entry).
- FR6: Logs viewer (job log tail), health badge (last check timestamp + code).
- FR7: Manual DNS assumption: UI shows "point A record domain→VDS IP" checklist before marking live.
- FR8: No-edit-on-VDS + drift guard: playbook refuses to deploy over dirty worktree; periodic reconcile compares VDS commit SHA vs expected → `drifted` flag. Hotfix propagate: pick source commit (usually main HEAD) → show behind/ahead per deployment → merge/rebase into each target branch (conflict → `needs-attention`, never forced) → rolling redeploy origin-first with healthcheck + auto-rollback.

## 4. Non-functional

- Any x86_64 Linux VDS with SSH + Docker; panel monolith Next.js 15 + tRPC + Postgres + Redis/BullMQ.
- Secrets (SSH keys) in encrypted column / env vault, never in logs.
- Idempotent playbook; concurrent deploys per VDS serialized.
- Audit log of who deployed what where.

## 5. Data model (v1)

Product(id, name, type, gitUrl, defaultBranch, composePath, envSchema, createdAt)
VdsHost(id, name, ip, sshUser, sshKeyRef, providerLabel, tags, lastSeen)
Deployment(id, productId, branch, vdsId, domain, envValues, status, currentCommit, previousCommit, lastLog, healthAt)

## 6. UX (admin panel)

Pages: Products → VDS Hosts → Deployments (table w/ status) → Deployment detail (config, checklist DNS, Deploy/Redeploy/Rollback buttons, logs). Uses `frontend-design` later.

## 7. Open decisions (locked unless reopened)

- Source: git repo only. VDS: manual inventory, any provider. DNS: manual (opt.1). Proxy: Caddy. Playbook: agentless SSH.

## 8. Acceptance for v1

Given 1 product repo + 2 manual VDS + 2 domains with A-records, user creates 2 deployments from panel and both reach `live` with valid HTTPS within ~10 min, redeploy + rollback work, logs visible.
