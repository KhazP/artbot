# Operations Runbook

## Prerequisites

- Node.js 22+
- pnpm 10+
- Playwright browser binaries (`pnpm exec playwright install`)

Note: direct API/worker node entrypoints may emit a `node:sqlite` experimental warning depending on Node version. The published `artbot` CLI suppresses this specific warning.

## Environment

Copy `.env.example` to `.env` and set:

- `ARTBOT_API_KEY`
- `API_BASE_URL` (optional; CLI base URL, defaults to `http://localhost:4000`)
- `DATABASE_PATH` (default: `./var/data/artbot.db`)
- `RUNS_ROOT` (default: `./var/runs`)
- `FIRECRAWL_API_KEY` (optional)
- `FIRECRAWL_ENABLED` (optional; default `false`, enables the public-page Firecrawl cheap-fetch path only when explicitly set)
- `FIRECRAWL_BASE_URL` (optional; set this when using a self-hosted Firecrawl backend)
- `FIRECRAWL_TIMEOUT_MS`, `FIRECRAWL_MAX_RETRIES` (optional; cheap-fetch safety limits for Firecrawl transport)
- `FIRECRAWL_SOURCE_FAMILIES` (optional comma-separated allowlist; restrict Firecrawl to specific source families such as `artam,public-db`)
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (optional; required only when `STAGEHAND_MODE=BROWSERBASE`)
- `STRUCTURED_LLM_PROVIDER` (`auto` | `gemini` | `openai_compatible`; optional)
- `LLM_MODEL` (optional; canonical OpenAI-compatible model ID used by the CLI and Stagehand LOCAL)
- `LLM_BASE_URL` (optional; OpenAI-compatible endpoint such as LM Studio or `https://integrate.api.nvidia.com/v1`)
- `LLM_API_KEY` (optional; OpenAI-compatible auth token if required; local LM Studio can keep `lm-studio`)
- `STAGEHAND_MODE` (`DISABLED` | `LOCAL` | `BROWSERBASE`; optional, onboarding defaults to `LOCAL`)
- `GEMINI_API_KEY` (optional; schema-bound fallback extraction when provider is `gemini` or `auto`)
- `DISCOVERY_MAX_CANDIDATES_PER_SOURCE`
- `DISCOVERY_MAX_VARIANTS`
- `DISCOVERY_DOMAIN_THROTTLE_PER_SOURCE`
- `WEB_DISCOVERY_ENABLED`, `WEB_DISCOVERY_PROVIDER`, `WEB_DISCOVERY_SECONDARY_PROVIDER`
- `SEARXNG_BASE_URL` (default local endpoint: `http://127.0.0.1:8080`)
- `BRAVE_SEARCH_API_KEY`, `TAVILY_API_KEY` (optional paid providers; opt-in only)
- `WEB_DISCOVERY_PREFERRED_HOST_TOKENS`, `WEB_DISCOVERY_LOW_QUALITY_HOST_TOKENS`, `WEB_DISCOVERY_MIN_HOST_QUALITY_SCORE`
- `WEB_DISCOVERY_MAX_DOMAINS_PER_RUN`, `WEB_DISCOVERY_MAX_URLS_PER_DOMAIN`, `WEB_DISCOVERY_MAX_TOTAL_CANDIDATES`
- `FX_PROVIDER`, `FX_TRY_FALLBACK_PROVIDER`, `USD_INFLATION_PROVIDER`, `USD_INFLATION_BASE_YEAR`
- `EVIDENCE_TRACE_MODE` (`selective` recommended)

Stagehand mode notes:

- `STAGEHAND_MODE=LOCAL` uses the configured `LLM_BASE_URL`, `LLM_API_KEY`, and `LLM_MODEL` against a local Playwright browser.
- `STAGEHAND_MODE=BROWSERBASE` uses Browserbase credentials instead of the local browser path.
- `MODEL_CHEAP_DEFAULT` is still read as a compatibility fallback, but setup now keeps it synced from `LLM_MODEL` during the transition.

Path resolution guardrails:

- In workspace mode, relative `DATABASE_PATH` and `RUNS_ROOT` values are resolved from the workspace root (not the current package working directory).
- API, worker, and CLI persist a shared manifest at `var/state/runtime-storage-paths.json`.
- Startup fails fast when a process resolves a different DB/runs pair than the manifest to prevent split runtime state.

## Auth Profiles

