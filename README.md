# turkish-art-price-agent

Production-oriented Turkey-first painting price research bot with session-aware extraction, evidence capture, and strict structured outputs.

## Key Characteristics
- Local-first runtime: SQLite (`node:sqlite`) + filesystem evidence.
- Controlled pipeline: `search -> select source -> extract -> verify -> normalize -> score -> report`.
- Source access statuses: `public_access`, `auth_required`, `licensed_access`, `blocked`, `price_hidden`.
- Session-aware operation: authorized profiles, cookie injection, persistent browser state, manual-login checkpoints.
- Session refresh handling: expired or missing session state is refreshed before browser capture.
- Turkey-first coverage upgrades include `muzayedeapp-platform`, `portakal-catalog`, `clar-buy-now`, `clar-archive`, and `sanatfiyat-licensed-extractor`.
- Light discovery expansion adds bounded query variants and listing-to-lot routing before extraction.
- Comprehensive mode supports hybrid web discovery with strict host/domain caps.
- Historical FX normalization produces nominal USD plus CPI-adjusted 2026 USD outputs.
- Evidence-first records: screenshot + raw snapshot + parser metadata for each accepted/rejected candidate.

## Monorepo Layout
- `apps/api`: HTTP API (`POST /research/artist`, `POST /research/work`, `GET /runs`, `GET /runs/:id`)
- `apps/worker`: background run processor
- `apps/cli`: command line client
- `packages/*`: typed domain modules (auth, adapters, extraction, normalization, valuation, reporting, storage, orchestration)
- `docs/*`: architecture, ops, source matrix, dependency decisions, eval protocol, next-adapter roadmap
- `data/fixtures`: eval inputs
- `data/golden-results`: sample outputs

## Quick Start
1. Install dependencies:
   - `pnpm install`
2. Copy env:
   - `cp .env.example .env`
3. Build workspaces:
   - `pnpm build`
4. Start everything (API + worker + CLI):
   - `pnpm run start:artbot`
5. Check run status:
   - `pnpm --filter artbot dev -- runs show --run-id <id>`
6. Watch a run:
   - `pnpm --filter artbot dev -- runs watch --run-id <id> --interval 2`

## Install From npm
- `npm install -g artbot`
- `artbot setup`
- `artbot backend status`
- `artbot research artist --artist "Burhan Dogancay" --wait`

The npm package includes a local ArtBot API and worker runtime for no-hosting setup. External installs keep config, auth state, logs, and local data under `~/.artbot`.
LM Studio works out of the box with the default local server URL `http://127.0.0.1:1234/v1`.

Alternative manual startup:
- `pnpm --filter @artbot/api start`
- `pnpm --filter @artbot/worker start`
- `pnpm --filter artbot dev`

## Session-Aware CLI Flags
- `--auth-profile <id>`
- `--cookie-file <path>`
- `--manual-login`
- `--allow-licensed`
- `--licensed-integrations "askART,SomeLicensedSource"`
- `--analysis-mode comprehensive|balanced|fast`
- `--price-normalization legacy|usd_dual|usd_nominal|usd_2026`

## CLI v2 Commands
- `artbot research artist ...`
- `artbot research work ...`
- `artbot runs list [--status pending|running|completed|failed --limit 20]`
- `artbot runs show --run-id <id>`
- `artbot runs watch --run-id <id> [--interval 2]`
- Legacy aliases remain available: `research-artist`, `research-work`, `run-status`.

Global options:
- `--json` (strict JSON on stdout)
- `--api-base-url <url>`
- `--api-key <key>`
- `--verbose`
- `--quiet`

Environment fallback:
- `API_BASE_URL` (optional; defaults to `http://localhost:4000`)

## Auth Profile Configuration
Set `AUTH_PROFILES_JSON` in environment:

```json
[
  {
    "id": "artsy-profile",
    "mode": "authorized",
    "sourcePatterns": ["artsy"],
    "cookieFile": "/secure/path/artsy-cookies.json"
  },
  {
    "id": "sanatfiyat-license",
    "mode": "licensed",
    "sourcePatterns": ["sanatfiyat"],
    "storageStatePath": "/secure/path/sanatfiyat-state.json"
  }
]
```

## Output Artifacts
Each run writes:
- `runs/<run_id>/results.json`
- `runs/<run_id>/report.md`
- `runs/<run_id>/evidence/screenshots/*`
- `runs/<run_id>/evidence/raw/*`
- optional heavy evidence (selective mode): `runs/<run_id>/evidence/traces/*`, `runs/<run_id>/evidence/har/*`
- attempt-level auth evidence fields include `pre_auth_screenshot_path` and `post_auth_screenshot_path` when auth flows are used

## Model Policy
- Default model id variables: `MODEL_CHEAP_DEFAULT`, `MODEL_CHEAP_FALLBACK`
- Structured extraction provider: `STRUCTURED_LLM_PROVIDER=auto|gemini|openai_compatible`
- Local OpenAI-compatible inference (for example LM Studio) is supported via `LLM_BASE_URL`
- Gemini remains supported via `GEMINI_API_KEY`
- No hard-model escalation path enabled in v1

## Cost and Reliability Policy
- Deterministic parser path first.
- Firecrawl only when configured and useful.
- Browser verification only when needed (auth/session/low confidence).
- No brute force, credential stuffing, or unauthorized bypass behavior.

## Testing
- `pnpm test`

Unit/integration coverage includes:
- access status transitions,
- auth/session helper behavior,
- redaction,
- normalization + dedupe,
- adapter access-mode behavior.

## Docker
- Build: `docker build -t turkish-art-price-agent .`
- Compose: `docker compose up --build`

## Development

- Requirements: Node.js 22+, pnpm 10.x, a recent Docker version (optional but recommended for quick spins).
- Install dependencies with `pnpm install`.
- Run `pnpm build` to compile all workspaces, or `pnpm dev` to start dev servers where supported.
- Run `pnpm test` to execute the monorepo test suite.

## Contributing

Issues and pull requests are welcome. If you open a PR, try to:

- Keep changes focused and reasonably small.
- Add or update tests when behavior changes.
- Update documentation (including this README or docs/*) when you change user‑visible behavior.

## Security and responsible use

This project automates browsing and data collection. When using it, you are responsible for:

- Respecting each site's terms of service and robots.txt guidance.
- Using only accounts and licenses you are authorized to use.
- Avoiding abusive traffic patterns or attempts to bypass access controls.

If you believe you have found a security issue in the code, please open a private issue or contact the maintainer instead of disclosing it publicly first.

## License

Licensed under the Apache License, Version 2.0. See the LICENSE file in this repository for the full text.
