# Development Docs

Use this section as the starting point for contributors and maintainers.

## Entry Points

- Root quick start: `README.md`
- npm package readme: `apps/cli/README.md`
- Operations runbook: `docs/ops.md`
- Architecture overview: `docs/architecture.md`
- Evaluation protocol: `docs/evals.md`

## Command-First Automation

- Prefer command mode with JSON output for scripts and agents.
- Repo-local pattern: `pnpm --filter artbot dev -- --json <command>`.
- To hard-disable interactive UI launch in wrappers, use `--no-tui` or `ARTBOT_NO_TUI=1`.

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
