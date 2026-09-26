const fs = require('fs');
const path = require('path');
const { injectHeadScripts, validateHeadScripts } = require('./inject');

test('validateHeadScripts rejects path traversal in file name', () => {
  expect(validateHeadScripts([{ file: '../evil.js', content: 'x' }])).toBeTruthy();
  expect(validateHeadScripts([{ file: 'a/b.js', content: 'x' }])).toBeTruthy();
  expect(validateHeadScripts([{ file: '..', content: 'x' }])).toBeTruthy();
});

test('validateHeadScripts accepts a clean file name and content', () => {
  expect(validateHeadScripts([{ file: 'analytics.js', content: 'console.log(1)' }])).toBeNull();
  expect(validateHeadScripts([])).toBeNull();
});

test('validateHeadScripts rejects non-array and bad entries', () => {
  expect(validateHeadScripts('nope')).toBeTruthy();
  expect(validateHeadScripts([{ file: 123, content: 'x' }])).toBeTruthy();
  expect(validateHeadScripts([{ file: 'a.js' }])).toBeTruthy();
});

test('injectHeadScripts writes file and injects script before </head> in all html', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fleet-inject-'));
  try {
    fs.mkdirSync(path.join(root, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head><title>x</title></head><body></body></html>');
    fs.writeFileSync(path.join(root, 'sub', 'page.html'), '<html><HEAD><title>y</title></HEAD></html>');
    fs.writeFileSync(path.join(root, 'style.css'), 'body{}');
    const scripts = [{ file: 'analytics.js', content: 'console.log("hi");' }];
    const result = injectHeadScripts(root, scripts);
    // script file written at root
    expect(fs.readFileSync(path.join(root, 'analytics.js'), 'utf8')).toBe('console.log("hi");');
    // injected into index.html (lowercase </head>)
    const idx = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    expect(idx).toContain('<script src="/analytics.js"></script>');
    expect(idx.indexOf('<script')).toBeLessThan(idx.indexOf('</head>'));
    // injected into nested page.html (uppercase </HEAD>, case-insensitive)
    const page = fs.readFileSync(path.join(root, 'sub', 'page.html'), 'utf8');
    expect(page).toContain('<script src="/analytics.js"></script>');
    // css untouched
    expect(fs.readFileSync(path.join(root, 'style.css'), 'utf8')).toBe('body{}');
    expect(result).toEqual({ written: ['analytics.js'], injected: 2 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('injectHeadScripts no-ops when no scripts', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fleet-inject-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head></html>');
    const result = injectHeadScripts(root, []);
    expect(fs.readFileSync(path.join(root, 'index.html'), 'utf8')).toBe('<html><head></head></html>');
    expect(result).toEqual({ written: [], injected: 0 });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('injectHeadScripts injects multiple scripts in order', () => {
  const root = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fleet-inject-'));
  try {
    fs.writeFileSync(path.join(root, 'index.html'), '<html><head></head></html>');
    const scripts = [{ file: 'a.js', content: '1' }, { file: 'b.js', content: '2' }];
    injectHeadScripts(root, scripts);
    const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
    const a = html.indexOf('<script src="/a.js"></script>');
    const b = html.indexOf('<script src="/b.js"></script>');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
