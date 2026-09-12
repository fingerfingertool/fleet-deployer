const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const crypto = require('crypto');
const DATA_DIR = process.env.DATA_DIR || __dirname;
const DB_FILE = path.join(DATA_DIR, 'domains.json');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
let orders = [];
function loadUsers() { try { return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')); } catch { return []; } }
function saveUsers(u) { fs.writeFileSync(USERS_FILE, JSON.stringify(u, null, 2)); }
function hashPass(nick, pass) { return crypto.createHash('sha256').update(nick + '::' + pass).digest('hex'); }
// Nickname + password only. No email, no recovery. Lose it = lose access.
app.post('/api/signup', (req, res) => {
  const { nick, pass } = req.body || {};
  if (!nick || !pass || nick.length < 3 || pass.length < 6)
    return res.status(400).json({ error: 'nick min 3 chars, password min 6 chars' });
  const users = loadUsers();
  if (users.some(u => u.nick.toLowerCase() === nick.toLowerCase()))
    return res.status(409).json({ error: 'nickname taken' });
  users.push({ nick, hash: hashPass(nick, pass), created: new Date().toISOString(), domains: [], balance: 0 });
  saveUsers(users);
  res.status(201).json({ nick, warning: 'SAVE your nickname + password. No email, no KYC, no recovery. If you lose it, you lose access.' });
});
app.post('/api/login', (req, res) => {
  const { nick, pass } = req.body || {};
  const u = loadUsers().find(x => x.nick.toLowerCase() === String(nick || '').toLowerCase());
  if (!u || u.hash !== hashPass(u.nick, pass)) return res.status(401).json({ error: 'invalid nickname or password. No reset available.' });
  const token = crypto.randomBytes(24).toString('hex');
  u.token = token; saveUsers(loadUsers().map(x => x.nick === u.nick ? u : x));
  res.json({ nick: u.nick, token });
});
app.get('/api/me', (req, res) => {
  const u = loadUsers().find(x => x.token === req.headers['x-token']);
  if (!u) return res.status(401).json({ error: 'not logged in' });
  res.json({ nick: u.nick, domains: u.domains || [], balance: u.balance || 0 });
});
// Demo top-up (stands in for crypto payment callback until BTCPay/NOWPayments wired)
app.post('/api/topup', (req, res) => {
  const users = loadUsers();
  const u = users.find(x => x.token === (req.body || {}).token);
  if (!u) return res.status(401).json({ error: 'log in first' });
  u.balance = +(u.balance || 0) + Math.max(1, Number(req.body.amount) || 10);
  saveUsers(users);
  res.json({ nick: u.nick, balance: u.balance });
});
// Pay with balance: requires auth + sufficient funds
app.post('/api/pay-balance', (req, res) => {
  const { token, domains, years = 1 } = req.body || {};
  const users = loadUsers();
  const u = users.find(x => x.token === token);
  if (!u) return res.status(401).json({ error: 'log in or create an account in Dashboard first' });
  if (!domains?.length) return res.status(400).json({ error: 'cart is empty' });
  const yr = Math.max(1, Math.min(10, Number(years) || 1));
  const total = +domains.reduce((s, fqdn) => s + regPrice('.' + fqdn.split('.').pop(), yr).total, 0).toFixed(2);
  if ((u.balance || 0) < total) return res.status(402).json({ error: `insufficient balance ($${u.balance || 0} < $${total}). Top up with crypto first.`, total, balance: u.balance || 0 });
  u.balance = +(u.balance - total).toFixed(2);
  u.domains = [...(u.domains || []), ...domains.map(d => ({ domain: d, years: yr, date: new Date().toISOString() }))];
  saveUsers(users);
  res.json({ message: 'Paid with balance.', total, balance: u.balance, domains });
});
function loadDomains() {
  if (!fs.existsSync(DB_FILE)) {
    const seed = [
      { id: 1, name: 'cloudhaven.io', price: 2499, tld: '.io', category: 'tech', premium: true, status: 'available', description: 'Short, brandable tech domain.' },
      { id: 2, name: 'freshbites.co', price: 899, tld: '.co', category: 'food', premium: false, status: 'available', description: 'Perfect for food delivery startup.' },
      { id: 3, name: 'quantumleap.ai', price: 5999, tld: '.ai', category: 'tech', premium: true, status: 'available', description: 'Premium AI domain.' },
      { id: 4, name: 'urbanfit.shop', price: 349, tld: '.shop', category: 'retail', premium: false, status: 'available', description: 'Great for fitness e-commerce.' },
      { id: 5, name: 'greenvolt.energy', price: 1299, tld: '.energy', category: 'energy', premium: false, status: 'available', description: 'Clean energy brand.' },
      { id: 6, name: 'pixelcraft.dev', price: 499, tld: '.dev', category: 'tech', premium: false, status: 'sold', description: 'Already sold example.' }
    ];
    fs.writeFileSync(DB_FILE, JSON.stringify(seed, null, 2));
    return seed;
  }
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveDomains(d) { fs.writeFileSync(DB_FILE, JSON.stringify(d, null, 2)); }

// ---- Pricing: real registrar provider if keys exist, else editable table ----
const TLDS = {
  '.com': 13.98, '.net': 15.98, '.org': 12.98, '.io': 39.98, '.co': 29.98,
  '.ai': 79.98, '.dev': 15.98, '.app': 19.98, '.shop': 4.98, '.store': 6.98,
  '.online': 5.98, '.site': 5.98, '.tech': 9.98, '.cloud': 9.98, '.xyz': 3.98,
  '.me': 19.98, '.us': 9.98, '.uk': 9.98, '.de': 9.98, '.fr': 9.98,
  '.eu': 8.98, '.ca': 14.98, '.au': 14.98, '.in': 7.98, '.br': 12.98
};
let pricingSource = 'static-table (edit TLDS in server.js)';
// Porkbun: set PORKBUN_API_KEY + PORKBUN_SECRET in env for REAL live pricing.
// Docs: https://porkbun.com/api/json/v3/documentation
async function refreshRealPricing() {
  // 1) FREE, no key: tldes.com demo feed (dynadot + porkbun, 10 major TLDs, updated hourly)
  try {
    const r = await fetch('https://tldes.com/v1?data=demo', { signal: AbortSignal.timeout(10000) });
    const j = await r.json();
    const best = {};
    for (const reg of j.registrars || [])
      for (const [tld, register] of reg.prices || []) {
        const p = parseFloat(register);
        if (p > 0 && (!best[tld] || p < best[tld])) best[tld] = p;
      }
    let n = 0;
    for (const [tld, p] of Object.entries(best)) { TLDS['.' + tld] = +p.toFixed(2); n++; }
    if (n > 0) { pricingSource = `tldes-live-free (${n} TLDs, updated ${j.updated})`; console.log('Live pricing from tldes.com:', n, 'TLDs'); }
  } catch (e) { console.log('tldes feed failed:', e.message); }
  // 2) Full live pricing if Porkbun keys provided
  const key = process.env.PORKBUN_API_KEY, sec = process.env.PORKBUN_SECRET;
  if (!key || !sec) return;
  try {
    const r = await fetch('https://api.porkbun.com/api/json/v3/pricing/get', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ apikey: key, secretapikey: sec }),
      signal: AbortSignal.timeout(10000)
    });
    const j = await r.json();
    if (j.status !== 'SUCCESS') throw new Error(j.message);
    for (const [tld, p] of Object.entries(j.pricing)) {
      const reg = parseFloat(p.registration);
      if (reg > 0) TLDS['.' + tld] = +reg.toFixed(2);
    }
    pricingSource = 'porkbun-live';
    console.log('Live pricing loaded from Porkbun, TLDs:', Object.keys(TLDS).length);
  } catch (e) { console.log('Porkbun pricing failed, using static table:', e.message); }
}
refreshRealPricing();
setInterval(refreshRealPricing, 1000 * 60 * 60 * 12); // refresh 2x daily
app.get('/api/pricing-source', (req, res) => res.json({ source: pricingSource }));
const FIRST_YEAR_DISCOUNT = 0.5; // 50% off first year
function regPrice(tld, years = 1) {
  const base = TLDS[tld.toLowerCase()] ?? 14.98;
  const first = +(base * (1 - FIRST_YEAR_DISCOUNT)).toFixed(2);
  const total = +(first + base * (years - 1)).toFixed(2);
  return { tld, baseYearly: base, firstYear: first, years, total, discountPct: 50 };
}
// REAL availability: IANA RDAP bootstrap -> authoritative registry RDAP. No fake data.
// 404 from registry = available, 200 = taken. On network failure returns unknown (never guessed).
let rdapBootstrap = null;
async function rdapServerForTld(tld) {
  if (!rdapBootstrap) {
    const r = await fetch('https://data.iana.org/rdap/dns.json', { signal: AbortSignal.timeout(8000) });
    rdapBootstrap = await r.json();
  }
  const t = tld.replace(/^\./, '').toLowerCase();
  const svc = (rdapBootstrap.services || []).find(([suffixes]) => suffixes.includes(t));
  return svc ? svc[1][0] : null; // e.g. https://rdap.verisign.com/com/v1/
}
async function checkAvailability(fqdn) {
  const tld = '.' + fqdn.split('.').pop().toLowerCase();
  try {
    const base = await rdapServerForTld(tld);
    if (!base) return { domain: fqdn, available: null, source: 'unsupported-tld' };
    const r = await fetch(`${base}domain/${encodeURIComponent(fqdn)}`, { signal: AbortSignal.timeout(8000) });
    if (r.status === 404) return { domain: fqdn, available: true, source: 'rdap:' + base };
    if (r.ok) {
      const j = await r.json();
      return { domain: fqdn, available: false, source: 'rdap:' + base, registrar: (j.entities || []).map(e => e.vcardArray?.[1]?.find(p => p[0] === 'fn')?.[3]).filter(Boolean) };
    }
    return { domain: fqdn, available: null, source: 'rdap-error:' + r.status };
  } catch (e) {
    return { domain: fqdn, available: null, source: 'offline', error: String(e.message || e) };
  }
}

