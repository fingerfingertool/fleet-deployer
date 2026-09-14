const fs = require('fs');
const crypto = require('crypto');
function newId(prefix) {
  return prefix + '_' + crypto.randomBytes(8).toString('hex');
}
function loadFile(file) {
  try {
    if (file === ':memory:') return null;
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}
const ALLOWED_KINDS = ['vds', 'static-sftp'];
const KEY_MATERIAL_FIELDS = ['privateKey', 'sshKey', 'password', 'keyMaterial'];
function stripKeyMaterial(t) {
  const out = { ...t };
  for (const f of KEY_MATERIAL_FIELDS) delete out[f];
  for (const f of ['sshKeyPath', 'keyPath']) {
    if (typeof out[f] === 'string' && out[f].length > 512) throw new Error('key path too long');
  }
  return out;
}
function withBuildDefaults(p) {
  if (!p.buildConfig || typeof p.buildConfig !== 'object') p.buildConfig = { command: 'npm run build', outputDir: 'dist/' };
  else { p.buildConfig.command = p.buildConfig.command || 'npm run build'; p.buildConfig.outputDir = p.buildConfig.outputDir || 'dist/'; }
  return p;
}
function createStore(file) {
  let data = { products: [], hosts: [], deployments: [], targets: [], runs: [] };
  const loaded = loadFile(file);
  if (loaded && typeof loaded === 'object') {
    data = {
      products: Array.isArray(loaded.products) ? loaded.products : [],
      hosts: Array.isArray(loaded.hosts) ? loaded.hosts : [],
      deployments: Array.isArray(loaded.deployments) ? loaded.deployments : [],
      targets: Array.isArray(loaded.targets) ? loaded.targets : [],
      runs: Array.isArray(loaded.runs) ? loaded.runs : [],
    };
  }
  function ensureTargets() {
    if (!Array.isArray(data.targets)) data.targets = [];
    for (const h of data.hosts) {
      if (!data.targets.some(t => t.migratedFromHostId === h.id)) {
        data.targets.push({ id: h.id, kind: 'vds', name: h.name, ip: h.ip, sshUser: h.sshUser, sshKeyPath: h.sshKeyPath, providerLabel: h.providerLabel, migratedFromHostId: h.id });
      }
    }
  }
  for (const p of data.products) withBuildDefaults(p);
  ensureTargets();
  // Backfill: one target serves one domain — inherit from existing bindings
  for (const d of data.deployments) {
    const t = data.targets.find(x => x.id === (d.targetId || d.vdsId));
    if (t && !t.domain && d.domain) t.domain = d.domain;
  }
  persist();
  function persist() { if (file !== ':memory:') fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  return {
    listProducts: () => data.products,
    getProduct: (id) => data.products.find(x => x.id === id),
    saveProduct: (p) => { withBuildDefaults(p); p.id = p.id || newId('p'); data.products = [...data.products.filter(x => x.id !== p.id), p]; persist(); return p; },
    deleteProduct: (id) => { data.products = data.products.filter(x => x.id !== id); persist(); },
    listHosts: () => data.hosts,
    getHost: (id) => data.hosts.find(x => x.id === id),
    saveHost: (h) => { h.id = h.id || newId('h'); data.hosts = [...data.hosts.filter(x => x.id !== h.id), h]; ensureTargets(); persist(); return h; },
    listTargets: () => data.targets,
    getTarget: (id) => data.targets.find(x => x.id === id),
    saveTarget: (t) => {
      t = stripKeyMaterial({ ...t });
      if (!ALLOWED_KINDS.includes(t.kind)) throw new Error('Invalid target kind: ' + t.kind);
      t.id = t.id || newId('t');
      data.targets = [...data.targets.filter(x => x.id !== t.id), t];
      persist();
      return t;
    },
    deleteTarget: (id) => { data.targets = data.targets.filter(x => x.id !== id); persist(); },
    migrateHostsToTargets: () => { ensureTargets(); persist(); return data.targets; },
    listDeployments: () => data.deployments,
    getDeployment: (id) => data.deployments.find(x => x.id === id),
    deleteDeployment: (id) => { data.deployments = data.deployments.filter(x => x.id !== id); persist(); },
    saveDeployment: (d) => { d.id = d.id || newId('d'); data.deployments = [...data.deployments.filter(x => x.id !== d.id), d]; persist(); return d; },
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
  };
}
module.exports = { createStore, createPgStore };

function createPgStore(url, importFile) {
  const { Pool } = require('pg');
  const pool = url ? new Pool({ connectionString: url }) : new Pool();
  let ready = null;
  function ensureReady() {
    if (!ready) ready = init();
    return ready;
  }
  async function init() {
    await pool.query('CREATE TABLE IF NOT EXISTS fleet_docs (kind TEXT NOT NULL, id TEXT NOT NULL, data JSONB NOT NULL, PRIMARY KEY (kind, id))');
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM fleet_docs');
    if (rows[0].n === 0 && importFile && importFile !== ':memory:') {
      const seed = loadFile(importFile);
      if (seed && typeof seed === 'object') {
        for (const kind of ['products', 'hosts', 'deployments', 'targets', 'runs']) {
          for (const doc of (Array.isArray(seed[kind]) ? seed[kind] : [])) {
            if (doc && doc.id) await pool.query('INSERT INTO fleet_docs (kind, id, data) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [kind, doc.id, doc]);
          }
        }
      }
    }
    await ensureTargetsPg();
    // Backfill target domains from existing bindings (same as file store)
    const deployments = await all('deployments');
    for (const d of deployments) {
      const t = await get('targets', d.targetId || d.vdsId);
      if (t && !t.domain && d.domain) await put('targets', { ...t, domain: d.domain });
    }
  }
  async function all(kind) {
    await ensureReady();
    const { rows } = await pool.query('SELECT data FROM fleet_docs WHERE kind = $1', [kind]);
    return rows.map(r => r.data);
  }
  async function get(kind, id) {
    await ensureReady();
    const { rows } = await pool.query('SELECT data FROM fleet_docs WHERE kind = $1 AND id = $2', [kind, id]);
    return rows[0] ? rows[0].data : undefined;
  }
  async function put(kind, doc) {
    await ensureReady();
    await pool.query('INSERT INTO fleet_docs (kind, id, data) VALUES ($1, $2, $3) ON CONFLICT (kind, id) DO UPDATE SET data = EXCLUDED.data', [kind, doc.id, doc]);
    return doc;
  }
  async function del(kind, id) {
    await ensureReady();
    await pool.query('DELETE FROM fleet_docs WHERE kind = $1 AND id = $2', [kind, id]);
  }
  async function ensureTargetsPg() {
    const [hosts, targets] = await Promise.all([all('hosts'), all('targets')]);
    for (const h of hosts) {
      if (!targets.some(t => t.migratedFromHostId === h.id)) {
        await put('targets', { id: h.id, kind: 'vds', name: h.name, ip: h.ip, sshUser: h.sshUser, sshKeyPath: h.sshKeyPath, providerLabel: h.providerLabel, migratedFromHostId: h.id });
      }
    }
  }
  return {
    listProducts: () => all('products'),
    getProduct: (id) => get('products', id),
    saveProduct: (p) => put('products', withBuildDefaults({ ...p, id: p.id || newId('p') })),
    deleteProduct: (id) => del('products', id),
    listHosts: () => all('hosts'),
    getHost: (id) => get('hosts', id),
    saveHost: async (h) => { const r = await put('hosts', { ...h, id: h.id || newId('h') }); await ensureTargetsPg(); return r; },
    listTargets: () => all('targets'),
    getTarget: (id) => get('targets', id),
    saveTarget: (t) => {
      t = stripKeyMaterial({ ...t });
      if (!ALLOWED_KINDS.includes(t.kind)) throw new Error('Invalid target kind: ' + t.kind);
      return put('targets', { ...t, id: t.id || newId('t') });
    },
    deleteTarget: (id) => del('targets', id),
    migrateHostsToTargets: async () => { await ensureTargetsPg(); return all('targets'); },
    listDeployments: () => all('deployments'),
    getDeployment: (id) => get('deployments', id),
    saveDeployment: (d) => put('deployments', { ...d, id: d.id || newId('d') }),
    deleteDeployment: (id) => del('deployments', id),
    listRuns: () => all('runs'),
    getRun: (id) => get('runs', id),
    saveRun: (r) => put('runs', { ...r, id: r.id || newId('r'), startedAt: r.startedAt || new Date().toISOString() }),
    runsForDeployment: async (deploymentId) => (await all('runs')).filter(x => x.deploymentId === deploymentId).sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')),
  };
}
