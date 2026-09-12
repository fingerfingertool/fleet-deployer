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
function createStore(file) {
  let data = { products: [], hosts: [], deployments: [] };
  const loaded = loadFile(file);
  if (loaded && typeof loaded === 'object') {
    data = {
      products: Array.isArray(loaded.products) ? loaded.products : [],
      hosts: Array.isArray(loaded.hosts) ? loaded.hosts : [],
      deployments: Array.isArray(loaded.deployments) ? loaded.deployments : [],
    };
  }
  function persist() { if (file !== ':memory:') fs.writeFileSync(file, JSON.stringify(data, null, 2)); }
  return {
    listProducts: () => data.products,
    getProduct: (id) => data.products.find(x => x.id === id),
    saveProduct: (p) => { p.id = p.id || newId('p'); data.products = [...data.products.filter(x => x.id !== p.id), p]; persist(); return p; },
    listHosts: () => data.hosts,
    getHost: (id) => data.hosts.find(x => x.id === id),
    saveHost: (h) => { h.id = h.id || newId('h'); data.hosts = [...data.hosts.filter(x => x.id !== h.id), h]; persist(); return h; },
    listDeployments: () => data.deployments,
    saveDeployment: (d) => { d.id = d.id || newId('d'); data.deployments = [...data.deployments.filter(x => x.id !== d.id), d]; persist(); return d; },
  };
}
module.exports = { createStore };
