# artbot

CLI for running ArtBot market research locally.

## Install

```bash
# recommended: global CLI install
npm install -g artbot

# optional: one-off run without global install
npx artbot@latest --help
```

> npmjs.com may show `npm i artbot` in the sidebar. That installs `artbot` as a local project dependency.
> For a globally available `artbot` command in your shell, use `npm install -g artbot`.

## Requirements

- Node.js 22+
- A local model endpoint (LM Studio recommended)

## Fastest setup

ArtBot is designed to run with a local backend on your machine. No hosted ArtBot service is required.

1. Start LM Studio and enable its local OpenAI-compatible server.
2. Start local services directly:

```bash
artbot backend start
```

3. Check health:

```bash
artbot backend status
```

4. Optional guided onboarding (interactive):

```bash
artbot setup
```

By default, `artbot setup` configures and can start a local API and worker on `http://localhost:4000`.
The default LM Studio target is `http://127.0.0.1:1234/v1`, and `artbot setup` will normalize `http://127.0.0.1:1234` to that automatically.
The generated local config also pins structured extraction to the OpenAI-compatible local endpoint so LM Studio is used even if you have other model provider keys in your shell.
Plan generation for research commands can take roughly 45-60 seconds on a cold start. Keep the command running until progress completes.

ArtBot stores its local state here:

```text
~/.artbot
```

That directory contains:

- `.env`
- `data/artbot.db`
- `runs/`
- `logs/`
- `playwright/.auth/`

## Backend commands

```bash
artbot backend start
artbot backend status
artbot backend stop
```

`artbot local start|status|stop` is also available as an alias.

## Usage

```bash
artbot
artbot tui
artbot runs list
artbot --json runs list --limit 20
artbot research artist --artist "Burhan Dogancay" --wait
artbot runs show --run-id <id>
artbot --json runs show --run-id <id>
artbot runs watch --run-id <id> --interval 2
artbot runs pin --run-id <id>
artbot runs unpin --run-id <id>
artbot storage
artbot cleanup --dry-run
```

Bare `artbot` prints help. Open the interactive UI explicitly with `artbot tui`.

## Interactive UI (Local-First)

The TUI status strip is tuned for local-first usage:

- persistent `CLOUD OFFLINE (LOCAL-ONLY)` status,
- `PRIVACY LOCKED` badge,
- sandbox indicator (`ISOLATED: ...`),
- active model metadata with detected quantization (when available),
- high-speed `THINKING` pulse during active inference,
- animated run-stage spinner in the main run panel while research is active.

This release does not include local hardware telemetry in the UI.

Optional environment flags for the sandbox badge:

```bash
export ARTBOT_AIR_GAPPED=1          # shows ISOLATED: NO-NETWORK
export ARTBOT_SANDBOX_MODE=landlock # shows ISOLATED: LANDLOCK
```

## Run retention and storage visibility

Use run pinning to preserve a completed run and retained artifacts through automatic cleanup and manual GC:

```bash
artbot runs pin --run-id <id>
artbot runs unpin --run-id <id>
```

Use storage visibility to inspect disk state before cleanup:

```bash
artbot storage
artbot --json storage
artbot cleanup --dry-run
```

`artbot storage` reports:

- total `var/` usage,
- pinned run count,
- expirable run count,
- last cleanup reclaimed bytes and timestamp.

## Automation / Agents

Prefer explicit commands plus `--json`:

```bash
artbot --json doctor
artbot --json backend status
artbot --json auth list
artbot --json auth status
artbot --json research artist --artist "Burhan Dogancay" --preview-only
artbot --json research artist --artist "Burhan Dogancay" --wait
artbot --json runs list --limit 20
artbot --json runs show --run-id <id>
artbot --json replay attempt --run-id <id>
artbot --json runs pin --run-id <id>
artbot --json runs unpin --run-id <id>
artbot --json storage
artbot --json cleanup --dry-run
```

If an automation wrapper must hard-disable the interactive UI, pass `--no-tui` or set:

```bash
export ARTBOT_NO_TUI=1
```

When `--no-tui` (or `ARTBOT_NO_TUI=1`) is active, `artbot setup` will not open interactive prompts and instead prints non-interactive guidance.

## Remote API override

If you already run an ArtBot API somewhere else, point the CLI at it with `API_BASE_URL`:

```bash
export API_BASE_URL=https://your-artbot-api.example.com
artbot runs list
```

## Auth capture

Some sources need saved browser sessions. Capture them with:

```bash
artbot auth list
artbot auth capture <profile-id>
```

If Playwright has not installed a browser yet on your machine, run:

```bash
playwright install chromium
```
