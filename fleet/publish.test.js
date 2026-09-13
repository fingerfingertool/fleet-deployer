const { planPublish, redactSecrets } = require('./publish');
test('config mode maps sourceDir plus extraFiles minus exclude', () => {
  const plan = planPublish(
    { publish: { strategy: 'ftp-static', sourceDir: 'public', extraFiles: ['api.php'], exclude: ['*.json'] } },
    { branch: 'main' },
    { remoteDir: '/home/ghostpro/ghost.ghostprovider.com' });
  expect(plan.mode).toBe('config');
  expect(plan.remoteDir).toBe('/home/ghostpro/ghost.ghostprovider.com');
  expect(plan.uploads).toEqual(expect.arrayContaining(['public/', 'api.php']));
  expect(plan.exclude).toEqual(['*.json']);
});
test('no config and no script means none mode', () => {
  expect(planPublish({}, { branch: 'main' }, { remoteDir: '/x' }).mode).toBe('none');
});
test('redacts secrets', () => {
  expect(redactSecrets('FTP_PASS=hunter2 ok')).toBe('FTP_PASS=[redacted] ok');
});
