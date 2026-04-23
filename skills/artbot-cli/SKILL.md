---
name: artbot-cli
description: Use when operating the ArtBot CLI for local backend lifecycle, health checks, run creation, run inspection, replay debugging, review queue work, canaries, cleanup, or command-first automation. Prefer JSON-first commands, explicit subcommands, and non-TUI usage. Relevant terms include ArtBot CLI, artbot doctor, backend status, research artist, research work, runs show, runs watch, replay attempt, review queue, canaries, cleanup, and command-only automation.
---

# ArtBot CLI

Use this skill when you need to operate ArtBot effectively from the command line.

## Core Rules

- In this repo, prefer `pnpm --filter artbot dev -- ...`.
- For installed usage, replace that prefix with `artbot ...`.
- Bare `artbot` opens the interactive UI in an interactive TTY. Use explicit subcommands plus `--json` for automation.
- For agent work, prefer explicit commands and `--json` or `--output-format stream-json`.
- Keep `--no-tui` or `ARTBOT_NO_TUI=1` available when automation must refuse interactive UI launch.
- Interactive setup, TUI launch, auth capture, and local backend start/stop require `artbot trust allow` for the current workspace.

## Decision Tree

If you are not sure whether the environment is healthy:

```bash
pnpm --filter artbot dev -- --json doctor
pnpm --filter artbot dev -- --json backend status
pnpm --filter artbot dev -- --json auth list
pnpm --filter artbot dev -- --json auth status
pnpm --filter artbot dev -- trust status
```

If the machine is not bootstrapped yet or local config is broken:

```bash
pnpm --filter artbot dev -- setup
```

If you want to understand planned sourcing before creating a run:

```bash
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --preview-only
pnpm --filter artbot dev -- --json research work --artist "Erol Akyavas" --title "Kusatma" --preview-only
```

If you want the finished terminal payload in one command:

```bash
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --wait
pnpm --filter artbot dev -- --json research work --artist "Erol Akyavas" --title "Kusatma" --wait
```

If you already have a run id:

```bash
pnpm --filter artbot dev -- --json runs show --run-id <id>
pnpm --filter artbot dev -- --json runs watch --run-id <id> --interval 2
pnpm --filter artbot dev -- --output-format stream-json runs watch --run-id <id>
pnpm --filter artbot dev -- sessions resume
```

If parsing or acceptance looks wrong, replay stored artifacts before re-running:

```bash
pnpm --filter artbot dev -- --json replay attempt --run-id <id>
```

If a run produced review items or clustering questions:

```bash
pnpm --filter artbot dev -- --json review queue --run-id <id>
pnpm --filter artbot dev -- --json review decide --run-id <id> --item-id <item-id> --decision merge
pnpm --filter artbot dev -- --json graph explain --run-id <id> --cluster-id <cluster-id>
```

If you need smoke checks or retention work:

```bash
pnpm --filter artbot dev -- --json canaries run
pnpm --filter artbot dev -- --json canaries history
pnpm --filter artbot dev -- --json cleanup --dry-run
```

## Usage Notes

- `--json` is the default choice when another tool or agent will read the output.
- `--output-format stream-json` is preferred when another tool wants incremental NDJSON lifecycle events.
- `setup` is intentionally interactive; do not use it as a normal health probe.
- `artbot tui` is for humans. Stay in command mode unless the task explicitly calls for the interactive UI.
- Respect auth and licensed access boundaries. Do not attempt bypass behavior.
- Install this repo skill explicitly by copy or symlink from `skills/artbot-cli`; package install must not write into agent homes automatically.
