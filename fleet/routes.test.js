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
test('secret key material is not persisted', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/hosts').send({
    name: 'vds1', ip: '1.2.3.4', sshUser: 'root',
    sshKey: '-----BEGIN SECRET-----', privateKey: 'TOPSECRET',
    sshKeyPath: '/root/.ssh/id_ed25519',
  });
  expect(r.status).toBe(201);
  expect(r.body.sshKey).toBeUndefined();
  expect(r.body.privateKey).toBeUndefined();
  expect(r.body.sshKeyPath).toBe('/root/.ssh/id_ed25519');
  expect(JSON.stringify(r.body)).not.toMatch(/SECRET/);
});
test('bad FK rejected', async () => {
  const app = buildApp(':memory:');
  const d1 = await request(app).post('/api/fleet/deployments').send({ productId: 'p_nope', branch: 'main', vdsId: 'h_nope', domain: 'x.example.com' });
  expect(d1.status).toBe(400);
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const d2 = await request(app).post('/api/fleet/deployments').send({ productId: p.id, branch: 'main', vdsId: 'h_nope', domain: 'x.example.com' });
  expect(d2.status).toBe(400);
});
test('status spoof ignored', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const h = (await request(app).post('/api/fleet/hosts').send({ name: 'vds1', ip: '1.2.3.4', sshUser: 'root' })).body;
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, branch: 'main', vdsId: h.id, domain: 'shop.example.com', status: 'live', currentCommit: 'abc123' });
  expect(d.status).toBe(201);
  expect(d.body.status).toBe('draft');
  expect(d.body.currentCommit).toBeNull();
});
