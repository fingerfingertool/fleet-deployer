const { redactSecrets } = require('./publish');
function createWorker(store, opts = {}) {
  const running = new Set();
  const queues = new Map();
  const listeners = [];
  function emit(ev) { listeners.forEach(fn => { try { fn(ev); } catch {} }); }
  function appendLog(run, chunk) {
    run.logTail = ((run.logTail || '') + String(chunk)).slice(-204800);
  }
  async function execute(deploymentId, trigger, retryOf) {
    const d = (await store.listDeployments()).find(x => x.id === deploymentId);
    if (!d) throw new Error('unknown deployment');
    const run = await store.saveRun({ deploymentId, trigger, branch: d.branch, status: 'running', retryOf });
    d.status = 'running'; await store.saveDeployment(d); emit({ type: 'run-started', run });
    try {
      const steps = opts.runSteps || require('./workerSteps').runSteps;
      const out = await steps({ store, deployment: d, run }, (c) => appendLog(run, c));
      run.status = 'live';
      run.commitSha = out.commitSha;
      d.status = 'live'; d.currentCommit = out.commitSha; d.lastRunId = run.id;
    } catch (e) {
      run.status = 'failed';
      run.reason = (e && e.code) || 'failed';
      run.error = redactSecrets((e && e.message) || 'unknown error');
      d.status = 'failed'; d.lastRunId = run.id;
    } finally {
      run.finishedAt = new Date().toISOString();
      if (run.logTail) run.logTail = redactSecrets(run.logTail).slice(-204800);
      await store.saveRun(run); await store.saveDeployment(d); emit({ type: 'run-finished', run });
    }
    return store.getRun(run.id);
  }
  async function pump(targetId) {
    if (running.has(targetId)) return;
    const q = queues.get(targetId) || [];
    const next = q.shift();
    if (!next) return;
    running.add(targetId);
    try { next.resolve(await execute(next.deploymentId, next.trigger, next.retryOf)); }
    catch (e) { next.reject(e); }
    finally { running.delete(targetId); pump(targetId); }
  }
  return {
    onEvent: (fn) => listeners.push(fn),
    queueLength: (targetId) => (queues.get(targetId) || []).length + (running.has(targetId) ? 1 : 0),
    async queue(deploymentId, trigger = 'manual', retryOf) {
      const found = (await store.listDeployments()).find(x => x.id === deploymentId);
      if (!found) throw new Error('unknown deployment');
      const tid = found.targetId || found.vdsId;
      found.status = 'queued'; await store.saveDeployment(found);
      return new Promise((resolve, reject) => {
        const q = queues.get(tid) || [];
        q.push({ deploymentId, trigger, retryOf, resolve, reject });
        queues.set(tid, q);
        pump(tid);
      });
    },
  };
}
module.exports = { createWorker };
