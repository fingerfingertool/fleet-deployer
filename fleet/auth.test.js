const request = require('supertest');
const { buildApp } = require('./server');
const OLD_USER = process.env.FLEET_USER, OLD_PASS = process.env.FLEET_PASS;
afterEach(() => {
  if (OLD_USER === undefined) delete process.env.FLEET_USER; else process.env.FLEET_USER = OLD_USER;
  if (OLD_PASS === undefined) delete process.env.FLEET_PASS; else process.env.FLEET_PASS = OLD_PASS;
});
test('open when no credentials configured', async () => {
  delete process.env.FLEET_USER; delete process.env.FLEET_PASS;
  const app = buildApp(':memory:');
  const r = await request(app).get('/api/fleet/targets');
  expect(r.status).toBe(200);
});
test('401 without creds, 200 with creds when configured', async () => {
  process.env.FLEET_USER = 'admin'; process.env.FLEET_PASS = 's3cret';
  const app = buildApp(':memory:');
  expect((await request(app).get('/api/fleet/targets')).status).toBe(401);
  expect((await request(app).get('/api/fleet/targets').auth('admin', 'wrong')).status).toBe(401);
  expect((await request(app).get('/api/fleet/targets').auth('admin', 's3cret')).status).toBe(200);
});
test('health stays open', async () => {
  process.env.FLEET_USER = 'admin'; process.env.FLEET_PASS = 's3cret';
  const app = buildApp(':memory:');
  expect((await request(app).get('/api/fleet/health')).status).toBe(200);
});
