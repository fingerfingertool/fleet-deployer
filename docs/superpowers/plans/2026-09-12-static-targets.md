# Static Targets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Target-adapter model (vds + static-sftp kinds) to fleet panel with SFTP publish job.

**Architecture:** Extend JSON-file store with `targets` collection + auto-migration from `hosts`; add `targetAdapter` interface (`kind` dispatch) so VDS playbook stays untouched and SFTP publish builds on panel then uploads; per-target job serialization via in-process map.

**Tech Stack:** Node 20, Express 4, ssh2 + ssh2-sftp-client (or ssh2 sftp subsystem), Jest/Supertest.

**Spec:** docs/superpowers/specs/2026-09-12-static-targets-design.md

## Global Constraints

- Any branch = reskin; deploy any branch to any target.
- No code edits on VDS; dirty worktree blocks deploy; drift flagged via `.fleet-sha`.
- Manual DNS v1; panel only writes Caddy (VDS) + healthchecks.
- Secrets: key paths only (max 512 chars), never key material in store or logs.
- Concurrent deploys per target serialized.
- Build env vars from deployment envValues, never logged.
- Temp clones cleaned after job; build logs stored with deployment log.

---

### Task 1: Store — targets collection + migration + product buildConfig

**Files:**
- Modify: `fleet/store.js`
- Test: `fleet/store.test.js`

**Interfaces:**
- Consumes: existing `createStore(file)` with `{products, hosts, deployments}`.
- Produces: `listTargets/getTarget/saveTarget/deleteTarget`, `migrateHostsToTargets()` auto-run on load; product `buildConfig {command, outputDir}` defaults `{command:'npm run build', outputDir:'dist/'}`; deployment gains `targetId` (alongside legacy `vdsId`).

- [ ] **Step 1: Write the failing test**

```js
const { createStore } = require('./store');
test('migrates hosts to vds targets and defaults buildConfig', () => {
  const s = createStore(':memory:');
  const h = s.saveHost({ name: 'v1', ip: '1.2.3.4', sshUser: 'root' });
  const t = s.listTargets().find(x => x.migratedFromHostId === h.id);
  expect(t).toBeTruthy();
  expect(t.kind).toBe('vds');
  expect(t.ip).toBe('1.2.3.4');
  const p = s.saveProduct({ name: 'shop', gitUrl: 'https://x/y.git' });
  expect(p.buildConfig).toEqual({ command: 'npm run build', outputDir: 'dist/' });
});
test('saves static-sftp target', () => {
  const s = createStore(':memory:');
  const t = s.saveTarget({ name: 'cpanel1', kind: 'static-sftp', host: 'cp.example.com', username: 'u', remoteDir: '/public_html' });
  expect(t.id).toBeTruthy();
  expect(s.listTargets().length).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/store.test.js -v`
Expected: FAIL with "s.listTargets is not a function"

- [ ] **Step 3: Write minimal implementation**

```js
// in createStore, after data init:
function ensureTargets() {
  if (!Array.isArray(data.targets)) data.targets = [];
  // migrate each host once
  for (const h of data.hosts) {
    if (!data.targets.some(t => t.migratedFromHostId === h.id)) {
      data.targets.push({ id: h.id, kind: 'vds', name: h.name, ip: h.ip, sshUser: h.sshUser, sshKeyPath: h.sshKeyPath, providerLabel: h.providerLabel, migratedFromHostId: h.id });
    }
  }
}
// saveProduct defaults:
function withBuildDefaults(p) {
  if (!p.buildConfig || typeof p.buildConfig !== 'object') p.buildConfig = { command: 'npm run build', outputDir: 'dist/' };
  else { p.buildConfig.command = p.buildConfig.command || 'npm run build'; p.buildConfig.outputDir = p.buildConfig.outputDir || 'dist/'; }
  return p;
}
// add: listTargets/getTarget/saveTarget (validate kind in ['vds','static-sftp'], strip key material), deleteTarget
```

