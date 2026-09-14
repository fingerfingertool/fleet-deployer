const { createStore } = require('./store');
test('saves and lists runs per deployment', async () => {
  const s = createStore(':memory:');
  const r = await s.saveRun({ deploymentId: 'd1', trigger: 'manual', branch: 'main', status: 'live' });
  expect(r.id).toBeTruthy();
  expect(await s.runsForDeployment('d1').length).toBe(1);
  expect(await s.runsForDeployment('other').length).toBe(0);
});
