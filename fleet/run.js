const path = require('path');
const express = require('express');
const { buildApp, basicAuth } = require('./server');
const { createWorker } = require('./worker');
const { pollGitHub } = require('./poller');

const PORT = process.env.FLEET_PORT || 3100;
const POLL_INTERVAL_MS = parseInt(process.env.POLL_INTERVAL_MS || '60000', 10);
const app = buildApp(process.env.FLEET_DB || '/app/data/fleet.json');
const worker = createWorker(app.locals.store);
app.locals.worker = worker;
app.use(basicAuth);
app.use(express.static(path.join(__dirname, 'public')));
app.listen(PORT, '0.0.0.0', () => console.log(`Fleet panel on http://0.0.0.0:${PORT}`));

// Poll GitHub for new commits and auto-deploy (replaces remote webhooks).
// Fully local: uses each product's deploy key via `git ls-remote` (tokenless).
let polling = false;
async function sweep() {
  if (polling) return;
  polling = true;
  try {
    const res = await pollGitHub({
      store: app.locals.store,
      queue: (deploymentId, trigger) => worker.queue(deploymentId, trigger).catch(() => {}),
    });
    if (res.queued > 0) console.log(`poll: checked ${res.checked}, queued ${res.queued}`);
  } catch (e) {
    console.error('poll error:', (e && e.message) || e);
  } finally {
    polling = false;
  }
}
setInterval(sweep, POLL_INTERVAL_MS);
if (POLL_INTERVAL_MS > 0) sweep();
