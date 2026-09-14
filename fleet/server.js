const express = require('express');
const crypto = require('crypto');
const { createStore, createPgStore } = require('./store');
const { createWorker } = require('./worker');
const ALLOWED_KINDS = ['vds', 'static-sftp'];
function basicAuth(req, res, next) {
  const user = process.env.FLEET_USER, pass = process.env.FLEET_PASS;
  if (!user || !pass) return next();
  const hdr = req.headers.authorization || '';
  const [scheme, encoded] = hdr.split(' ');
  let ok = false;
  if (scheme === 'Basic' && encoded) {
    const [u, ...rest] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    ok = u === user && rest.join(':') === pass;
  }
  if (!ok) {
    res.set('WWW-Authenticate', 'Basic realm="Fleet Harbor"');
    return res.status(401).json({ error: 'auth required' });
  }
  next();
}
// Express 4 does not catch async throws — wrap all async handlers.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
function buildApp(file) {
  const dbFile = file || 'fleet.json';
  const store = process.env.DATABASE_URL ? createPgStore(process.env.DATABASE_URL, dbFile) : createStore(dbFile);
  const app = express();
  app.use('/api/fleet/webhooks/github', express.raw({ type: 'application/json' }));
  app.use(express.json());
  app.get('/api/fleet/health', (req, res) => res.json({ ok: true }));
  app.post('/api/fleet/webhooks/github', ah(async (req, res) => {
    const event = req.headers['x-github-event'];
    if (event === 'ping') return res.json({ ok: true });
    if (event !== 'push') return res.json({ ignored: true });
    const raw = req.body; // Buffer from express.raw
    const products = await store.listProducts();
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
    for (const d of (await store.listDeployments()).filter(x => x.productId === match.id && (match.defaultBranch || 'main') === branch)) {
      if (match.gitUrl && !urls.includes(match.gitUrl) && payload.repository && payload.repository.full_name && !match.gitUrl.includes(payload.repository.full_name)) continue;
      app.locals.worker.queue(d.id, 'webhook').catch(() => {});
      queued.push(d.id);
    }
    res.json({ queued });
  }));
  app.use('/api/fleet', basicAuth);
  app.post('/api/fleet/products', ah(async (req, res) => {
    const { name, gitUrl, defaultBranch, buildConfig, repoKeyPath } = req.body || {};
    if (!name || !gitUrl) return res.status(400).json({ error: 'name and gitUrl required' });
    const product = { name, gitUrl, defaultBranch: defaultBranch || 'main' };
    if (repoKeyPath !== undefined && repoKeyPath !== null && repoKeyPath !== '') {
      if (typeof repoKeyPath !== 'string' || repoKeyPath.length > 512) return res.status(400).json({ error: 'repoKeyPath must be a path of max 512 chars' });
      product.repoKeyPath = repoKeyPath;
    }
    if (buildConfig !== undefined) {
      if (typeof buildConfig !== 'object' || buildConfig === null) return res.status(400).json({ error: 'invalid buildConfig' });
      const { command, outputDir } = buildConfig;
      if (command !== undefined && (typeof command !== 'string' || command.length > 256)) return res.status(400).json({ error: 'invalid buildConfig.command' });
      if (outputDir !== undefined && (typeof outputDir !== 'string' || outputDir.length > 256 || outputDir.includes('..'))) return res.status(400).json({ error: 'invalid buildConfig.outputDir' });
      product.buildConfig = {};
      if (command !== undefined) product.buildConfig.command = command;
      if (outputDir !== undefined) product.buildConfig.outputDir = outputDir;
    }
    res.status(201).json(await store.saveProduct(product));
  }));
  app.get('/api/fleet/products/:id/branches', ah(async (req, res) => {
    const p = await store.getProduct(req.params.id);
    if (!p) return res.status(404).json({ error: 'unknown product' });
    const { execFile } = require('child_process');
    const env = { ...process.env };
    if (p.repoKeyPath) {
      if (typeof p.repoKeyPath !== 'string' || p.repoKeyPath.length > 512) return res.status(400).json({ error: 'invalid repoKeyPath' });
      env.GIT_SSH_COMMAND = `ssh -i ${p.repoKeyPath} -o StrictHostKeyChecking=no -o BatchMode=yes`;
    }
    execFile('git', ['ls-remote', '--heads', p.gitUrl], { env, timeout: 20000 }, (err, stdout) => {
      if (err) return res.status(502).json({ error: 'could not list branches' });
      const branches = stdout.split('\n').filter(Boolean).map(l => l.split('	')[1].replace('refs/heads/', ''));
      res.json({ branches });
    });
  }));
  app.put('/api/fleet/products/:id', ah(async (req, res) => {
    const p = await store.getProduct(req.params.id);
    if (!p) return res.status(404).json({ error: 'unknown product' });
    const { name, gitUrl, defaultBranch, buildConfig, repoKeyPath, webhookSecretRef } = req.body || {};
    if (name !== undefined) p.name = name;
    if (gitUrl !== undefined) p.gitUrl = gitUrl;
    if (defaultBranch !== undefined) p.defaultBranch = defaultBranch || 'main';
    if (buildConfig !== undefined) {
      if (typeof buildConfig !== 'object' || buildConfig === null) return res.status(400).json({ error: 'invalid buildConfig' });
      p.buildConfig = {};
      if (buildConfig.command !== undefined) {
        if (typeof buildConfig.command !== 'string' || buildConfig.command.length > 256) return res.status(400).json({ error: 'invalid buildConfig.command' });
        p.buildConfig.command = buildConfig.command;
      }
      if (buildConfig.outputDir !== undefined) {
        if (typeof buildConfig.outputDir !== 'string' || buildConfig.outputDir.length > 256 || buildConfig.outputDir.includes('..')) return res.status(400).json({ error: 'invalid buildConfig.outputDir' });
        p.buildConfig.outputDir = buildConfig.outputDir;
      }
    }
    if (repoKeyPath !== undefined) {
      if (repoKeyPath !== null && (typeof repoKeyPath !== 'string' || repoKeyPath.length > 512)) return res.status(400).json({ error: 'repoKeyPath must be a path of max 512 chars' });
      if (repoKeyPath) p.repoKeyPath = repoKeyPath; else delete p.repoKeyPath;
    }
    if (req.body.publish !== undefined) {
      const pub = req.body.publish;
      if (typeof pub !== 'object' || pub === null) return res.status(400).json({ error: 'invalid publish' });
      if (pub.strategy !== undefined && pub.strategy !== 'ftp-static') return res.status(400).json({ error: 'unsupported publish strategy' });
      for (const f of ['buildCommand', 'sourceDir']) {
        if (pub[f] !== undefined && pub[f] !== null && (typeof pub[f] !== 'string' || pub[f].length > 256)) return res.status(400).json({ error: 'invalid publish.' + f });
      }
      for (const f of ['extraFiles', 'exclude']) {
        if (pub[f] !== undefined && (!Array.isArray(pub[f]) || pub[f].some(x => typeof x !== 'string' || x.length > 256))) return res.status(400).json({ error: 'invalid publish.' + f });
      }
      p.publish = pub;
    }
    if (webhookSecretRef !== undefined) {
      if (typeof webhookSecretRef !== 'string' || webhookSecretRef.length > 128 || !/^[A-Z0-9_]+$/.test(webhookSecretRef)) return res.status(400).json({ error: 'invalid webhookSecretRef' });
      p.webhookSecretRef = webhookSecretRef;
    }
    const { privateKey, sshKey, password, keyMaterial, ...rest } = p;
    res.json(await store.saveProduct(rest));
  }));
  app.delete('/api/fleet/products/:id', ah(async (req, res) => {
    if (!(await store.getProduct(req.params.id))) return res.status(404).json({ error: 'unknown product' });
    if ((await store.listDeployments()).some(d => d.productId === req.params.id)) return res.status(409).json({ error: 'product has deployments' });
    await store.deleteProduct(req.params.id);
    res.status(204).end();
  }));
  app.post('/api/fleet/hosts', ah(async (req, res) => {
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
    res.status(201).json(await store.saveHost(host));
  }));
  function validateDomain(v) {
    if (typeof v !== 'string' || v.length === 0 || v.length > 253) return false;
    return v.split('.').every((l) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(l));
  }
  function validateTarget(body) {
    const { kind } = body || {};
    if (!ALLOWED_KINDS.includes(kind)) return 'kind must be one of vds, static-sftp';
    if (!body.name) return 'name required';
    if (!validateDomain(body.domain)) return 'valid domain required (one target serves one domain)';
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
  app.get('/api/fleet/targets', ah(async (req, res) => res.json(await store.listTargets())));
  app.get('/api/fleet/targets/:id', ah(async (req, res) => {
    const t = await store.getTarget(req.params.id);
    if (!t) return res.status(404).json({ error: 'unknown target' });
    res.json(t);
  }));
  app.post('/api/fleet/targets', ah(async (req, res) => {
    const err = validateTarget(req.body || {});
    if (err) return res.status(400).json({ error: err });
    const { privateKey, sshKey, password, keyMaterial, ...rest } = req.body;
    try {
      res.status(201).json(await store.saveTarget(rest));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));
  app.put('/api/fleet/targets/:id', ah(async (req, res) => {
    const t = await store.getTarget(req.params.id);
    if (!t) return res.status(404).json({ error: 'unknown target' });
    const { name, domain, sshKeyPath } = req.body || {};
    if (name !== undefined) t.name = name;
    if (domain !== undefined) {
      if (!validateDomain(domain)) return res.status(400).json({ error: 'invalid domain' });
      t.domain = domain;
    }
    for (const f of ['ip', 'sshUser', 'host', 'username', 'remoteDir', 'providerLabel']) {
      if (req.body[f] !== undefined) t[f] = req.body[f];
    }
    if (sshKeyPath !== undefined) {
      if (typeof sshKeyPath !== 'string' || sshKeyPath.length > 512) return res.status(400).json({ error: 'sshKeyPath must be a string of max 512 chars' });
      t.sshKeyPath = sshKeyPath;
    }
    const { privateKey, sshKey, password, keyMaterial, ...rest } = t;
    try {
      res.json(await store.saveTarget(rest));
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }));
  app.delete('/api/fleet/targets/:id', ah(async (req, res) => {
    if ((await store.listDeployments()).some(d => (d.targetId || d.vdsId) === req.params.id)) return res.status(409).json({ error: 'target has deployments' });
    await store.deleteTarget(req.params.id);
    res.status(204).end();
  }));
  app.post('/api/fleet/deployments', ah(async (req, res) => {
    const { productId, vdsId, targetId, envValues } = req.body || {};
    const tid = targetId || vdsId;
    if (!productId || !tid) return res.status(400).json({ error: 'productId and targetId required' });
    // FK checks
    const product = await store.getProduct(productId);
    if (!product) return res.status(400).json({ error: 'unknown productId' });
    const target = (await store.getTarget(tid)) || (await store.getHost(tid));
    if (!target) return res.status(400).json({ error: 'unknown target' });
    if (!target.domain) return res.status(400).json({ error: 'target has no domain' });
    // 1:1 binding: one target serves one product
    if ((await store.listDeployments()).some(d => (d.targetId || d.vdsId) === tid)) return res.status(409).json({ error: 'target already bound' });
    // Product is repo+branch; binding inherits both plus the target domain
    const deployment = {
      productId, branch: product.defaultBranch || 'main', targetId: tid, vdsId: tid, domain: target.domain,
      envValues: (envValues && typeof envValues === 'object') ? envValues : {},
      status: 'draft',
      currentCommit: null,
    };
    res.status(201).json(await store.saveDeployment(deployment));
  }));
  app.get('/api/fleet/deployments', ah(async (req, res) => {
    const w = app.locals.worker;
    const list = await store.listDeployments();
    res.json(list.map((d) => {
      if ((d.status === 'queued' || d.status === 'running') && w && typeof w.queueLength === 'function') {
        try {
          const n = w.queueLength(d.targetId || d.vdsId);
          if (n != null) return { ...d, queuePosition: n };
        } catch {}
      }
      return d;
    }));
  }));
  app.get('/api/fleet/deployments/:id/runs', ah(async (req, res) => {
    const d = (await store.listDeployments()).find(x => x.id === req.params.id);
    if (!d) return res.status(404).json({ error: 'unknown deployment' });
    res.json(await store.runsForDeployment(req.params.id));
  }));
  app.get('/api/fleet/runs/:runId', ah(async (req, res) => {
    const r = await store.getRun(req.params.runId);
    if (!r) return res.status(404).json({ error: 'unknown run' });
    res.json(r);
  }));
  app.get('/api/fleet/runs', ah(async (req, res) => {
    res.json((await store.listRuns()).slice().sort((a, b) => (b.startedAt || '').localeCompare(a.startedAt || '')));
  }));
  app.put('/api/fleet/deployments/:id', ah(async (req, res) => {
    const d = await store.getDeployment(req.params.id);
    if (!d) return res.status(404).json({ error: 'unknown deployment' });
    if (req.body.productId !== undefined) {
      const p = await store.getProduct(req.body.productId);
      if (!p) return res.status(400).json({ error: 'unknown productId' });
      d.productId = p.id;
      d.branch = p.defaultBranch || 'main';
    }
    res.json(await store.saveDeployment(d));
  }));
  app.delete('/api/fleet/deployments/:id', ah(async (req, res) => {
    if (!(await store.getDeployment(req.params.id))) return res.status(404).json({ error: 'unknown deployment' });
    await store.deleteDeployment(req.params.id);
    res.status(204).end();
  }));
  app.get('/api/fleet/products', ah(async (req, res) => res.json(await store.listProducts())));
  app.get('/api/fleet/hosts', ah(async (req, res) => res.json(await store.listHosts())));
  const worker = createWorker(store);
  app.locals.store = store;
  app.locals.worker = worker;
  app.post('/api/fleet/deployments/:id/deploy', ah(async (req, res) => {
    const d = await store.getDeployment(req.params.id);
    if (!d) return res.status(404).json({ error: 'unknown deployment' });
    app.locals.worker.queue(d.id, 'manual').catch(() => {});
    res.status(202).json({ queued: true });
  }));
  app.post('/api/fleet/runs/:runId/retry', ah(async (req, res) => {
    const r = await store.getRun(req.params.runId);
    if (!r) return res.status(404).json({ error: 'unknown run' });
    if (r.status !== 'failed') return res.status(400).json({ error: 'only failed runs can be retried' });
    app.locals.worker.queue(r.deploymentId, 'retry', r.id).catch(() => {});
    res.status(202).json({ queued: true, retryOf: r.id });
  }));
  return app;
}
module.exports = { buildApp, basicAuth };