Provide `AUTH_PROFILES_JSON` as JSON array:

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
    "storageStatePath": "/secure/path/sanatfiyat-state.json",
    "usernameEnv": "SANATFIYAT_USERNAME",
    "passwordEnv": "SANATFIYAT_PASSWORD"
  }
]
```

Capture/update browser session states (manual login):

- `pnpm exec playwright install chromium`
- `scripts/setup/capture-auth-state.sh artsy-auth`
- `scripts/setup/capture-auth-state.sh mutualart-auth`
- `scripts/setup/capture-auth-state.sh sanatfiyat-license`
- `scripts/setup/capture-auth-state.sh askart-license`

## Start Services

1. Build: `pnpm build`
2. API: `pnpm --filter @artbot/api start`
3. Worker: `pnpm --filter @artbot/worker start`
4. Optional local SearXNG bootstrap: `docker compose --profile local-infra up -d searxng`

## CLI Usage

- Bare `pnpm --filter artbot dev --` opens the interactive UI in an interactive terminal.
- Use `pnpm --filter artbot dev -- tui` as an explicit alias.
- Prefer `--json` for automation and agent runs.
- `pnpm --filter artbot dev -- research artist --artist "Burhan Dogancay" --wait`
- `pnpm --filter artbot dev -- research work --artist "Erol Akyavas" --title "Kusatma" --medium "oil on canvas" --height-cm 100 --width-cm 80`
- `pnpm --filter artbot dev -- runs list --status completed --limit 20`
- `pnpm --filter artbot dev -- runs show --run-id <id>`
- `pnpm --filter artbot dev -- runs watch --run-id <id> --interval 2`
- `pnpm --filter artbot dev -- runs pin --run-id <id>`
- `pnpm --filter artbot dev -- runs unpin --run-id <id>`
- `pnpm --filter artbot dev -- storage`
- `pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --preview-only`
- `pnpm --filter artbot dev -- --json runs list --limit 20`
- `pnpm --filter artbot dev -- --json runs show --run-id <id>`
- `pnpm --filter artbot dev -- --json replay attempt --run-id <id>`
- `pnpm --filter artbot dev -- --json storage`
- `pnpm --filter artbot dev -- --json cleanup --dry-run`

Operational notes:

- Source-plan generation may take around 45-60 seconds on a cold start; CLI progress output confirms the command is active.
- When `--no-tui` or `ARTBOT_NO_TUI=1` is set, `artbot setup` exits without interactive prompts and prints non-interactive guidance.

CLI global options:

- `--json`
- `--api-base-url`
- `--api-key`
- `--verbose`
- `--quiet`
- `--no-tui`

Automation guardrail:

- `ARTBOT_NO_TUI=1`

Session-aware flags:

- `--auth-profile <id>`
- `--cookie-file <path>`
- `--manual-login`
- `--allow-licensed`
- `--licensed-integrations "askART,SomeLicensedSource"`
- `--analysis-mode comprehensive|balanced|fast`
- `--price-normalization legacy|usd_dual|usd_nominal|usd_2026`

## Access Policy

- Anonymous mode for public pages.
- Authorized mode for lawful operator credentials/session usage.
- Licensed mode for operator-provided licensed integrations.
- No bypass, credential stuffing, or brute-force access.
- On auth/session failures, refresh persisted session state and retry only within configured policy caps.

## Failure Buckets

- `auth_required`: source needs login and no valid authorized flow available.
- `licensed_access`: licensed connector used.
- `blocked`: legal/contractual/technical block.
- `price_hidden`: no public numeric price.

## Evidence Requirements

- For each source attempt, capture canonical URL, structured extracted fields, timestamp, parser/model, confidence, acceptance reason.
- For browser-auth flows, persist `pre_auth_screenshot_path` and `post_auth_screenshot_path` in attempt evidence.
- In selective-heavy mode, capture trace/HAR for failed or low-confidence attempts.

## Cost Controls

- Cheap extraction first (direct local HTTP parser by default; Firecrawl only when `FIRECRAWL_ENABLED=true`).
- Firecrawl stays in the cheap, stateless public-access lane; authenticated/sessioned flows still belong to Playwright/browser verification.
- Browser launched only for verification or auth/session-required contexts.
- Structured LLM extraction stays schema-bound only; LangChain is used for typed extraction orchestration, not agentic crawling.
- No hard-model escalation path in v1.

## Diagnostics

The Ink shell now exposes diagnostics-first side panes for operators:

- `/sources` for source-level attempts, priced outcomes, auth-required hits, and blocks.
- `/normalize` for raw price token, TL/YTL/TRL interpretation, historical/current FX, and inflation-adjusted USD/EUR.
- `/review` plus `/review merge <id>` or `/review keep <id>` for duplicate-review adjudication on inventory runs.
- `/fx` for SQLite FX cache row counts, source mix, and latest cached date.
- `/errors` for recent transport, blocker, and parse failures.

Normalization traces and FX cache stats are also available over the API:

- `GET /runs/:id/normalization-events`
- `GET /fx/cache`
