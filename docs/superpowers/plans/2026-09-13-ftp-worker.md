# FTP Deploy Worker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Panel executes FTP deploys itself (queue → clone → build → publish → verify → history) with webhook triggers and retry.

**Architecture:** In-process FIFO queue in `fleet/worker.js` with per-target serialization; pure publish planner in `fleet/publish.js` (panel config first, repo-script fallback); `basic-ftp` for transport; runs recorded in store `runs` collection.

**Tech Stack:** Node 20, Express 4, basic-ftp, git CLI + openssh-client (already in fleet.Dockerfile), Jest/Supertest.

**Spec:** docs/superpowers/specs/2026-09-13-ftp-worker-design.md

## Global Constraints

- Secrets in server env vault only; key paths (max 512) in DB; never key material, passwords, or env values in DB or logs.
- Temp clones under `/tmp/fleet-build-<jobId>`, always removed after run.
- Log tail capped at 200KB, secrets redacted.
- Concurrent deploys per target serialized; queue in-memory.
- Idempotent publish (re-run safe).

---

### Task 1: Runs store + history API

**Files:**
- Modify: `fleet/store.js`
- Modify: `fleet/server.js`
- Test: `fleet/runs.test.js`

**Interfaces:**
- Consumes: existing `createStore(file)` with `{products, hosts, deployments, targets}`.
- Produces: `listRuns/getRun/saveRun/runsForDeployment(deploymentId)`; `GET /api/fleet/deployments/:id/runs`, `GET /api/fleet/runs/:runId`.

- [ ] **Step 1: Write the failing test**

```js
const { createStore } = require('./store');
test('saves and lists runs per deployment', () => {
  const s = createStore(':memory:');
  const r = s.saveRun({ deploymentId: 'd1', trigger: 'manual', branch: 'main', status: 'live' });
  expect(r.id).toBeTruthy();
  expect(s.runsForDeployment('d1').length).toBe(1);
  expect(s.runsForDeployment('other').length).toBe(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/runs.test.js --verbose`
Expected: FAIL with "s.saveRun is not a function"

- [ ] **Step 3: Write minimal implementation**

```js
// store.js: add runs: [] to data init + loader backfill (Array.isArray check like others).
listRuns: () => data.runs,
getRun: (id) => data.runs.find(x => x.id === id),
saveRun: (r) => {
  r.id = r.id || newId('r');
  r.startedAt = r.startedAt || new Date().toISOString();
  data.runs = [...data.runs.filter(x => x.id !== r.id), r];
  persist();
  return r;
},
runsForDeployment: (deploymentId) => data.runs.filter(x => x.deploymentId === deploymentId).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
```

```js
// server.js (after deployments routes):
app.get('/api/fleet/deployments/:id/runs', (req, res) => {
  const d = store.listDeployments().find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'unknown deployment' });
  res.json(store.runsForDeployment(req.params.id));
});
app.get('/api/fleet/runs/:runId', (req, res) => {
  const r = store.getRun(req.params.runId);
  if (!r) return res.status(404).json({ error: 'unknown run' });
  res.json(r);
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/runs.test.js --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/store.js fleet/server.js fleet/runs.test.js
git commit -m "feat(fleet): run history store and API"
```

### Task 2: FTP publish planner (panel config + script fallback)

**Files:**
- Create: `fleet/publish.js`
- Test: `fleet/publish.test.js`

**Interfaces:**
- Consumes: product `{publish?}`, deployment `{branch}`, target `{remoteDir}`.
- Produces: `planPublish(product, deployment, target)` -> `{mode: 'config'|'script'|'none', steps: [{op, ...}], reason?}`; `redactSecrets(text)` replaces values of keys matching /pass|secret|token|key/i with `[redacted]`; `detectStaticDrift` already exists (reuse, do not duplicate).

- [ ] **Step 1: Write the failing test**

