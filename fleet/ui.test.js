const fs = require('fs');
test('harbor UI has targets tab and kind badge', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('targets');
  expect(html).toMatch('kind');
});
