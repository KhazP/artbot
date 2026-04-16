# ArtBot CLI Agent Guide

Use ArtBot as a command-first CLI.

- In this repo, prefer `pnpm --filter artbot dev -- ...`.
- For globally installed usage, replace that prefix with `artbot ...`.
- Bare `artbot` prints help. Open the interactive surface only with `artbot tui`.
- For automation or agent runs, prefer explicit commands and `--json`.
- If a wrapper must hard-disable the interactive UI, pass `--no-tui` or set `ARTBOT_NO_TUI=1`.

## Recommended Flow

Start with health checks before running research:

```bash
pnpm --filter artbot dev -- --json doctor
pnpm --filter artbot dev -- --json backend status
pnpm --filter artbot dev -- --json auth list
pnpm --filter artbot dev -- --json auth status
```

Use `setup` only for first-time bootstrap or broken local state:

```bash
pnpm --filter artbot dev -- setup
```

Preview the source plan before creating a run:

```bash
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --preview-only
pnpm --filter artbot dev -- --json research work --artist "Erol Akyavas" --title "Kusatma" --preview-only
```

Create a run, then inspect or wait:

```bash
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay"
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --wait
pnpm --filter artbot dev -- --json runs show --run-id <id>
pnpm --filter artbot dev -- --json runs watch --run-id <id> --interval 2
```

Use replay and review tools instead of re-running blindly:

```bash
pnpm --filter artbot dev -- --json replay attempt --run-id <id>
pnpm --filter artbot dev -- --json review queue --run-id <id>
pnpm --filter artbot dev -- --json review decide --run-id <id> --item-id <item-id> --decision merge
pnpm --filter artbot dev -- --json graph explain --run-id <id> --cluster-id <cluster-id>
```

Use canaries and cleanup explicitly:

```bash
pnpm --filter artbot dev -- --json canaries run
pnpm --filter artbot dev -- --json canaries history
pnpm --filter artbot dev -- --json cleanup --dry-run
```

## Policy

- Respect auth and licensed access boundaries.
- Never attempt bypass behavior for blocked, auth-required, or licensed sources.
- Prefer replay/debug commands, canaries, and health checks over repeated blind retries.
- Use the TUI only when a human explicitly wants the interactive workflow.