Full edit: add `targets` to data init + loader, call `ensureTargets()` after load and after `saveHost`, wrap `saveProduct` with `withBuildDefaults` (also backfill loaded products).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/store.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/store.js fleet/store.test.js
git commit -m "feat(fleet): targets store with host migration and buildConfig defaults"
```

### Task 2: Targets + buildConfig CRUD API (hosts kept read-only compat)

**Files:**
- Modify: `fleet/server.js`
- Test: `fleet/routes.test.js`

**Interfaces:**
- Consumes: `listTargets/saveTarget`, product `buildConfig` from Task 1.
- Produces: `GET/POST /api/fleet/targets`, `GET /api/fleet/targets/:id`, `DELETE /api/fleet/targets/:id`; `POST /api/fleet/products` accepts `buildConfig`; `POST /api/fleet/deployments` accepts `targetId` (or legacy `vdsId`) with FK check against targets.

- [ ] **Step 1: Write the failing test**

```js
const request = require('supertest');
const { buildApp } = require('./server');
test('creates static-sftp target and deployment via targetId', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git', buildConfig: { command: 'npm run build', outputDir: 'dist' } })).body;
  expect(p.buildConfig.outputDir).toBe('dist');
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'cp1', kind: 'static-sftp', host: 'cp.example.com', username: 'u', remoteDir: '/public_html' })).body;
  expect(t.id).toBeTruthy();
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, branch: 'main', targetId: t.id, domain: 'shop.example.com' });
  expect(d.status).toBe(201);
  expect(d.body.targetId).toBe(t.id);
});
test('rejects key material on targets', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/targets').send({ name: 'x', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', privateKey: 'SECRET' });
  expect(r.status).toBe(201);
  expect(r.body.privateKey).toBeUndefined();
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/routes.test.js -v`
Expected: FAIL with 404 on `/api/fleet/targets`

- [ ] **Step 3: Write minimal implementation**

```js
// POST /api/fleet/targets validation:
const ALLOWED_KINDS = ['vds', 'static-sftp'];
// vds requires name,ip,sshUser; static-sftp requires name,host,username,remoteDir
// sshKeyPath / keyPath: string max 512 only; strip privateKey/sshKey/password fields
// POST /api/fleet/products: pass through buildConfig {command string<=256, outputDir string<=256, must not contain '..'}
// POST /api/fleet/deployments: accept targetId OR vdsId; resolve target = store.getTarget(targetId||vdsId) || store.getHost(vdsId); store both targetId and vdsId for compat; 400 unknown target
// GET /api/fleet/targets, GET /:id, DELETE /:id
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/routes.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/server.js fleet/routes.test.js
git commit -m "feat(fleet): targets CRUD API with targetId deployments"
```

### Task 3: Static SFTP publish adapter + drift marker

**Files:**
- Create: `fleet/targets/staticSftp.js`
- Create: `fleet/targets/adapter.js`
- Test: `fleet/staticSftp.test.js`

**Interfaces:**
- Consumes: product `{gitUrl, buildConfig}`, deployment `{branch, domain, envValues}`, target `{host, username, remoteDir, port?}`.
- Produces: `buildPublishSteps(ctx)` -> string[] (panel-side shell: temp clone → build → sftp put → write .fleet-sha → healthcheck); `parseSha(output)`; `detectStaticDrift(remoteSha, expectedSha)` -> boolean; `adapterFor(kind)` dispatches to vds deployer vs staticSftp.

- [ ] **Step 1: Write the failing test**

```js
const { buildPublishSteps, detectStaticDrift } = require('./targets/staticSftp');
test('publish steps clone branch, build, upload dist, write sha, healthcheck', () => {
  const steps = buildPublishSteps({ gitUrl: 'https://x/y.git', branch: 'reskin-acme', buildCommand: 'npm run build', outputDir: 'dist', domain: 'shop.example.com', sha: 'abc123' });
  const all = steps.join('\n');
  expect(all).toMatch('reskin-acme');
  expect(all).toMatch('npm run build');
  expect(all).toMatch('.fleet-sha');
  expect(all).toMatch('https://shop.example.com/');
});
test('drift when sha differs', () => { expect(detectStaticDrift('aaa', 'bbb')).toBe(true); expect(detectStaticDrift('aaa', 'aaa')).toBe(false); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/staticSftp.test.js -v`
Expected: FAIL with "Cannot find module './targets/staticSftp'"

- [ ] **Step 3: Write minimal implementation**

```js
function quoteShell(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function validateBranch(b) { if (!/^[A-Za-z0-9/_.-]{1,128}$/.test(b)) throw new Error('Invalid branch: ' + b); return b; }
function buildPublishSteps({ gitUrl, branch, buildCommand, outputDir, domain, sha }) {
  validateBranch(branch);
  const work = '/tmp/fleet-build-$JOBID';
  return [
    `rm -rf ${work} && git clone --depth 1 --branch ${quoteShell(branch)} ${quoteShell(gitUrl)} ${work}`,
    `cd ${work} && npm ci && ${buildCommand || 'npm run build'}`,
    `sftp-put ${work}/${outputDir || 'dist'}/* -> ${quoteShell(domain)}:remoteDir`,
    `echo ${quoteShell(sha)} | sftp-put - .fleet-sha`,
    `curl -fsS https://${domain}/`,
  ];
}
function detectStaticDrift(remoteSha, expectedSha) { if (remoteSha == null || expectedSha == null) return true; return remoteSha !== expectedSha; }
module.exports = { buildPublishSteps, detectStaticDrift };
```

Note: `sftp-put` is a placeholder command string for the job runner to interpret with ssh2-sftp in the later SSH-worker task; keep as shell-string spec so tests assert shape. Reuse `quoteShell/validateBranch` style from `fleet/deployer.js`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/staticSftp.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/targets/staticSftp.js fleet/targets/adapter.js fleet/staticSftp.test.js
git commit -m "feat(fleet): static-sftp publish adapter with sha drift marker"
```

### Task 4: Harbor UI — targets tab replaces hosts, per-kind deploy form

**Files:**
- Modify: `fleet/public/index.html`
- Test: manual (fetch `/api/fleet/targets` renders kind badges) + `npx jest fleet/` green

**Interfaces:**
- Consumes: `GET /api/fleet/targets`, `GET /api/fleet/products` (with buildConfig).
- Produces: targets list with kind badge (vds/static-sftp), deploy form target picker (shows per-kind fields), go-live checklist adapted per kind (SFTP: credentials → build → upload → verify).

- [ ] **Step 1: Write the failing check**

```js
// add fleet/ui.test.js (jsdom-free string check):
const fs = require('fs');
test('harbor UI has targets tab and kind badge', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('targets');
  expect(html).toMatch('kind');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/ui.test.js -v`
Expected: FAIL (no `targets` tab yet — currently `hosts`)

- [ ] **Step 3: Write minimal implementation**

```html
<!-- rename hosts tab -> targets tab, fetch /api/fleet/targets, render badge per kind -->
<!-- deploy form: <select id="targetPicker"> populated from targets; on change show #vdsFields or #sftpFields -->
<!-- checklist: if kind==static-sftp show [credentials, build, upload, verify], else [dns, caddy, health] -->
```

Keep changes surgical: rename tab label + fetch URL, add badge span, add conditional fields. No framework changes.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/ -v`
Expected: PASS (all suites incl. new ui.test.js)

- [ ] **Step 5: Commit**

```bash
git add fleet/public/index.html fleet/ui.test.js
git commit -m "feat(fleet): harbor targets tab with per-kind deploy form"
```
