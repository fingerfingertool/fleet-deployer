const { createStore } = require('./store');
test('saves and lists runs per deployment', () => {
  const s = createStore(':memory:');
  const r = s.saveRun({ deploymentId: 'd1', trigger: 'manual', branch: 'main', status: 'live' });
  expect(r.id).toBeTruthy();
  expect(s.runsForDeployment('d1').length).toBe(1);
  expect(s.runsForDeployment('other').length).toBe(0);
});
