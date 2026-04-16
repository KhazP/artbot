# artbot

CLI for running ArtBot market research locally.

## Install

```bash
npm install -g artbot
```

## Fastest setup

ArtBot is designed to run with a local backend on your machine. No hosted ArtBot service is required.

1. Start LM Studio and enable its local OpenAI-compatible server.
2. Run:

```bash
artbot setup
```

By default, `artbot setup` configures and starts a local API and worker on `http://localhost:4000`.
The default LM Studio target is `http://127.0.0.1:1234/v1`, and `artbot setup` will normalize `http://127.0.0.1:1234` to that automatically.
The generated local config also pins structured extraction to the OpenAI-compatible local endpoint so LM Studio is used even if you have other model provider keys in your shell.

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
artbot research artist --artist "Burhan Dogancay" --wait
artbot runs show --run-id <id>
artbot runs watch --run-id <id> --interval 2
artbot runs pin --run-id <id>
artbot runs unpin --run-id <id>
artbot storage
artbot cleanup --dry-run
```

Bare `artbot` prints help. Open the interactive UI explicitly with `artbot tui`.

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
