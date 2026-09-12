const fs = require('fs');
test('harbor UI has targets tab and kind badge', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('targets');
  expect(html).toMatch('kind');
});
test('targets tab has sftp creation inputs and kind toggle wiring POST /api/fleet/targets', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  for (const id of ['hKind', 'sHost', 'sUser', 'sDir', 'tAdd']) expect(html).toMatch(id);
  expect(html).toMatch('/api/fleet/targets');
  // VDS row still working
  for (const id of ['hName', 'hIp', 'hUser', 'hAdd']) expect(html).toMatch(id);
});
