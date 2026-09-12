const { planPropagate } = require('./propagate');
test('flags behind deployments', () => {
  const plan = planPropagate([{ id: 'd1', currentCommit: 'aaa' }, { id: 'd2', currentCommit: 'zzz' }], 'zzz');
  expect(plan.find(p => p.deploymentId === 'd1').behind).toBe(true);
  expect(plan.find(p => p.deploymentId === 'd2').behind).toBe(false);
});
