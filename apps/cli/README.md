# artbot

Local-first CLI for ArtBot art-market research, source discovery, evidence capture, and valuation support.

## Install

```bash
npm install -g artbot
artbot --help
```

For a one-off check:

```bash
npx artbot@latest --help
```

The npm package includes the CLI plus bundled local API and worker runtime. No hosted ArtBot service is required. Local state is stored under `~/.artbot` by default.

## Requirements

- Node.js 22+
- An OpenAI-compatible model endpoint for model-backed extraction/setup paths
- Playwright Chromium for auth capture and browser verification flows

## Fast Start

```bash
artbot backend start
artbot backend status
artbot research artist --artist "Burhan Dogancay" --preview-only
artbot research artist --artist "Burhan Dogancay" --wait
```

Optional guided onboarding:

```bash
artbot setup
```

`artbot setup` can configure local LM Studio, NVIDIA, or another OpenAI-compatible endpoint. Plan generation can take 45-60 seconds on a cold start.

## Commands

Bare `artbot` opens the interactive TUI in an interactive terminal. Use explicit subcommands for automation.

```bash
# Backend and health
artbot doctor
artbot backend start
artbot backend status
artbot backend stop

# Research
artbot research artist --artist "Fikret Mualla" --preview-only
artbot research artist --artist "Fikret Mualla" --wait
artbot research work --artist "Bedri Rahmi Eyuboglu" --title "Mosaic" --wait

# Runs and reports
artbot runs list --limit 20
artbot runs show --run-id <id>
artbot runs watch --run-id <id> --interval 2
artbot runs deep-research --run-id <id>
artbot runs deep-research --run-id <id> --web

# Storage
artbot runs pin --run-id <id>
artbot runs unpin --run-id <id>
artbot storage
artbot cleanup --dry-run

# Debug/review
artbot replay attempt --run-id <id>
artbot review queue --run-id <id>
artbot graph explain --run-id <id> --cluster-id <cluster-id>
artbot canaries run
```

Global machine-output options:

```bash
artbot --json runs list
artbot --output-format stream-json runs watch --run-id <id>
```

Set `ARTBOT_NO_TUI=1` or pass `--no-tui` when an automation wrapper must not open interactive prompts.

## Custom Source Websites

Add operator-controlled websites to `artbot.sources.json`:

```bash
artbot sources list --json
artbot sources validate
artbot sources add \
  --name "Example Auction Archive" \
  --url "https://example.com" \
  --search-template "https://example.com/search?q={query}" \
  --access public \
  --source-class auction_house
artbot sources remove --id example-auction-archive
```

Config path resolution:

1. `ARTBOT_SOURCES_PATH`
2. `ARTBOT_HOME/artbot.sources.json`
3. `INIT_CWD/artbot.sources.json`
4. `./artbot.sources.json`

Supported access modes:

- `public`: anonymous public access first.
- `auth`: source remains visible as `auth_required` until a matching session exists.
- `licensed`: requires `--allow-licensed` and matching `--licensed-integrations`.

Example:

```json
{
  "version": 1,
  "sources": [
    {
      "id": "member-price-db",
      "name": "Member Price DB",
      "url": "https://member.example",
      "searchTemplate": "https://member.example/search?q={query}",
      "access": "auth",
      "sourceClass": "database",
      "authProfileId": "member-db"
    }
  ]
}
```

Do not store passwords or API secrets in `artbot.sources.json`.

## Auth Capture

Configure auth profiles with `AUTH_PROFILES_JSON`, then capture browser storage state:

```bash
artbot trust allow
artbot auth list
artbot auth status
artbot auth capture member-db --url https://member.example/login
```

Research flags:

```bash
artbot research artist \
  --artist "Burhan Dogancay" \
  --auth-profile member-db \
  --allow-licensed \
  --licensed-integrations "Sanatfiyat" \
  --wait
```

Interactive setup, TUI launch, auth capture, and backend start/stop require workspace trust:

```bash
artbot trust status
artbot trust allow
artbot trust deny
```

## Local State

By default, ArtBot stores runtime state under:

```text
~/.artbot
```

Expected contents include:

- `.env`
- `data/artbot.db`
- `runs/`
- `logs/`
- `playwright/.auth/`
- `artbot.sources.json` when custom sources are configured under `ARTBOT_HOME`

## Models

Core setup supports local LM Studio, NVIDIA, and custom OpenAI-compatible endpoints through:

- `LLM_BASE_URL`
- `LLM_API_KEY`
- `LLM_MODEL`
- `STRUCTURED_LLM_PROVIDER`
- `STAGEHAND_MODE`

Experimental Gemini Deep Research is opt-in from the TUI. It runs after normal research, writes `deep-research.json`, and can be inspected with:

```bash
artbot runs deep-research --run-id <id>
artbot runs deep-research --run-id <id> --web
```

This feature is cloud-based and can be expensive. Set a Google AI Studio spend cap before heavy use.

## Responsible Use

Use only public, credentialed, or licensed access that you are authorized to use. Do not use ArtBot for credential stuffing, CAPTCHA evasion, paywall bypass, or other access-control circumvention.

## Links

- Repository: https://github.com/KhazP/artbot
- npm: https://www.npmjs.com/package/artbot
- License: Apache-2.0
