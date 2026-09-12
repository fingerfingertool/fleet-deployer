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
    const product = { name, gitUrl, defaultBranch: defaultBranch || 'main' };
    res.status(201).json(store.saveProduct(product));
  });
  app.post('/api/fleet/hosts', (req, res) => {
    const { name, ip, sshUser, sshKeyPath } = req.body || {};
    if (!name || !ip || !sshUser) return res.status(400).json({ error: 'name, ip, sshUser required' });
    // Never persist key material: accept only sshKeyPath (string, max 512)
    let keyPath;
    if (sshKeyPath !== undefined) {
      if (typeof sshKeyPath !== 'string' || sshKeyPath.length > 512) {
        return res.status(400).json({ error: 'sshKeyPath must be a string of max 512 chars' });
      }
      keyPath = sshKeyPath;
    }
    const host = { name, ip, sshUser };
    if (keyPath !== undefined) host.sshKeyPath = keyPath;
    // Explicitly strip sshKey / privateKey even if present in body — never saved
    res.status(201).json(store.saveHost(host));
  });
  app.post('/api/fleet/deployments', (req, res) => {
    const { productId, branch, vdsId, domain, envValues } = req.body || {};
    if (!productId || !branch || !vdsId || !domain) return res.status(400).json({ error: 'productId, branch, vdsId, domain required' });
    // FK checks
    if (!store.getProduct(productId)) return res.status(400).json({ error: 'unknown productId' });
    if (!store.getHost(vdsId)) return res.status(400).json({ error: 'unknown vdsId' });
    // Mass-assignment guard: whitelist fields, force status/currentCommit
    const deployment = {
      productId, branch, vdsId, domain,
      envValues: (envValues && typeof envValues === 'object') ? envValues : {},
      status: 'draft',
      currentCommit: null,
    };
    res.status(201).json(store.saveDeployment(deployment));
  });
  app.get('/api/fleet/deployments', (req, res) => res.json(store.listDeployments()));
  app.get('/api/fleet/products', (req, res) => res.json(store.listProducts()));
  app.get('/api/fleet/hosts', (req, res) => res.json(store.listHosts()));
  return app;
}
module.exports = { buildApp };
