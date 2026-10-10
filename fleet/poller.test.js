const { createStore } = require('./store');
const { pollGitHub } = require('./poller');

// A fake git ls-remote resolver keyed by branch name -> sha.
function fakeResolver(map) {
  return async ({ gitUrl, branch }) => {
    const key = `${gitUrl}::${branch}`;
    if (!(key in map)) throw new Error('ls-remote failed: ' + key);
    return map[key];
  };
}

test('poller queues deploy when remote tip differs from currentCommit', async () => {
  const store = createStore(':memory:');
  const p = await store.saveProduct({ name: 's', gitUrl: 'git@github.com:o/r.git', defaultBranch: 'main', repoKeyPath: '/app/keys/x' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' });
  const d = await store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'live', currentCommit: 'oldsha' });
  const resolver = fakeResolver({ 'git@github.com:o/r.git::main': 'newsha' });
  const queued = [];
  const res = await pollGitHub({ store, resolver, queue: (deploymentId, trigger) => { queued.push({ deploymentId, trigger }); return Promise.resolve(); } });
  expect(res).toEqual({ checked: 1, queued: 1 });
  expect(queued).toEqual([{ deploymentId: d.id, trigger: 'poll' }]);
});

test('poller skips when tip equals currentCommit', async () => {
  const store = createStore(':memory:');
  const p = await store.saveProduct({ name: 's', gitUrl: 'git@github.com:o/r.git', defaultBranch: 'main' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' });
  const d = await store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'live', currentCommit: 'same' });
  const resolver = fakeResolver({ 'git@github.com:o/r.git::main': 'same' });
  const queued = [];
  const res = await pollGitHub({ store, resolver, queue: (deploymentId) => { queued.push(deploymentId); return Promise.resolve(); } });
  expect(res.queued).toBe(0);
  expect(queued).toEqual([]);
});

test('poller skips deployments that are already running or queued', async () => {
  const store = createStore(':memory:');
  const p = await store.saveProduct({ name: 's', gitUrl: 'git@github.com:o/r.git', defaultBranch: 'main' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' });
  await store.saveDeployment({ productId: p.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'running', currentCommit: 'oldsha' });
  const resolver = fakeResolver({ 'git@github.com:o/r.git::main': 'newsha' });
  const queued = [];
  const res = await pollGitHub({ store, resolver, queue: (deploymentId) => { queued.push(deploymentId); return Promise.resolve(); } });
  expect(res.queued).toBe(0);
  expect(queued).toEqual([]);
});

test('poller survives one repo ls-remote error and continues', async () => {
  const store = createStore(':memory:');
  const p1 = await store.saveProduct({ name: 'a', gitUrl: 'git@github.com:o/a.git', defaultBranch: 'main' });
  const p2 = await store.saveProduct({ name: 'b', gitUrl: 'git@github.com:o/b.git', defaultBranch: 'main' });
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' });
  await store.saveDeployment({ productId: p1.id, branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'live', currentCommit: 'old1' });
  const t2 = await store.saveTarget({ name: 't2', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d2', domain: 'y.example.com' });
  await store.saveDeployment({ productId: p2.id, branch: 'main', targetId: t2.id, domain: 'y.example.com', status: 'live', currentCommit: 'old2' });
  const resolver = fakeResolver({
    'git@github.com:o/a.git::main': 'ERR', // will be thrown only if resolver map missing; simulate via throwing resolver
    'git@github.com:o/b.git::main': 'new2',
  });
  // override resolver to throw for a.git
  const throwing = async ({ gitUrl, branch }) => {
    if (gitUrl === 'git@github.com:o/a.git') throw new Error('boom');
    return resolver({ gitUrl, branch });
  };
  const queued = [];
  const res = await pollGitHub({ store, resolver: throwing, queue: (deploymentId, trigger) => { queued.push({ deploymentId, trigger }); return Promise.resolve(); } });
  expect(res.queued).toBe(1);
  expect(queued).toHaveLength(1);
  expect(queued[0].trigger).toBe('poll');
});

test('poller reports checked/queued counts and skips missing products', async () => {
  const store = createStore(':memory:');
  const t = await store.saveTarget({ name: 't', kind: 'static-sftp', host: 'h', username: 'u', remoteDir: '/d', domain: 'x.example.com' });
  await store.saveDeployment({ productId: 'p_missing', branch: 'main', targetId: t.id, domain: 'x.example.com', status: 'live', currentCommit: 'old' });
  const res = await pollGitHub({ store, resolver: async () => 'x', queue: async () => {} });
  expect(res.checked).toBe(0);
  expect(res.queued).toBe(0);
});