```js
const { planPublish, redactSecrets } = require('./publish');
test('config mode maps sourceDir plus extraFiles minus exclude', () => {
  const plan = planPublish(
    { publish: { strategy: 'ftp-static', sourceDir: 'public', extraFiles: ['api.php'], exclude: ['*.json'] } },
    { branch: 'main' },
    { remoteDir: '/home/ghostpro/ghost.ghostprovider.com' });
  expect(plan.mode).toBe('config');
  expect(plan.remoteDir).toBe('/home/ghostpro/ghost.ghostprovider.com');
  expect(plan.uploads).toEqual(expect.arrayContaining(['public/', 'api.php']));
  expect(plan.exclude).toEqual(['*.json']);
});
test('no config and no script means none mode', () => {
  expect(planPublish({}, { branch: 'main' }, { remoteDir: '/x' }).mode).toBe('none');
});
test('redacts secrets', () => {
  expect(redactSecrets('FTP_PASS=hunter2 ok')).toBe('FTP_PASS=[redacted] ok');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/publish.test.js --verbose`
Expected: FAIL with "Cannot find module './publish'"

- [ ] **Step 3: Write minimal implementation**

```js
function planPublish(product, deployment, target) {
  const cfg = product && product.publish;
  if (cfg && cfg.strategy === 'ftp-static') {
    return {
      mode: 'config',
      remoteDir: target.remoteDir,
      sourceDir: cfg.sourceDir || 'public',
      extraFiles: cfg.extraFiles || [],
      exclude: cfg.exclude || [],
      buildCommand: cfg.buildCommand || null,
      uploads: [`${cfg.sourceDir || 'public'}/`, ...(cfg.extraFiles || [])],
    };
  }
  if (product && product.hasDeployScript) return { mode: 'script', script: 'deploy-ftp.py', remoteDir: target.remoteDir };
  return { mode: 'none', reason: 'no publish config and no repo deploy script' };
}
function redactSecrets(text) {
  return String(text).replace(/((?:pass|secret|token|key)[a-z_]*\s*[=:]\s*)(\S+)/gi, '$1[redacted]');
}
module.exports = { planPublish, redactSecrets };
```

