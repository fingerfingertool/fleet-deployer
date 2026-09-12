# HANDOFF — Fleet Deployer (read this first)

Repo: https://github.com/fingerfingertool/fleet-deployer (`master`)
Panel live: http://89.116.171.48:3100 (factory host, `fleet-panel` container, `compose.fleet.yml`)
Factory workspace note: the old session lived in a shared `ghostname` workspace; this repo is fleet-only.

## Where we are
- Admin panel skeleton done: Products / Targets-as-VDS-hosts / Deployments CRUD, branch=reskin model,
  hardened (shell quoting, dirty-check before checkout, key-paths-only, FK + mass-assignment guards). Tests: 11/11 green (`npx jest fleet/`).
- Harbor UI done (`fleet/public/index.html`): tally bar, tabs, ship-a-clone form, detail drawer w/ go-live checklist, propagate compare.
- Specs: `docs/superpowers/specs/2026-09-11-fleet-deployer-design.md` (v0.2, approved) +
  `docs/superpowers/specs/2026-09-12-static-targets-design.md` (awaiting "plan" approval).
- Plan (built): `docs/superpowers/plans/2026-09-11-fleet-deployer.md`.

## Agreed decisions (do not reopen without asking)
- Any branch = reskin; deploy any branch to any target. No edits on VDS (drift flagged).
- Manual VDS inventory (any provider), manual DNS v1, Caddy for TLS.
- Skills used: brainstorming → writing-plans → subagent-driven-development + test-driven-development + frontend-design + verification-before-completion.

## Next steps (in order)
1. Say "plan" → invoke `writing-plans` for the static-targets spec (Target-adapter model), then implement.
2. SSH worker: real deploy execution (ssh2, queue, logs, SHA capture, draft→running→live/failed) + redeploy/rollback/stop.
3. Canary on a real staging VDS + staging domain, prove end-to-end HTTPS.
4. Rotate the leaked PAT if not done (`ghp_...` was pasted in the old chat).

## Key files
- `fleet/server.js` (API), `fleet/store.js`, `fleet/deployer.js` (playbook strings), `fleet/propagate.js`, `fleet/run.js`, `fleet/public/index.html`
- `fleet.Dockerfile`, `compose.fleet.yml`
