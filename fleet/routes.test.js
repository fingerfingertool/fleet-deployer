const request = require('supertest');
const { buildApp } = require('./server');
test('creates deployment in draft', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git', defaultBranch: 'main' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'vds1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'shop.example.com' })).body;
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id, envValues: {} });
  expect(d.status).toBe(201);
  expect(d.body.status).toBe('draft');
  expect(d.body.branch).toBe('main');
  expect(d.body.domain).toBe('shop.example.com');
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
  const d1 = await request(app).post('/api/fleet/deployments').send({ productId: 'p_nope', targetId: 't_nope' });
  expect(d1.status).toBe(400);
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const d2 = await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: 't_nope' });
  expect(d2.status).toBe(400);
});
test('double binding same target rejected', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  expect((await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id })).status).toBe(201);
  expect((await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id })).status).toBe(409);
});
test('delete target blocked while bound', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id });
  expect((await request(app).delete('/api/fleet/targets/' + t.id)).status).toBe(409);
});
test('target domain editable via PUT', async () => {
  const app = buildApp(':memory:');
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  const u = await request(app).put('/api/fleet/targets/' + t.id).send({ domain: 'b.example.com' });
  expect(u.status).toBe(200);
  expect(u.body.domain).toBe('b.example.com');
  expect((await request(app).put('/api/fleet/targets/' + t.id).send({ domain: 'not a domain!!' })).status).toBe(400);
});
test('status spoof ignored', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'shop', gitUrl: 'https://x/y.git' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'vds1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'shop.example.com' })).body;
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id, status: 'live', currentCommit: 'abc123' });
  expect(d.status).toBe(201);
  expect(d.body.status).toBe('draft');
  expect(d.body.currentCommit).toBeNull();
});
test('creates static-sftp target and deployment via targetId', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git', buildConfig: { command: 'npm run build', outputDir: 'dist' } })).body;
  expect(p.buildConfig.outputDir).toBe('dist');
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'cp1', kind: 'static-sftp', host: 'cp.example.com', username: 'u', remoteDir: '/public_html', domain: 'shop.example.com' })).body;
  expect(t.id).toBeTruthy();
  const d = await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id });
  expect(d.status).toBe(201);
  expect(d.body.targetId).toBe(t.id);
});
test('rejects key material on targets', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/targets').send({ name: 'x', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'x.example.com', privateKey: 'SECRET' });
  expect(r.status).toBe(201);
  expect(r.body.privateKey).toBeUndefined();
});
test('target requires domain', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/targets').send({ name: 'x', kind: 'vds', ip: '1.2.3.4', sshUser: 'root' });
  expect(r.status).toBe(400);
});
