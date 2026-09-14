const { createStore } = require('./store');
const { createWorker } = require('./worker');
test('failed clone records run with reason', async () => {
  const store = createStore(':memory:');
  const p = await store.saveProduct({ name: 's', gitUrl: 'https://invalid.invalid/x.git' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d' });
  const d = await store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'draft' });
  const w = createWorker(store, { runSteps: async () => { throw Object.assign(new Error('boom'), { code: 'clone-failed' }); } });
  const run = await w.queue(d.id, 'manual');
  expect(run.status).toBe('failed');
  expect(run.reason).toBe('clone-failed');
  expect(await store.runsForDeployment(d.id).length).toBe(1);
}, 20000);
test('per-target serialization', async () => {
  const store = createStore(':memory:');
  const w = createWorker(store, {});
  expect(typeof w.queueLength).toBe('function');
});
test('run snapshots binding so later edits do not rewrite history', async () => {
  const store = createStore(':memory:');
  const p = await store.saveProduct({ name: 's', gitUrl: 'https://invalid.invalid/x.git' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'old.example.com' });
  const d = await store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'old.example.com', status: 'draft' });
  const w = createWorker(store, { runSteps: async () => ({ commitSha: 'abc' }) });
  const run = await w.queue(d.id, 'manual');
  await store.saveDeployment({ ...d, domain: 'new.example.com' });
  const kept = await store.getRun(run.id);
  expect(kept.domain).toBe('old.example.com');
  expect(kept.productId).toBe(p.id);
  expect(kept.targetId).toBe(t.id);
});