app.get('/api/tlds', (req, res) => {
  res.json(Object.entries(TLDS).map(([tld, base]) => ({ ...regPrice(tld, 1) })));
});

// Global search: "mybrand" -> mybrand.com, mybrand.io ... with price + availability
app.get('/api/search', async (req, res) => {
  const { name, years = 1 } = req.query;
  if (!name) return res.status(400).json({ error: 'name required (e.g. ?name=mybrand or ?name=mybrand.com)' });
  const clean = name.toLowerCase().trim();
  let candidates;
  if (clean.includes('.')) {
    candidates = [clean];
  } else {
    const stem = clean.replace(/[^a-z0-9-]/g, '') || 'mybrand';
    candidates = Object.keys(TLDS).map(t => stem + t);
  }
  const yr = Math.max(1, Math.min(10, Number(years) || 1));
  const results = await Promise.all(candidates.slice(0, 30).map(async fqdn => {
    const tld = '.' + fqdn.split('.').pop();
    const a = await checkAvailability(fqdn);
    return { domain: fqdn, tld, ...a, pricing: regPrice(tld, yr) };
  }));
  res.json({ query: name, years: yr, promo: '50% OFF first year on all TLDs', results });
});

// ---- Monster search: affix/suffix idea generation + live availability ----
const PREFIXES = ['get', 'try', 'go', 'my', 'use', 'hey', 'lets', 'join', 'super', 'hyper', 'ultra', 'easy'];
const SUFFIXES = ['ly', 'hub', 'labs', 'base', 'hq', 'os', 'fi', 'ery', 'ify', 'io', 'app', 'deck', 'stack', 'wise', 'loop', 'forge'];
const MONSTER_TLDS = ['.com', '.io', '.co', '.ai', '.dev', '.app', '.xyz', '.me'];
function ideasFor(seed) {
  const s = seed.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20) || 'ghostbrand';
  const out = [];
  for (const p of PREFIXES) out.push(p + s);
  for (const x of SUFFIXES) out.push(s + x);
  // a few compounds + clipped form
  out.push(s + 'app', 'go' + s + 'go');
  if (s.length > 6) out.push(s.slice(0, Math.ceil(s.length / 2)) + s.slice(Math.ceil(s.length / 2)));
  return [...new Set(out)].slice(0, 26);
}
app.get('/api/monster', async (req, res) => {
  const { seed, years = 1, limit = 24 } = req.query;
  if (!seed) return res.status(400).json({ error: 'seed required (?seed=bolt)' });
  const yr = Math.max(1, Math.min(10, Number(years) || 1));
  const ideas = ideasFor(seed);
  const max = Math.min(48, Number(limit) || 24);
  const candidates = [];
  for (const stem of ideas) {
    for (const tld of MONSTER_TLDS) {
      if (candidates.length >= max) break;
      candidates.push(stem + tld);
    }
    if (candidates.length >= max) break;
  }
  const checked = await Promise.all(candidates.map(async fqdn => {
    const tld = '.' + fqdn.split('.').pop();
    const a = await checkAvailability(fqdn);
    return { domain: fqdn, stem: fqdn.slice(0, -tld.length), tld, ...a, pricing: regPrice(tld, yr) };
  }));
  const free = checked.filter(x => x.available === true);
  const taken = checked.filter(x => x.available !== true).slice(0, 6);
  res.json({ seed, years: yr, checked: checked.length, promo: '50% OFF first year on all TLDs', results: [...free, ...taken] });
});

