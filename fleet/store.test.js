const { createStore } = require('./store');
test('saves product with defaultBranch', () => {
  const s = createStore(':memory:');
  const p = s.saveProduct({ name: 'shop', gitUrl: 'https://github.com/x/shop.git', defaultBranch: 'main' });
  expect(p.id).toBeTruthy();
  expect(s.listProducts().length).toBe(1);
});
test('migrates hosts to vds targets and defaults buildConfig', () => {
  const s = createStore(':memory:');
  const h = s.saveHost({ name: 'v1', ip: '1.2.3.4', sshUser: 'root' });
  const t = s.listTargets().find(x => x.migratedFromHostId === h.id);
  expect(t).toBeTruthy();
  expect(t.kind).toBe('vds');
  expect(t.ip).toBe('1.2.3.4');
  const p = s.saveProduct({ name: 'shop', gitUrl: 'https://x/y.git' });
  expect(p.buildConfig).toEqual({ command: 'npm run build', outputDir: 'dist/' });
});
test('saves static-sftp target', () => {
  const s = createStore(':memory:');
  const t = s.saveTarget({ name: 'cpanel1', kind: 'static-sftp', host: 'cp.example.com', username: 'u', remoteDir: '/public_html' });
  expect(t.id).toBeTruthy();
  expect(s.listTargets().length).toBeGreaterThan(0);
});
