const crypto = require('crypto');
const request = require('supertest');
const { buildApp } = require('./server');
function sign(secret, body) {
  return 'sha256=' + crypto.createHmac('sha256', secret).update(JSON.stringify(body)).digest('hex');
}
test('push matching repo+branch queues deploys', async () => {
  process.env.WH_TEST_HOOK = 'topsecret';
  const app = buildApp(':memory:');
  const p = (await request(app).post('/api/fleet/products').send({ name: 's', gitUrl: 'https://github.com/o/r.git', defaultBranch: 'main' })).body;
  await request(app).put('/api/fleet/products/' + p.id).send({ webhookSecretRef: 'WH_TEST_HOOK' });
  const t = (await request(app).post('/api/fleet/targets').send({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' })).body;
  const d = (await request(app).post('/api/fleet/deployments').send({ productId: p.id, targetId: t.id })).body;
  const payload = { ref: 'refs/heads/main', repository: { clone_url: 'https://github.com/o/r.git' } };
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'push').set('X-Hub-Signature-256', sign('topsecret', payload)).send(payload);
  expect(r.status).toBe(200);
  expect(r.body.queued).toContain(d.id);
  delete process.env.WH_TEST_HOOK;
});
test('bad signature rejected', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'push').set('X-Hub-Signature-256', 'sha256=nope').send({ ref: 'refs/heads/main' });
  expect(r.status).toBe(401);
});
test('ping answers 200', async () => {
  const app = buildApp(':memory:');
  const r = await request(app).post('/api/fleet/webhooks/github').set('X-GitHub-Event', 'ping').send({ zen: 'hi' });
  expect(r.status).toBe(200);
});
