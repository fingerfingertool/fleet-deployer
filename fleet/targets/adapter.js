const vds = require('../deployer');
const staticSftp = require('./staticSftp');

function adapterFor(kind) {
  if (kind === 'static-sftp') return staticSftp;
  return vds;
}

module.exports = { adapterFor };
