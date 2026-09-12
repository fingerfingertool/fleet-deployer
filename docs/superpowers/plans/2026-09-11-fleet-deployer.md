# Fleet Deployer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build v1 admin panel that deploys any branch of any connected git repo to any manually-added VDS with drift guard and hotfix propagate.

**Architecture:** Agentless SSH playbook from a Node/Express monolith; JSON-file store v1 (same pattern as server.js domains.json) to avoid new infra, upgrade to Postgres later. Caddy on targets for auto-HTTPS.

**Tech Stack:** Node 20, Express 4, ssh2, node-pty-less job runner (in-process queue, BullMQ later), Caddy on VDS, Docker Compose on VDS, Jest/Supertest for tests.

**Spec:** docs/superpowers/specs/2026-09-11-fleet-deployer-design.md

## Global Constraints

- Any branch = reskin; deploy any branch to any VDS.
- No code edits on VDS; dirty worktree blocks deploy; drift flagged.
- Manual DNS v1; panel only writes Caddy + healthchecks.
- SSH keys encrypted at rest, never in logs.
- Concurrent deploys per VDS serialized.

---

### Task 1: Fleet store + API skeleton

**Files:**
- Create: `fleet/store.js`
- Create: `fleet/routes.js`
- Create: `fleet/server.js`
- Test: `fleet/store.test.js`

**Interfaces:**
- Consumes: nothing (standalone, mounts at :3100).
- Produces: `createStore(filePath)` -> `{listProducts, saveProduct, listHosts, saveHost, listDeployments, saveDeployment}`; `GET /api/fleet/health` -> `{ok:true}`.

- [ ] **Step 1: Write the failing test**

```js
const { createStore } = require('./store');
test('saves product with defaultBranch', () => {
  const s = createStore(':memory:');
  const p = s.saveProduct({ name: 'shop', gitUrl: 'https://github.com/x/shop.git', defaultBranch: 'main' });
  expect(p.id).toBeTruthy();
  expect(s.listProducts().length).toBe(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/store.test.js -v`
Expected: FAIL with "Cannot find module './store'"

- [ ] **Step 3: Write minimal implementation**

```js
const fs = require('fs');
function createStore(file) {
  let data = { products: [], hosts: [], deployments: [] };
  if (file !== ':memory:' && fs.existsSync(file)) data = JSON.parse(fs.readFileSync(file, 'utf8'));
  function persist() { if (file !== ':memory:') fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  return {
    listProducts: () => data.products,
    saveProduct: (p) => { p.id = p.id || ('p_' + Date.now()); data.products = [...data.products.filter(x => x.id !== p.id), p]; persist(); return p; },
    listHosts: () => data.hosts,
    saveHost: (h) => { h.id = h.id || ('h_' + Date.now()); data.hosts = [...data.hosts.filter(x => x.id !== h.id), h]; persist(); return h; },
    listDeployments: () => data.deployments,
    saveDeployment: (d) => { d.id = d.id || ('d_' + Date.now()); data.deployments = [...data.deployments.filter(x => x.id !== d.id), d]; persist(); return d; },
  };
}
module.exports = { createStore };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/store.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/store.js fleet/store.test.js
git commit -m "feat(fleet): file store for products hosts deployments"
```

### Task 2: Products + VDS + Deployments CRUD API

**Files:**
- Modify: `fleet/routes.js`
- Modify: `fleet/server.js`
- Test: `fleet/routes.test.js`

**Interfaces:**
- Consumes: `createStore` from Task 1.
- Produces: `POST /api/fleet/products {name,gitUrl,defaultBranch,composePath,envSchema}`, `POST /api/fleet/hosts {name,ip,sshUser,providerLabel}`, `POST /api/fleet/deployments {productId,branch,vdsId,domain,envValues}` with status `draft`.

- [ ] **Step 1: Write the failing test**

```js
const request = require('supertest');
const { buildApp } = require('./server');
test('creates deployment in draft', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git', defaultBranch: 'main' })).body;
  const h = (await request(app).post('/api/fleet/hosts').send({ name: 'vds1', ip: '1.2.3.4', sshUser: 'root' })).body;
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, branch: 'main', vdsId: h.id, domain: 'shop.example.com', envValues: {} });
  expect(d.status).toBe(201);
  expect(d.body.status).toBe('draft');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/routes.test.js -v`
Expected: FAIL with "Cannot find module './server'"

- [ ] **Step 3: Write minimal implementation**

