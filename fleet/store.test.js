const { createStore } = require('./store');
test('saves product with defaultBranch', async () => {
  const s = createStore(':memory:');
  const p = await s.saveProduct({ name: 'shop', gitUrl: 'https://github.com/x/shop.git', defaultBranch: 'main' });
  expect(p.id).toBeTruthy();
  expect(await s.listProducts().length).toBe(1);
});
test('migrates hosts to vds targets and defaults buildConfig', async () => {
  const s = createStore(':memory:');
  const h = await s.saveHost({ name: 'v1', ip: '1.2.3.4', sshUser: 'root' });
  const t = await s.listTargets().find(x => x.migratedFromHostId === h.id);
  expect(t).toBeTruthy();
  expect(t.kind).toBe('vds');
  expect(t.ip).toBe('1.2.3.4');
  const p = await s.saveProduct({ name: 'shop', gitUrl: 'https://x/y.git' });
  expect(p.buildConfig).toEqual({ command: 'npm run build', outputDir: 'dist/' });
});
test('saveTarget throws on 513-char key path', async () => {
  const s = createStore(':memory:');
  expect(() => s.saveTarget({ name: 'x', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', sshKeyPath: 'k'.repeat(513) })).toThrow('key path too long');
  expect(() => s.saveTarget({ name: 'x', kind: 'vds', ip: '1.2.3.4', sshUser: 'root', keyPath: 'k'.repeat(513) })).toThrow('key path too long');
});
test('saves static-sftp target', async () => {
  const s = createStore(':memory:');
  const t = await s.saveTarget({ name: 'cpanel1', kind: 'static-sftp', host: 'cp.example.com', username: 'u', remoteDir: '/public_html' });
  expect(t.id).toBeTruthy();
  expect(await s.listTargets().length).toBeGreaterThan(0);
});
