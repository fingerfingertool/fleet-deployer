// Shared: toasts (no native dialogs), session, cart store, header.
function toast(title, body, kind) {
  const box = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.innerHTML = '<b></b><span></span>';
  el.querySelector('b').textContent = title;
  el.querySelector('span').textContent = body || '';
  box.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 5200);
  el.onclick = () => el.remove();
}
const store = {
  get cart() { try { return JSON.parse(localStorage.getItem('gn_cart') || '[]'); } catch { return []; } },
  set cart(v) { localStorage.setItem('gn_cart', JSON.stringify(v)); },
  get years() { return localStorage.getItem('gn_years') || '1'; },
  set years(v) { localStorage.setItem('gn_years', v); },
  get tok() { return localStorage.getItem('tok'); }
};
function cartCount() { return store.cart.length; }
function addToCart(d) {
  const c = store.cart;
  if (c.includes(d)) { toast('Already staged', d + ' is waiting in the cart.'); return; }
  c.push(d); store.cart = c; renderCartBadge();
  toast('Staged for registration', d, 'ok');
}
function removeFromCart(d) { store.cart = store.cart.filter(x => x !== d); renderCartBadge(); }
function renderCartBadge() {
  document.querySelectorAll('[data-cartcount]').forEach(el => { el.textContent = cartCount(); });
}
function authed() { return !!store.tok; }
function needAuth() {
  toast('Nickname required', 'Log in or mint a nickname in the Dashboard first.');
  setTimeout(() => { location.href = '/dashboard.html'; }, 900);
}
async function api(path, opts) {
  const r = await fetch(path, opts);
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('request failed (' + r.status + ')'));
  return j;
}
async function refreshHeader() {
  renderCartBadge();
  const btn = document.getElementById('dashBtn');
  if (!btn || !store.tok) return;
  try {
    const me = await api('/api/me', { headers: { 'x-token': store.tok } });
    btn.textContent = me.nick + ' · $' + me.balance.toFixed(2);
  } catch { localStorage.removeItem('tok'); }
}
async function logout() {
  localStorage.removeItem('tok');
  toast('Logged out', 'The nickname stays yours. Log back in with the same password.');
  setTimeout(() => location.reload(), 800);
}
document.addEventListener('DOMContentLoaded', refreshHeader);
