# Static Hosting Targets — Vision + BRD (v0.1)

Date: 2026-09-12 | Path: Architectural (brainstorming) | Approach: A — Target-adapter model

## 1. Vision

Fleet Harbor publishes to **any target**, not only VDS. First new kind: **static
hosting via SFTP** (cPanel/shared style). The panel builds the branch itself
(`clone → npm ci → build → dist/`) and uploads. VDS flow unchanged, exposed
through the same adapter interface so PaaS/Coolify slot in later.

## 2. Scope v1 / Out of scope

**v1 IN:** `Target` model (`kind: vds | static-sftp`), migration of existing
VdsHosts → Targets, Product `buildConfig {command, outputDir}` with defaults,
SFTP publish job (build on panel → sftp put → healthcheck → SHA record),
`.fleet-sha` drift marker, UI: targets tab replaces hosts tab, deploy form
picks target, per-kind fields.
**P2:** rsync transport, external-CI builds, PaaS/Coolify adapters, DNS plugins.
**Out:** rollback of static assets beyond re-publish of previous SHA.

## 3. Functional requirements

- FR-S1: CRUD Target (kind, name, per-kind connection fields; key *paths* only).
- FR-S2: Migration: existing hosts auto-convert to `kind=vds`; deployments keep working (`targetId`).
- FR-S3: Product buildConfig (command default `npm run build`, outputDir default `dist/`).
- FR-S4: SFTP publish: temp clone branch → build → upload outputDir → write `.fleet-sha` → `GET https://domain/` healthcheck → status live/failed + commit recorded.
- FR-S5: Drift: compare `.fleet-sha` on host vs expected; manual edits flagged.
- FR-S6: UI: targets list with kind badge, deploy form target picker, go-live checklist adapted per kind (SFTP: credentials → build → upload → verify).

## 4. Non-functional

- Panel disk/CPU sized for builds (temp clones cleaned after job); per-target job serialization; build logs stored with deployment log.
- Same secrets rule: paths only, never key material; build env vars from deployment envValues, never logged.

## 5. Acceptance

Given 1 static product + 1 SFTP target + domain pointed at it, user ships from
panel and the site is live with valid cert within ~10 min; drift flagged after
manual file edit; VDS flows still pass their tests.
