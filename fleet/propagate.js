function planPropagate(deps, mainHead) {
  return deps.map(d => ({ deploymentId: d.id, behind: d.currentCommit !== mainHead }));
}
module.exports = { planPropagate };