// Registration checkout (new domains, yearly pricing with discount)
app.post('/api/register', (req, res) => {
  const { domains, email, years = 1, token } = req.body; // domains: ["mybrand.com", ...]
  if (!domains?.length) return res.status(400).json({ error: 'domains[] required' });
  const users = loadUsers();
  const u = token ? users.find(x => x.token === token) : null;
  if (token && !u) return res.status(401).json({ error: 'log in or create an account in Dashboard first' });
  const yr = Math.max(1, Math.min(10, Number(years) || 1));
  const items = domains.map(fqdn => {
    const tld = '.' + fqdn.split('.').pop();
    return { domain: fqdn, ...regPrice(tld, yr) };
  });
  const total = +items.reduce((s, i) => s + i.total, 0).toFixed(2);
  const savings = +items.reduce((s, i) => s + (i.baseYearly - i.firstYear), 0).toFixed(2);
  const order = { id: 'REG-' + Date.now(), type: 'registration', email: email || ('nick:' + (u ? u.nick : 'anon')), years: yr, items, total, savings, date: new Date().toISOString() };
  orders.push(order);
  if (u) {
    u.domains = [...(u.domains || []), ...domains.map(d => ({ domain: d, years: yr, date: order.date, order: order.id }))];
    saveUsers(users);
  }
  res.status(201).json({ message: 'Registration order created (demo, no real registrar yet). 50% first-year discount applied.', order });
});

