function planPublish(product, deployment, target) {
  const cfg = product && product.publish;
  if (cfg && cfg.strategy === 'ftp-static') {
    return {
      mode: 'config',
      remoteDir: target.remoteDir,
      sourceDir: cfg.sourceDir || 'public',
      extraFiles: cfg.extraFiles || [],
      exclude: cfg.exclude || [],
      buildCommand: cfg.buildCommand || null,
      uploads: [`${cfg.sourceDir || 'public'}/`, ...(cfg.extraFiles || [])],
    };
  }
  if (product && product.hasDeployScript) return { mode: 'script', script: 'deploy-ftp.py', remoteDir: target.remoteDir };
  return { mode: 'none', reason: 'no publish config and no repo deploy script' };
}
function redactSecrets(text) {
  return String(text).replace(/((?:pass|secret|token|key)[a-z_]*\s*[=:]\s*)(\S+)/gi, '$1[redacted]');
}
module.exports = { planPublish, redactSecrets };