```js
const express = require('express');
const { createStore } = require('./store');
function buildApp(file) {
  const store = createStore(file || 'fleet.json');
  const app = express();
  app.use(express.json());
  app.get('/api/fleet/health', (req, res) => res.json({ ok: true }));
  app.post('/api/fleet/products', (req, res) => {
    const { name, gitUrl, defaultBranch } = req.body || {};
    if (!name || !gitUrl) return res.status(400).json({ error: 'name and gitUrl required' });
    res.status(201).json(store.saveProduct({ ...req.body, defaultBranch: defaultBranch || 'main' }));
  });
  app.post('/api/fleet/hosts', (req, res) => {
    const { name, ip, sshUser } = req.body || {};
    if (!name || !ip || !sshUser) return res.status(400).json({ error: 'name, ip, sshUser required' });
    res.status(201).json(store.saveHost(req.body));
  });
  app.post('/api/fleet/deployments', (req, res) => {
    const { productId, branch, vdsId, domain } = req.body || {};
    if (!productId || !branch || !vdsId || !domain) return res.status(400).json({ error: 'productId, branch, vdsId, domain required' });
    res.status(201).json(store.saveDeployment({ ...req.body, envValues: req.body.envValues || {}, status: 'draft', currentCommit: null }));
  });
  app.get('/api/fleet/deployments', (req, res) => res.json(store.listDeployments()));
  return app;
}
module.exports = { buildApp };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/routes.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/routes.js fleet/server.js fleet/routes.test.js
git commit -m "feat(fleet): products vds deployments CRUD"
```

### Task 3: Agentless SSH deploy playbook (mock SSH in tests)

**Files:**
- Create: `fleet/deployer.js`
- Test: `fleet/deployer.test.js`

**Interfaces:**
- Consumes: deployment `{product gitUrl, branch, domain, envValues}`, host `{ip, sshUser}`.
- Produces: `async deploy(dep, host, ssh)` -> `{commitSha, log}`; `buildCommands(dep)` -> string[] of remote shell commands (fetch+checkout, compose up, caddy write+reload, healthcheck). Drift: `detectDrift(remoteSha, expectedSha)` -> boolean.

- [ ] **Step 1: Write the failing test**

```js
const { buildCommands, detectDrift } = require('./deployer');
test('checkout branch and compose up', () => {
  const cmds = buildCommands({ gitUrl: 'https://x/y.git', branch: 'reskin-acme', domain: 'a.example.com' });
  expect(cmds.join('\n')).toMatch('reskin-acme');
  expect(cmds.join('\n')).toMatch('docker compose up -d --build');
});
test('drift when sha differs', () => { expect(detectDrift('aaa', 'bbb')).toBe(true); });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/deployer.test.js -v`
Expected: FAIL with "Cannot find module './deployer'"

- [ ] **Step 3: Write minimal implementation**

```js
function buildCommands(dep) {
  return [
    `if [ ! -d /opt/fleet/app ]; then git clone ${dep.gitUrl} /opt/fleet/app; fi`,
    `cd /opt/fleet/app && git fetch origin && git checkout ${dep.branch} && git pull --ff-only origin ${dep.branch}`,
    `if ! git diff --quiet; then echo DIRTY_WORKTREE && exit 43; fi`,
    `cd /opt/fleet/app && docker compose up -d --build`,
    `printf '${dep.domain} {\\n reverse_proxy 127.0.0.1:3000\\n}' > /etc/caddy/sites/${dep.domain}.Caddyfile && caddy reload --config /etc/caddy/Caddyfile`,
    `curl -fsS https://${dep.domain}/api/health || curl -fsS http://127.0.0.1:3000/api/health`,
  ];
}
function detectDrift(remoteSha, expectedSha) { return remoteSha !== expectedSha; }
module.exports = { buildCommands, detectDrift };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/deployer.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/deployer.js fleet/deployer.test.js
git commit -m "feat(fleet): agentless deploy playbook with drift guard"
```

### Task 4: Hotfix propagate + minimal UI

**Files:**
- Create: `fleet/propagate.js`
- Create: `fleet/public/index.html`
- Test: `fleet/propagate.test.js`

**Interfaces:**
- Consumes: deployments list with `{branch, currentCommit}` + `mainHead` sha.
- Produces: `planPropagate(deps, mainHead)` -> `[{deploymentId, behind: true/false}]`; UI page listing deployments with Deploy/Redeploy buttons (fetch to API).

- [ ] **Step 1: Write the failing test**

```js
const { planPropagate } = require('./propagate');
test('flags behind deployments', () => {
  const plan = planPropagate([{ id: 'd1', currentCommit: 'aaa' }, { id: 'd2', currentCommit: 'zzz' }], 'zzz');
  expect(plan.find(p => p.deploymentId === 'd1').behind).toBe(true);
  expect(plan.find(p => p.deploymentId === 'd2').behind).toBe(false);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest fleet/propagate.test.js -v`
Expected: FAIL with "Cannot find module './propagate'"

- [ ] **Step 3: Write minimal implementation**

```js
function planPropagate(deps, mainHead) {
  return deps.map(d => ({ deploymentId: d.id, behind: d.currentCommit !== mainHead }));
}
module.exports = { planPropagate };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest fleet/propagate.test.js -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add fleet/propagate.js fleet/propagate.test.js fleet/public/index.html
git commit -m "feat(fleet): hotfix propagate plan plus admin UI"
```
