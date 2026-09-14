const { createPgStore } = require('./store');
const URL = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;
(URL ? test : test.skip)('pg store round-trips products, targets, deployments, runs', async () => {
  const s = createPgStore(URL, ':memory:');
  const p = await s.saveProduct({ name: 'pg-shop', gitUrl: 'https://x/y.git' });
  expect(p.id).toBeTruthy();
  expect((await s.listProducts()).length).toBeGreaterThan(0);
  const t = await s.saveTarget({ name: 'pg-t', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', domain: 'pg.example.com' });
  const d = await s.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'pg.example.com', status: 'draft' });
  expect((await s.getDeployment(d.id)).domain).toBe('pg.example.com');
  await s.saveRun({ deploymentId: d.id, trigger: 'manual', branch: 'main', status: 'live' });
  expect((await s.runsForDeployment(d.id)).length).toBe(1);
  await s.deleteDeployment(d.id);
  await s.deleteTarget(t.id);
  await s.deleteProduct(p.id);
  expect(await s.getProduct(p.id)).toBeUndefined();
});
