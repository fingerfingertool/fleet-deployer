const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { planPublish, redactSecrets } = require('./publish');

function sh(cmd, args, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, opts, (err, stdout, stderr) => {
      if (err) {
        err.stdout = stdout;
        err.stderr = stderr;
        return reject(err);
      }
      resolve({ stdout, stderr });
    });
  });
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

// FTP creds resolved from server env vault by convention:
//   process.env['FTP_PASS_' + targetId]
// (documented here; never stored in DB or logs).
async function runSteps({ store, deployment, run }, log = () => {}) {
  const product = store.getProduct(deployment.productId);
  if (!product) throw coded('clone-failed', 'unknown product');
  const target = store.getTarget(deployment.targetId || deployment.vdsId);
  if (!target) throw coded('upload-failed', 'unknown target');
  if (!target.remoteDir) throw coded('upload-failed', 'target missing remoteDir');
  const dir = `/tmp/fleet-build-${run.id}`;
  const say = (s) => { try { log(redactSecrets(s) + '\n'); } catch {} };
  try {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    // Clone (60s)
    say(`cloning ${product.gitUrl} branch ${deployment.branch}`);
    const env = { ...process.env };
    if (product.repoKeyPath) {
      env.GIT_SSH_COMMAND = `ssh -i ${product.repoKeyPath} -o StrictHostKeyChecking=no -o BatchMode=yes`;
    }
    try {
      await sh('git', ['clone', '--depth', '1', '--branch', deployment.branch, product.gitUrl, dir], { env, timeout: 60000 });
    } catch (e) {
      throw coded('clone-failed', 'git clone failed: ' + redactSecrets((e.message || '') + (e.stderr || '')));
    }
    const { stdout: shaOut } = await sh('git', ['-C', dir, 'rev-parse', 'HEAD'], { timeout: 15000 });
    const commitSha = shaOut.trim();
    // Detect repo deploy script for planner fallback
    const hasDeployScript = fs.existsSync(path.join(dir, 'deploy-ftp.py'));
    const plan = planPublish({ ...product, hasDeployScript }, deployment, target);
    if (plan.mode === 'none') throw coded('build-failed', plan.reason || 'no publish config and no repo deploy script');
    // Build (600s)
    const buildCommand = plan.buildCommand || null;
    if (buildCommand) {
      say(`building: ${buildCommand}`);
      try {
        const { stdout, stderr } = await sh('sh', ['-c', buildCommand], {
          cwd: dir,
          env: { ...process.env, ...(deployment.envValues || {}) },
          timeout: 600000,
          maxBuffer: 10 * 1024 * 1024,
        });
        say(stdout + stderr);
      } catch (e) {
        say((e.stdout || '') + (e.stderr || ''));
        throw coded('build-failed', 'build failed: ' + redactSecrets(e.message || ''));
      }
    }
    // Upload (600s) via basic-ftp
    const ftp = require('basic-ftp');
    const client = new ftp.Client(600000);
    try {
      const password = process.env['FTP_PASS_' + target.id];
      if (!password) throw coded('auth-failed', 'missing FTP credentials in vault');
      await client.access({
        host: target.host,
        user: target.username,
        password,
        secure: !!(target.tls || (product.publish && product.publish.transport && product.publish.transport.tls)),
      });
      client.trackProgress((info) => say(`${info.name} ${info.bytesOverall} bytes`));
      const withTimeout = (p, ms, code, msg) => Promise.race([
        p,
        new Promise((_, rej) => setTimeout(() => rej(coded(code, msg)), ms)),
      ]);
      if (plan.mode === 'script') {
        say('running repo deploy-ftp.py');
        try {
          await withTimeout(sh('python3', ['deploy-ftp.py'], {
            cwd: dir,
            env: { ...process.env, FTP_HOST: target.host, FTP_USER: target.username, FTP_PASS: password, FTP_DIR: target.remoteDir },
            timeout: 600000,
          }), 600000, 'upload-failed', 'deploy script timed out');
        } catch (e) {
          throw e.code ? e : coded('upload-failed', 'deploy script failed: ' + redactSecrets(e.message || ''));
        }
      } else {
        const sourceDir = path.join(dir, plan.sourceDir || 'public');
        say(`uploading ${plan.sourceDir || 'public'}/ to ${target.remoteDir}`);
        try {
          await withTimeout((async () => {
            await client.ensureDir(target.remoteDir);
            // upload sourceDir contents (idempotent: re-run overwrites)
            const items = fs.existsSync(sourceDir) ? fs.readdirSync(sourceDir) : [];
            for (const item of items) {
              if ((plan.exclude || []).some((pat) => {
                if (pat.startsWith('*.')) return item.endsWith(pat.slice(1));
                return item === pat;
              })) continue;
              const full = path.join(sourceDir, item);
              if (fs.statSync(full).isDirectory()) await client.uploadFromDir(full, target.remoteDir + '/' + item);
              else await client.uploadFrom(full, target.remoteDir + '/' + item);
            }
            for (const extra of plan.extraFiles || []) {
              const full = path.join(dir, extra);
              if (fs.existsSync(full)) await client.uploadFrom(full, target.remoteDir + '/' + path.basename(extra));
            }
            // .fleet-sha marker
            const shaFile = path.join(dir, '.fleet-sha');
            fs.writeFileSync(shaFile, commitSha);
            await client.uploadFrom(shaFile, target.remoteDir + '/.fleet-sha');
          })(), 600000, 'upload-failed', 'FTP upload timed out');
        } catch (e) {
          throw e.code ? e : coded('upload-failed', 'FTP upload failed: ' + redactSecrets(e.message || ''));
        }
      }
    } finally {
      client.close();
    }
    // Healthcheck (60s)
    say(`healthcheck https://${deployment.domain}/`);
    try {
      await new Promise((resolve, reject) => {
        const https = require('https');
        const req = https.get(`https://${deployment.domain}/`, { timeout: 60000 }, (res) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 400) resolve();
          else reject(new Error('healthcheck status ' + res.statusCode));
        });
        req.on('timeout', () => { req.destroy(new Error('healthcheck timed out')); });
        req.on('error', reject);
      });
    } catch (e) {
      throw coded('healthcheck-failed', 'healthcheck failed: ' + redactSecrets(e.message || ''));
    }
    return { commitSha };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { runSteps };
