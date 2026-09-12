const express = require('express');
const { createStore } = require('./store');
const ALLOWED_KINDS = ['vds', 'static-sftp'];
function buildApp(file) {
  const store = createStore(file || 'fleet.json');
  const app = express();
  app.use(express.json());
  app.get('/api/fleet/health', (req, res) => res.json({ ok: true }));
  app.post('/api/fleet/products', (req, res) => {
    const { name, gitUrl, defaultBranch, buildConfig } = req.body || {};
    if (!name || !gitUrl) return res.status(400).json({ error: 'name and gitUrl required' });
    const product = { name, gitUrl, defaultBranch: defaultBranch || 'main' };
    if (buildConfig !== undefined) {
      if (typeof buildConfig !== 'object' || buildConfig === null) return res.status(400).json({ error: 'invalid buildConfig' });
      const { command, outputDir } = buildConfig;
      if (command !== undefined && (typeof command !== 'string' || command.length > 256)) return res.status(400).json({ error: 'invalid buildConfig.command' });
      if (outputDir !== undefined && (typeof outputDir !== 'string' || outputDir.length > 256 || outputDir.includes('..'))) return res.status(400).json({ error: 'invalid buildConfig.outputDir' });
      product.buildConfig = {};
      if (command !== undefined) product.buildConfig.command = command;
      if (outputDir !== undefined) product.buildConfig.outputDir = outputDir;
    }
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
  function validateTarget(body) {
    const { kind } = body || {};
    if (!ALLOWED_KINDS.includes(kind)) return 'kind must be one of vds, static-sftp';
    if (!body.name) return 'name required';
    if (kind === 'vds') {
      if (!body.ip || !body.sshUser) return 'vds requires name, ip, sshUser';
    } else {
      if (!body.host || !body.username || !body.remoteDir) return 'static-sftp requires name, host, username, remoteDir';
    }
    for (const f of ['sshKeyPath', 'keyPath']) {
      if (body[f] !== undefined && (typeof body[f] !== 'string' || body[f].length > 512)) return f + ' must be a string of max 512 chars';
    }
    return null;
  }
  app.get('/api/fleet/targets', (req, res) => res.json(store.listTargets()));
  app.get('/api/fleet/targets/:id', (req, res) => {
    const t = store.getTarget(req.params.id);
    if (!t) return res.status(404).json({ error: 'unknown target' });
    res.json(t);
  });
  app.post('/api/fleet/targets', (req, res) => {
    const err = validateTarget(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const { privateKey, sshKey, password, keyMaterial, ...rest } = req.body;
    try {
      res.status(201).json(store.saveTarget(rest));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });
  app.delete('/api/fleet/targets/:id', (req, res) => {
    store.deleteTarget(req.params.id);
    res.status(204).end();
  });
  app.post('/api/fleet/deployments', (req, res) => {
    const { productId, branch, vdsId, targetId, domain, envValues } = req.body || {};
    const tid = targetId || vdsId;
    if (!productId || !branch || !tid || !domain) return res.status(400).json({ error: 'productId, branch, targetId (or vdsId), domain required' });
    // FK checks
    if (!store.getProduct(productId)) return res.status(400).json({ error: 'unknown productId' });
    if (!(store.getTarget(tid) || store.getHost(tid))) return res.status(400).json({ error: 'unknown target' });
    // Mass-assignment guard: whitelist fields, force status/currentCommit
    const deployment = {
      productId, branch, targetId: tid, vdsId: tid, domain,
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
