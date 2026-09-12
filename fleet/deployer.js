function quoteShell(s) {
  return "'" + String(s).replace(/'/g, "'\\''") + "'";
}
function validateBranch(branch) {
  if (typeof branch !== 'string' || branch.length === 0 || branch.length > 128 || !/^[A-Za-z0-9/_.-]+$/.test(branch)) {
    throw new Error('Invalid branch: ' + String(branch));
  }
  return branch;
}
function validateDomain(domain) {
  if (typeof domain !== 'string' || domain.length === 0 || domain.length > 253) {
    throw new Error('Invalid domain: ' + String(domain));
  }
  const labels = domain.split('.');
  const labelRe = /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/;
  if (!labels.every((l) => labelRe.test(l))) {
    throw new Error('Invalid domain: ' + String(domain));
  }
  return domain;
}
function buildCommands(dep) {
  validateBranch(dep.branch);
  validateDomain(dep.domain);
  if (typeof dep.gitUrl !== 'string' || dep.gitUrl.length === 0) throw new Error('Invalid gitUrl');
  const qBranch = quoteShell(dep.branch);
  const qDomain = quoteShell(dep.domain);
  const qGitUrl = quoteShell(dep.gitUrl);
  return [
    `if [ ! -d /opt/fleet/app ]; then git clone ${qGitUrl} /opt/fleet/app; fi`,
    `cd /opt/fleet/app && if [ -n "$(git status --porcelain)" ] || ! git diff --quiet; then echo DIRTY_WORKTREE && exit 43; fi`,
    `cd /opt/fleet/app && git fetch origin && git checkout ${qBranch} && git pull --ff-only origin ${qBranch}`,
    `cd /opt/fleet/app && docker compose up -d --build`,
    `printf ${qDomain} ' {\\n reverse_proxy 127.0.0.1:3000\\n}' > /etc/caddy/sites/${dep.domain}.Caddyfile && caddy reload --config /etc/caddy/Caddyfile`,
    `curl -fsS https://${dep.domain}/api/health || curl -fsS http://127.0.0.1:3000/api/health`,
  ];
}
function detectDrift(remoteSha, expectedSha) {
  if (remoteSha == null || expectedSha == null) return true;
  return remoteSha !== expectedSha;
}
module.exports = { buildCommands, detectDrift, quoteShell, validateBranch, validateDomain };
