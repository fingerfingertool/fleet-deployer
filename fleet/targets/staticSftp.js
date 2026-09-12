function quoteShell(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
function validateBranch(b) { if (!/^[A-Za-z0-9/_.-]{1,128}$/.test(b)) throw new Error('Invalid branch: ' + b); return b; }
function buildPublishSteps({ gitUrl, branch, buildCommand, outputDir, domain, sha, host, remoteDir }) {
  validateBranch(branch);
  const work = '/tmp/fleet-build-$JOBID';
  return [
    `rm -rf ${work} && git clone --depth 1 --branch ${quoteShell(branch)} ${quoteShell(gitUrl)} ${work}`,
    `cd ${work} && npm ci && ${buildCommand || 'npm run build'}`,
    `sftp-put ${quoteShell(work + '/' + (outputDir || 'dist') + '/*')} -> ${quoteShell((host || domain) + ':' + (remoteDir || 'remoteDir'))}`,
    `echo ${quoteShell(sha)} | sftp-put - .fleet-sha`,
    `curl -fsS ${quoteShell('https://' + domain + '/')}`,
  ];
}
function detectStaticDrift(remoteSha, expectedSha) { if (remoteSha == null || expectedSha == null) return true; return remoteSha !== expectedSha; }
function parseSha(output) { if (output == null) return null; const s = String(output).trim(); return s ? s : null; }
module.exports = { buildPublishSteps, detectStaticDrift, parseSha };
