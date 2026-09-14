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
  for (const id of ['hName', 'hIp', 'hUser', 'tAdd']) expect(html).toMatch(id);
});
test('targets table has delete buttons and clickable site links', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-del-target');
  expect(html).toMatch('target="_blank"');
});
test('deploy buttons, history and retry wiring present', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-deploy');
  expect(html).toMatch('data-retry');
  expect(html).toMatch('/deploy');
  expect(html).toMatch('webhookSecretRef');
});
test('products table has edit/delete and branch select wiring', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-edit-product');
  expect(html).toMatch('data-del-product');
  expect(html).toMatch('/branches');
});
test('binding model: target domain input, no branch/domain inputs on bind form', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('sDom');
  expect(html).not.toMatch('fBranch');
  expect(html).not.toMatch('fDomain');
});
test('active tab persists across refresh via localStorage', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('fleet-tab');
  expect(html).toMatch('localStorage');
});
test('bindings is a separate screen with unbind', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-tab="bindings"');
  expect(html).toMatch('tab-bindings');
  expect(html).toMatch('data-unbind');
});
test('add-product row has repo key path input', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('pKey');
});
test('deployments is global history, bindings have edit+deploy', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-edit-bind');
  expect(html).toMatch('/api/fleet/runs');
  expect(html).toMatch('eBindSave');
});
test('targets form has single add button, duplicate, field highlight', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).not.toMatch('id="hAdd"');
  expect(html).toMatch('data-dup-target');
  expect(html).toMatch("input.bad");
});
test('targets table has inline edit with all fields', () => {
  const html = fs.readFileSync('fleet/public/index.html', 'utf8');
  expect(html).toMatch('data-edit-target');
  expect(html).toMatch('eTKind');
  expect(html).toMatch('eTDom');
});