Note: `hasDeployScript` is set by the worker at clone time (checks for `deploy-ftp.py` in the clone root) and passed in — the planner itself never touches the filesystem.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/publish.test.js --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/publish.js fleet/publish.test.js
git commit -m "feat(fleet): ftp publish planner with script fallback"
```

### Task 3: Worker queue + run execution + deploy endpoints

**Files:**
- Create: `fleet/worker.js`
- Modify: `fleet/server.js`
- Modify: `fleet/run.js`
- Modify: `package.json` (add `basic-ftp`)
- Test: `fleet/worker.test.js`

**Interfaces:**
- Consumes: `createStore` (needs `saveRun`, `saveDeployment`), `planPublish`/`redactSecrets` from Task 2.
- Produces: `createWorker(store, opts)` -> `{queue(deploymentId, trigger), queueLength(targetId), onEvent(fn)}`; `POST /api/fleet/deployments/:id/deploy`, `POST /api/fleet/runs/:runId/retry`; worker records runs with machine `reason` on failure (`clone-failed|build-failed|upload-failed|healthcheck-failed|auth-failed`), updates deployment `status/currentCommit/lastRunId`.

- [ ] **Step 1: Write the failing test**

```js
const { createStore } = require('./store');
const { createWorker } = require('./worker');
test('failed clone records run with reason', async () => {
  const store = createStore(':memory:');
  const p = store.saveProduct({ name: 's', gitUrl: 'https://invalid.invalid/x.git' });
  const t = store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d' });
  const d = store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'draft' });
  const w = createWorker(store, { runSteps: async () => { throw Object.assign(new Error('boom'), { code: 'clone-failed' }); } });
  const run = await w.queue(d.id, 'manual');
  expect(run.status).toBe('failed');
  expect(run.reason).toBe('clone-failed');
  expect(store.runsForDeployment(d.id).length).toBe(1);
}, 20000);
test('per-target serialization', async () => {
  const store = createStore(':memory:');
  const w = createWorker(store, {});
  expect(typeof w.queueLength).toBe('function');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/worker.test.js --verbose`
Expected: FAIL with "Cannot find module './worker'"

- [ ] **Step 3: Write minimal implementation**

```js
const { planPublish, redactSecrets } = require('./publish');
function createWorker(store, opts = {}) {
  const running = new Set();
  const queues = new Map();
  const listeners = [];
  function emit(ev) { listeners.forEach(fn => { try { fn(ev); } catch {} }); }
  async function execute(deploymentId, trigger, retryOf) {
    const d = store.listDeployments().find(x => x.id === deploymentId);
    const run = store.saveRun({ deploymentId, trigger, branch: d.branch, status: 'running', retryOf });
    d.status = 'running'; store.saveDeployment(d); emit({ type: 'run-started', run });
    try {
      const steps = opts.runSteps || require('./workerSteps').runSteps;
      const out = await steps({ store, deployment: d }, appendLog);
      run.status = 'live';
      run.commitSha = out.commitSha;
      d.status = 'live'; d.currentCommit = out.commitSha; d.lastRunId = run.id;
      function appendLog() {}
    } catch (e) {
      run.status = 'failed';
      run.reason = (e && e.code) || 'failed';
      run.error = redactSecrets((e && e.message) || 'unknown error');
      d.status = 'failed'; d.lastRunId = run.id;
    } finally {
      run.finishedAt = new Date().toISOString();
      if (run.logTail) run.logTail = redactSecrets(run.logTail).slice(-204800);
      store.saveRun(run); store.saveDeployment(d); emit({ type: 'run-finished', run });
    }
    return store.getRun(run.id);
  }
  async function pump(targetId) {
    if (running.has(targetId)) return;
    const q = queues.get(targetId) || [];
    const next = q.shift();
    if (!next) return;
    running.add(targetId);
    try { next.resolve(await execute(next.deploymentId, next.trigger, next.retryOf)); }
    catch (e) { next.reject(e); }
    finally { running.delete(targetId); pump(targetId); }
  }
  return {
    onEvent: (fn) => listeners.push(fn),
    queueLength: (targetId) => (queues.get(targetId) || []).length + (running.has(targetId) ? 1 : 0),
    queue(deploymentId, trigger = 'manual', retryOf) {
      const d = store.listDeployments().find(x => x.id === deploymentId);
      if (!d) throw new Error('unknown deployment');
      const tid = d.targetId || d.vdsId;
      d.status = 'queued'; store.saveDeployment(d);
      return new Promise((resolve, reject) => {
        const q = queues.get(tid) || [];
        q.push({ deploymentId, trigger, retryOf, resolve, reject });
        queues.set(tid, q);
        pump(tid);
      });
    },
  };
}
module.exports = { createWorker };
```

Real step execution (`fleet/workerSteps.js`: shallow clone with `repoKeyPath`, run `buildCommand` with timeout, FTP upload via `basic-ftp` using vault creds, write `.fleet-sha`, HTTPS healthcheck) is implemented in this same task after the queue skeleton passes: add `fleet/workerSteps.js` with `async runSteps({store, deployment}, log)` returning `{commitSha}` and throwing coded errors. Timeouts: clone 60s, build 600s, upload 600s, healthcheck 60s. FTP creds resolved from `process.env['FTP_PASS_' + targetId]` (vault-by-convention, documented in code comment). Temp dir `/tmp/fleet-build-<runId>`, removed in `finally`.

```js
// server.js additions:
app.post('/api/fleet/deployments/:id/deploy', (req, res) => {
  const d = store.listDeployments().find(x => x.id === req.params.id);
  if (!d) return res.status(404).json({ error: 'unknown deployment' });
  worker.queue(d.id, 'manual').catch(() => {});
  res.status(202).json({ queued: true });
});
app.post('/api/fleet/runs/:runId/retry', (req, res) => {
  const r = store.getRun(req.params.runId);
  if (!r) return res.status(404).json({ error: 'unknown run' });
  if (r.status !== 'failed') return res.status(400).json({ error: 'only failed runs can be retried' });
  worker.queue(r.deploymentId, 'retry', r.id).catch(() => {});
  res.status(202).json({ queued: true, retryOf: r.id });
});
```

`run.js`: create one worker via `createWorker(store)` — requires access to the same store instance: refactor `buildApp` to optionally accept an external store OR export it. Minimal approach: `buildApp(file)` attaches `app.locals.store = store` and `run.js` does `const worker = createWorker(app.locals.store)` then `app.locals.worker = worker`; `server.js` uses `app.locals.worker` if present else a no-op queuer (so tests without worker get 202 + in-memory queue that drains via default worker). Simplest correct: create the worker inside `buildApp` and expose as `app.locals.worker`.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/worker.test.js --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/worker.js fleet/workerSteps.js fleet/server.js fleet/run.js fleet/worker.test.js package.json package-lock.json
git commit -m "feat(fleet): deploy worker queue with run execution and retry"
```

### Task 4: GitHub webhook auto-deploy

**Files:**
- Modify: `fleet/server.js`
- Test: `fleet/webhook.test.js`

**Interfaces:**
- Consumes: `app.locals.worker` from Task 3; product `webhookSecretRef` (env var name holding the secret); deployment `{productId, branch}`.
- Produces: `POST /api/fleet/webhooks/github` (open, HMAC-verified, no basic-auth — must be mounted BEFORE the basicAuth middleware or explicitly skipped).

- [ ] **Step 1: Write the failing test**

```js
const crypto = require('crypto');
const request = require('supertest');
const { buildApp } = require('./server');
function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}
test('push matching repo+branch queues deploys', async () => {
  process.env.WH_TEST_HOOK = 'topsecret';
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://github.com/o/r.git', defaultBranch: 'main' })).body;
  await request(app).put('/api/fleet/products/' + p.id).send({ webhookSecretRef: 'WH_TEST_HOOK' });
  const t = (await request(app).post('/api/fleet/targets').send({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d' })).body;
  const d = (await request(app).post('/api/fleet/deployments').send({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com' })).body;
  const payload = { ref: 'refs/heads/main', repository: { clone_url: 'https://github.com/o/r.git' } };
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'push').set('X-Hub-Signature-256', sign('topsecret', payload)).send(payload);
  expect(r.status).toBe(200);
  expect(r.body.queued).toContain(d.id);
  delete process.env.WH_TEST_HOOK;
});
test('bad signature rejected', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'push').set('X-Hub-Signature-256', 'sha256=nope').send({ ref: 'refs/heads/main' });
  expect(r.status).toBe(401);
});
test('ping answers 200', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'ping').send({ zen: 'hi' });
  expect(r.status).toBe(200);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/webhook.test.js --verbose`
Expected: FAIL with 404 on `/api/fleet/webhooks/github`

- [ ] **Step 3: Write minimal implementation**

```js
// Mount BEFORE app.use('/api/fleet', basicAuth). Needs raw body for HMAC:
// replace global express.json with scoped parsers:
//   app.use('/api/fleet/webhooks/github', express.raw({ type: 'application/json' }));
//   app.use(express.json()) for everything else — order matters.
const crypto = require('crypto');
app.post('/api/fleet/webhooks/github', (req, res) => {
  const event = req.headers['x-github-event'];
  if (event === 'ping') return res.json({ ok: true });
  if (event !== 'push') return res.json({ ignored: true });
  const raw = req.body; // Buffer from express.raw
  const products = store.listProducts();
  const match = products.find(p => {
    const ref = p.webhookSecretRef && process.env[p.webhookSecretRef];
    if (!ref) return false;
    const sig = crypto.createHmac('sha256', ref).update(raw).digest('hex');
    const got = (req.headers['x-hub-signature-256'] || '').replace('sha256=', '');
    try { return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(got)); }
    catch { return false; }
  });
  if (!match) return res.status(401).json({ error: 'bad signature' });
  let payload; try { payload = JSON.parse(raw.toString('utf8')); } catch { return res.status(400).json({ error: 'bad payload' }); }
  const branch = (payload.ref || '').replace('refs/heads/', '');
  const urls = [payload.repository && payload.repository.clone_url, payload.repository && payload.repository.ssh_url].filter(Boolean);
  const queued = [];
  for (const d of store.listDeployments().filter(x => x.productId === match.id && x.branch === branch)) {
    if (match.gitUrl && !urls.includes(match.gitUrl) && payload.repository && payload.repository.full_name && !match.gitUrl.includes(payload.repository.full_name)) continue;
    app.locals.worker.queue(d.id, 'webhook').catch(() => {});
    store.saveRun({ deploymentId: d.id, trigger: 'webhook', branch, status: 'queued' });
    queued.push(d.id);
  }
  res.json({ queued });
});
```

Also: `PUT /api/fleet/products/:id` must accept `webhookSecretRef` (string ≤128, must match /^[A-Z0-9_]+$/ since it names an env var). Add that to the PUT whitelist.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/webhook.test.js --verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/server.js fleet/webhook.test.js
git commit -m "feat(fleet): github webhook auto-deploy on branch push"
```

### Task 5: UI — Deploy buttons, history drawer, webhook field

**Files:**
- Modify: `fleet/public/index.html`
- Test: `fleet/ui.test.js` (extend string checks)

**Interfaces:**
- Consumes: Task 1 history endpoints, Task 3 deploy/retry endpoints, Task 4 webhook field.
- Produces: enabled Deploy button per deployment, history list in drawer with reason + Retry, webhook secret ref input in product edit, queue position indicator.

- [ ] **Step 1: Write the failing check**

```js
test('deploy buttons, history and retry wiring present', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-deploy');
  expect(html).toMatch('data-retry');
  expect(html).toMatch('/deploy');
  expect(html).toMatch('webhookSecretRef');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/ui.test.js --verbose`
Expected: FAIL (no `data-deploy` yet)

- [ ] **Step 3: Write minimal implementation**

```js
// Deployments table: add Deploy button per row:
`<button class="btn small" data-deploy="${d.id}">Deploy</button>`
document.querySelectorAll('[data-deploy]').forEach(b=>b.onclick=async()=>{
  const r=await fetch('/api/fleet/deployments/'+b.dataset.deploy+'/deploy',{method:'POST'});
  r.ok?(toast('Deploy queued.'),refresh()):toast('Could not queue.');
});
// Drawer: fetch runs and render history with reason + Retry:
async function renderHistory(deploymentId){
  const runs=await api.get('/api/fleet/deployments/'+deploymentId+'/runs');
  return runs.map(r=>`<div class="mono">${r.startedAt||''} · ${r.trigger||''} · ${r.status}${r.reason?' · '+r.reason:''}${r.status==='failed'?` <button class="btn ghost small" data-retry="${r.id}">Retry</button>`:''}</div>`).join('')||'<p class="dim">No runs yet.</p>';
}
// Retry handler (delegate after drawer render):
document.addEventListener('click',async e=>{
  const b=e.target.closest&&e.target.closest('[data-retry]');if(!b)return;
  const r=await fetch('/api/fleet/runs/'+b.dataset.retry+'/retry',{method:'POST'});
  r.ok?(toast('Retry queued.'),refresh()):toast('Could not retry.');
});
// Product edit form: add webhookSecretRef input (env var name), saved via existing PUT.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/ --verbose`
Expected: PASS (all suites)

- [ ] **Step 5: Commit**

```bash
git add fleet/public/index.html fleet/ui.test.js
git commit -m "feat(fleet): deploy buttons, run history with retry, webhook field"
```
