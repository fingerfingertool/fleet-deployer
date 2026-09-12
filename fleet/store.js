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
  let data = { products: [], hosts: [], deployments: [], targets: [] };
  const loaded = loadFile(file);
  if (loaded && typeof loaded === 'object') {
    data = {
      products: Array.isArray(loaded.products) ? loaded.products : [],
      hosts: Array.isArray(loaded.hosts) ? loaded.hosts : [],
      deployments: Array.isArray(loaded.deployments) ? loaded.deployments : [],
      targets: Array.isArray(loaded.targets) ? loaded.targets : [],
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
  function persist() { if (file !== ':memory:') fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  return {
    listProducts: () => data.products,
    getProduct: (id) => data.products.find(x => x.id === id),
    saveProduct: (p) => { withBuildDefaults(p); p.id = p.id || newId('p'); data.products = [...data.products.filter(x => x.id !== p.id), p]; persist(); return p; },
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
    saveDeployment: (d) => { d.id = d.id || newId('d'); data.deployments = [...data.deployments.filter(x => x.id !== d.id), d]; persist(); return d; },
  };
}
module.exports = { createStore };
