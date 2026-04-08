# Operations Runbook

## Prerequisites
- Node.js 20+
- pnpm 10+
- Playwright browser binaries (`pnpm exec playwright install`)

Note: `node:sqlite` may emit an experimental warning depending on Node version.

## Environment
Copy `.env.example` to `.env` and set:
- `ARTBOT_API_KEY`
- `DATABASE_PATH`
- `RUNS_ROOT`
- `FIRECRAWL_API_KEY` (optional)
- `BROWSERBASE_API_KEY` + `BROWSERBASE_PROJECT_ID` (optional)

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
    "id": "askart-license",
    "mode": "licensed",
    "sourcePatterns": ["askart"],
    "storageStatePath": "/secure/path/askart-state.json"
  }
]
```

## Start Services
1. Build: `pnpm build`
2. API: `pnpm --filter @artbot/api start`
3. Worker: `pnpm --filter @artbot/worker start`

## CLI Usage
- `pnpm --filter @artbot/cli dev -- research-artist --artist "Burhan Dogancay" --turkey-first`
- `pnpm --filter @artbot/cli dev -- research-work --artist "Erol Akyavas" --title "Kusatma" --medium "oil on canvas" --height-cm 100 --width-cm 80`

Session-aware flags:
- `--auth-profile <id>`
- `--cookie-file <path>`
- `--manual-login`
- `--allow-licensed`
- `--licensed-integrations "askART,SomeLicensedSource"`

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

## Cost Controls
- Cheap extraction first (`Firecrawl` if configured; otherwise direct fetch parser).
- Browser launched only for verification or auth/session-required contexts.
- No hard-model escalation path in v1.
