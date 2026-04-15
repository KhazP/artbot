# Operations Runbook

## Prerequisites
- Node.js 20+
- pnpm 10+
- Playwright browser binaries (`pnpm exec playwright install`)

Note: `node:sqlite` may emit an experimental warning depending on Node version.

## Environment
Copy `.env.example` to `.env` and set:
- `ARTBOT_API_KEY`
- `API_BASE_URL` (optional; CLI base URL, defaults to `http://localhost:4000`)
- `DATABASE_PATH` (default: `./var/data/artbot.db`)
- `RUNS_ROOT` (default: `./var/runs`)
- `FIRECRAWL_API_KEY` (optional)
- `FIRECRAWL_ENABLED` (optional; default `false`, enables paid Firecrawl path only when explicitly set)
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (optional)
- `STRUCTURED_LLM_PROVIDER` (`auto` | `gemini` | `openai_compatible`; optional)
- `LLM_BASE_URL` (optional; OpenAI-compatible endpoint such as LM Studio)
- `LLM_API_KEY` (optional; OpenAI-compatible auth token if required)
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
- `pnpm --filter artbot dev -- research artist --artist "Burhan Dogancay" --wait`
- `pnpm --filter artbot dev -- research work --artist "Erol Akyavas" --title "Kusatma" --medium "oil on canvas" --height-cm 100 --width-cm 80`
- `pnpm --filter artbot dev -- runs list --status completed --limit 20`
- `pnpm --filter artbot dev -- runs show --run-id <id>`
- `pnpm --filter artbot dev -- runs watch --run-id <id> --interval 2`

CLI global options:
- `--json`
- `--api-base-url`
- `--api-key`
- `--verbose`
- `--quiet`

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
- Browser launched only for verification or auth/session-required contexts.
- No hard-model escalation path in v1.
