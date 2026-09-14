const request = require('supertest');
const { buildApp } = require('./server');
test('edit product via PUT', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git' })).body;
  const u = await request(app).put('/api/fleet/products/' + p.id).send({ name: 's2', defaultBranch: 'dev' });
  expect(u.status).toBe(200);
  expect(u.body.name).toBe('s2');
  expect(u.body.defaultBranch).toBe('dev');
});
test('delete blocked when deployments reference product', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git' })).body;
  const t = (await request(app).post('/api/fleet/targets').send({ name: 'v', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'a.example.com' })).body;
  await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id });
  expect((await request(app).delete('/api/fleet/products/' + p.id)).status).toBe(409);
});
test('delete works when unreferenced, 404 when unknown', async () => {
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git' })).body;
  expect((await request(app).delete('/api/fleet/products/' + p.id)).status).toBe(204);
  expect((await request(app).delete('/api/fleet/products/nope')).status).toBe(404);
});
test('branches endpoint 404 on unknown product', async () => {
  const app = buildApp(':memory:');
  expect((await request(app).get('/api/fleet/products/nope/branches')).status).toBe(404);
});
test('PUT accepts publish config, rejects bad strategy', async () => {
  const request = require('supertest');
  const { buildApp } = require('./server');
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git' })).body;
  const ok = await request(app).put('/api/fleet/products/' + p.id).send({ publish: { strategy: 'ftp-static', sourceDir: 'public', extraFiles: ['api.php'], exclude: ['*.json'] } });
  expect(ok.status).toBe(200);
  expect(ok.body.publish.strategy).toBe('ftp-static');
  expect((await request(app).put('/api/fleet/products/' + p.id).send({ publish: { strategy: 'nope' } })).status).toBe(400);
});
test('POST accepts repoKeyPath, rejects overlong', async () => {
  const request = require('supertest');
  const { buildApp } = require('./server');
  const app = buildApp(':memory:');
  const ok = await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://x/y.git', repoKeyPath: '/app/keys/x' });
  expect(ok.status).toBe(201);
  expect(ok.body.repoKeyPath).toBe('/app/keys/x');
  expect((await request(app).post('/api/fleet/products').send({ name: 't', gitUrl: 'https://x/y.git', repoKeyPath: 'x'.repeat(513) })).status).toBe(400);
});
test('refs endpoint 404 on unknown product', async () => {
  const request = require('supertest');
  const { buildApp } = require('./server');
  const app = buildApp(':memory:');
  expect((await request(app).get('/api/fleet/products/nope/refs')).status).toBe(404);
});
