const { buildCommands, detectDrift } = require('./deployer');
test('checkout branch and compose up', () => {
  const cmds = buildCommands({ gitUrl: 'https://x/y.git', branch: 'reskin-acme', domain: 'a.example.com' });
  expect(cmds.join('\n')).toMatch('reskin-acme');
  expect(cmds.join('\n')).toMatch('docker compose up -d --build');
});
test('drift when sha differs', () => { expect(detectDrift('aaa', 'bbb')).toBe(true); });
test('injection branch rejected', () => {
  expect(() => buildCommands({ gitUrl: 'https://x/y.git', branch: "main'; rm -rf /; echo '", domain: 'a.example.com' })).toThrow();
});
test('dirty-check is first remote command', () => {
  const cmds = buildCommands({ gitUrl: 'https://x/y.git', branch: 'reskin-acme', domain: 'a.example.com' });
  expect(cmds[1]).toMatch('git status --porcelain');
  expect(cmds[1]).toMatch('git diff --quiet');
  expect(cmds[1]).toMatch('exit 43');
  expect(cmds[2]).toMatch('git fetch');
});
test('detectDrift(null,null)===true', () => { expect(detectDrift(null, null)).toBe(true); });
