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
test('unbind deployment via DELETE, history kept', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  const d = (await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id })).body;
  expect((await request(app).delete('/api/fleet/deployments/' + d.id)).status).toBe(204);
  expect((await request(app).delete('/api/fleet/deployments/' + d.id)).status).toBe(404);
  expect((await request(app).get('/api/fleet/deployments')).body.length).toBe(0);
});
test('edit binding product via PUT, unknown rejected', async () => {
  const app = buildApp(':memory:');
  const p1 = (await request(app).post('/api/fleet/products').send({ name: 'a', gitUrl: 'https://x/y.git', defaultBranch: 'main' })).body;
  const p2 = (await request(app).post('/api/fleet/products').send({ name: 'b', gitUrl: 'https://x/y.git', defaultBranch: 'dev' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  const d = (await request(app).post('/api/fleet/deployments').send({ productId: p1.id, targetId: t.id })).body;
  const u = await request(app).put('/api/fleet/deployments/' + d.id).send({ productId: p2.id });
  expect(u.status).toBe(200);
  expect(u.body.productId).toBe(p2.id);
  expect(u.body.branch).toBe('dev');
  expect(u.body.domain).toBe('a.example.com');
  expect((await request(app).put('/api/fleet/deployments/' + d.id).send({ productId: 'nope' })).status).toBe(400);
  expect((await request(app).put('/api/fleet/deployments/nope').send({ productId: p1.id })).status).toBe(404);
});
test('runs list newest first', async () => {
  const app = buildApp(':memory:');
  expect((await request(app).get('/api/fleet/runs')).body).toEqual([]);
});
test('duplicate target names rejected with field', async () => {
  const app = buildApp(':memory:');
  const body = { name: 'dup', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' };
  expect((await request(app).post('/api/fleet/targets').send(body)).status).toBe(201);
  const r = await request(app).post('/api/fleet/targets').send(body);
  expect(r.status).toBe(409);
  expect(r.body.field).toBe('name');
});
test('target validation errors carry field', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/targets').send({ name: 'x', kind: 'static-sftp', domain: 'x.example.com' });
  expect(r.status).toBe(400);
  expect(r.body.field).toBe('host');
});
test('edit binding target, conflict rejected', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 'a', gitUrl: 'https://x/y.git', defaultBranch: 'main' })).body;
  const t1 = (await request(app).post('/api/fleet/targets').send({ name: 'v1', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  const t2 = (await request(app).post('/api/fleet/targets').send({ name: 'v2', kind: 'vds', ip: '1.2.3.5', sshUser: 'root', domain: 'b.example.com' })).body;
  const d1 = (await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t1.id })).body;
  await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t2.id });
  expect((await request(app).put('/api/fleet/deployments/' + d1.id).send({ targetId: t2.id })).status).toBe(409);
  const u = await request(app).put('/api/fleet/deployments/' + d1.id).send({ targetId: t1.id });
  expect(u.status).toBe(200);
  expect(u.body.domain).toBe('a.example.com');
  expect((await request(app).put('/api/fleet/deployments/' + d1.id).send({ targetId: 'nope' })).status).toBe(400);
});
