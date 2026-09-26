const fs = require('fs');
const path = require('path');

// Validate a product's headScripts array: [{ file, content, encoding }]
// `file` must be a simple filename (no directory separators, no traversal),
// ≤ 256 chars. `content` is the script text (utf8) OR base64 when
// `encoding === 'base64'` (file-upload path).
function validateHeadScripts(scripts) {
  if (scripts === undefined || scripts === null) return null;
  if (!Array.isArray(scripts)) return 'headScripts must be an array';
  for (const s of scripts) {
    if (typeof s !== 'object' || s === null) return 'each headScript must be an object';
    if (typeof s.file !== 'string' || s.file.length === 0 || s.file.length > 256) return 'invalid headScript.file';
    if (s.file.includes('/') || s.file.includes('\\') || s.file === '..' || s.file === '.') return 'headScript.file must be a plain filename';
    if (typeof s.content !== 'string') return 'invalid headScript.content';
    if (s.encoding !== undefined && s.encoding !== 'base64' && s.encoding !== 'utf8') return 'invalid headScript.encoding';
  }
  return null;
}

// Recursively find all .html files under root (excluding .git).
function findHtmlFiles(root) {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.name === '.git') continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) out.push(full);
    }
  };
  walk(root);
  return out;
}

// Decode a headScript's content to bytes (handles base64-encoded uploads).
function scriptBytes(s) {
  if (s.encoding === 'base64') return Buffer.from(s.content, 'base64');
  return Buffer.from(s.content, 'utf8');
}

// Write each script's content to <root>/<file>, and inject a
// <script src="/<file>"></script> tag immediately before </head> (case-insensitive)
// in every .html file under root. Returns { written, injected }.
function injectHeadScripts(root, scripts) {
  scripts = scripts || [];
  const written = [];
  if (scripts.length === 0) return { written: [], injected: 0 };

  // Write script files at the site root.
  for (const s of scripts) {
    const dest = path.join(root, s.file);
    fs.writeFileSync(dest, scriptBytes(s));
    written.push(s.file);
  }

  // Inject into HTML files.
  const tag = (file) => `<script src="/${file}"></script>`;
  const injectTag = scripts.map((s) => tag(s.file)).join('');
  const htmlFiles = findHtmlFiles(root);
  let injected = 0;
  for (const f of htmlFiles) {
    let html = fs.readFileSync(f, 'utf8');
    if (!/<\/head>/i.test(html)) continue;
    html = html.replace(/<\/head>/i, `${injectTag}</head>`);
    fs.writeFileSync(f, html);
    injected++;
  }
  return { written, injected };
}

module.exports = { injectHeadScripts, validateHeadScripts };
