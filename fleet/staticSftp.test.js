const { buildPublishSteps, detectStaticDrift, parseSha } = require('./targets/staticSftp');
const { adapterFor } = require('./targets/adapter');
test('publish steps clone branch, build, upload dist, write sha, healthcheck', () => {
  const steps = buildPublishSteps({ gitUrl: 'https://x/y.git', branch: 'reskin-acme', buildCommand: 'npm run build', outputDir: 'dist', domain: 'shop.example.com', sha: 'abc123' });
  const all = steps.join('\n');
  expect(all).toMatch('reskin-acme');
  expect(all).toMatch('npm run build');
  expect(all).toMatch('.fleet-sha');
  expect(all).toMatch('https://shop.example.com/');
});
test('drift when sha differs', () => { expect(detectStaticDrift('aaa', 'bbb')).toBe(true); expect(detectStaticDrift('aaa', 'aaa')).toBe(false); });
test('parseSha trims whitespace and returns null on empty', () => { expect(parseSha('  abc123\n')).toBe('abc123'); expect(parseSha('   ')).toBeNull(); expect(parseSha('')).toBeNull(); });
test('adapterFor dispatches kinds', () => { expect(adapterFor('static-sftp')).toBeTruthy(); expect(adapterFor('vds')).toBeTruthy(); });
