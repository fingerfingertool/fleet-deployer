const vds = require('../deployer');
const staticSftp = require('./staticSftp');

function adapterFor(kind) {
  if (kind === 'static-sftp') return staticSftp;
  if (kind === 'vds') return vds;
  throw new Error('Unknown target kind: ' + kind);
}

module.exports = { adapterFor };
