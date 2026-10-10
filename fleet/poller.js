const { execFile } = require('child_process');
const { redactSecrets } = require('./publish');

// Resolve the remote tip SHA for a product's branch using the repo's deploy
// key (tokenless, works for private repos) via `git ls-remote`.
// Accepts either (product, branch) or ({ gitUrl, branch, product }).
async function lsRemoteTip(product, branch) {
  // object form: { gitUrl, branch, product } (used by pollGitHub's resolver)
  if (product && typeof product === 'object' && product.product && typeof product.product.gitUrl === 'string') {
    return lsRemoteTip(product.product, product.branch);
  }
  const p = product;
  const b = branch;
  return new Promise((resolve, reject) => {
    const args = ['ls-remote', p.gitUrl, `refs/heads/${b}`];
    const env = { ...process.env };
    if (p.repoKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${p.repoKeyPath} -o StrictHostKeyChecking=no -o BatchMode=yes`;
    }
    execFile('git', args, { env, timeout: 30000 }, (err, stdout) => {
      if (err) return reject(err);
      const m = stdout.trim().split(/\s+/)[0];
      resolve(m || null);
    });
  });
}

// Poll GitHub for every deployment whose product has a repoKeyPath; queue a
// deploy when the remote tip differs from the deployment's currentCommit.
// Skips running/queued deployments and deployments whose product is missing.
// Returns { checked, queued } for observability.
async function pollGitHub({ store, queue, resolver }) {
  const resolve = resolver || (({ product, branch }) => lsRemoteTip(product, branch));
  let checked = 0;
  let queued = 0;
  const deployments = await store.listDeployments();
  for (const d of deployments) {
    if (d.status === 'running' || d.status === 'queued') continue;
    const product = await store.getProduct(d.productId);
    if (!product) continue;
    const branch = d.branch || product.defaultBranch || 'main';
    checked++;
    let tip;
    try {
      tip = await resolve({ gitUrl: product.gitUrl, branch, product });
    } catch {
      // A single repo being unreachable must not stop the sweep.
      continue;
    }
    if (!tip) continue;
    if (tip !== d.currentCommit) {
      await queue(d.id, 'poll');
      queued++;
    }
  }
  return { checked, queued };
}

module.exports = { pollGitHub, lsRemoteTip };
