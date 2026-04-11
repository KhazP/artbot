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
artbot runs list
artbot research artist --artist "Burhan Dogancay" --wait
artbot runs show --run-id <id>
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
