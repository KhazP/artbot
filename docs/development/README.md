# Development Docs

Use this section as the starting point for contributors and maintainers.

## Entry Points

- Root quick start: `README.md`
- Operations runbook: `docs/ops.md`
- Architecture overview: `docs/architecture.md`
- Evaluation protocol: `docs/evals.md`

## Repository Conventions

- Scripts are grouped by purpose:
  - `scripts/dev/`
  - `scripts/setup/`
  - `scripts/ci/`
- Workspace runtime artifacts are written under `var/`.
- Package-level code lives in `packages/`; runnable surfaces live in `apps/`.

## Local Runtime Paths (Workspace Mode)

- Database: `var/data/artbot.db`
- Runs: `var/runs/`
- Logs: `var/logs/`
- Backend state: `var/state/backend-state.json`
