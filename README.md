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
4. Start services:
   - `pnpm --filter @artbot/api start`
   - `pnpm --filter @artbot/worker start`
5. Trigger a run:
   - `pnpm --filter @artbot/cli dev -- research artist --artist "Burhan Dogancay" --wait`
6. Check run status:
   - `pnpm --filter @artbot/cli dev -- runs show --run-id <id>`
7. Watch a run:
   - `pnpm --filter @artbot/cli dev -- runs watch --run-id <id> --interval 2`

## Session-Aware CLI Flags
- `--auth-profile <id>`
- `--cookie-file <path>`
- `--manual-login`
- `--allow-licensed`
- `--licensed-integrations "askART,SomeLicensedSource"`

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
- Preferred cheap/default: `gemini-3.1-flash-lite`
- Stable fallback: `gemini-2.5-flash-lite`
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