// List / search domains
app.get('/api/domains', (req, res) => {
  let domains = loadDomains();
  const { q, tld, maxPrice, available } = req.query;
  if (q) domains = domains.filter(d => d.name.toLowerCase().includes(q.toLowerCase()));
  if (tld) domains = domains.filter(d => d.tld === tld);
  if (maxPrice) domains = domains.filter(d => d.price <= Number(maxPrice));
  if (available === 'true') domains = domains.filter(d => d.status === 'available');
  res.json(domains);
});

app.get('/api/domains/:id', (req, res) => {
  const d = loadDomains().find(x => x.id === Number(req.params.id));
  if (!d) return res.status(404).json({ error: 'Not found' });
  res.json(d);
});

// Admin: add domain
app.post('/api/domains', (req, res) => {
  const { name, price, description, category } = req.body;
  if (!name || !price) return res.status(400).json({ error: 'name and price required' });
  const domains = loadDomains();
  if (domains.some(d => d.name.toLowerCase() === name.toLowerCase()))
    return res.status(409).json({ error: 'Domain already listed' });
  const tld = '.' + name.split('.').pop();
  const domain = { id: Date.now(), name, price: Number(price), tld, category: category || 'general', premium: Number(price) > 2000, status: 'available', description: description || '' };
  domains.push(domain); saveDomains(domains);
  res.status(201).json(domain);
});

// Checkout / buy
app.post('/api/orders', (req, res) => {
  const { domainIds, email } = req.body;
  if (!domainIds?.length || !email) return res.status(400).json({ error: 'domainIds and email required' });
  const domains = loadDomains();
  const bought = [];
  for (const id of domainIds) {
    const d = domains.find(x => x.id === Number(id));
    if (!d) return res.status(404).json({ error: `Domain ${id} not found` });
    if (d.status !== 'available') return res.status(409).json({ error: `${d.name} is no longer available` });
    d.status = 'sold'; bought.push(d);
  }
  saveDomains(domains);
  const total = bought.reduce((s, d) => s + d.price, 0);
  const order = { id: 'ORD-' + Date.now(), email, items: bought.map(d => d.name), total, date: new Date().toISOString() };
  orders.push(order);
  res.status(201).json({ message: 'Purchase successful (demo checkout, no real payment)', order });
});

app.get('/api/orders', (req, res) => res.json(orders));

app.listen(PORT, () => console.log(`Domain marketplace running on http://localhost:${PORT}`));
