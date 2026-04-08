# Turkish-Art-Price-Agent Architecture

## Objective
Deliver a session-aware, evidence-first art price research system with deterministic extraction paths and controlled browser escalation.

## Pipeline
1. Search and source selection (`@artbot/source-registry`).
2. Candidate extraction with cheap path (`@artbot/extraction` via Firecrawl if configured, else HTTP parser).
3. Session-aware verification (`@artbot/browser-core` with cookie injection and persistent context).
4. Access/status classification (`public_access`, `auth_required`, `licensed_access`, `blocked`, `price_hidden`).
5. Normalization and dedupe (`@artbot/normalization`).
6. Comparable ranking and valuation gate (`@artbot/valuation`).
7. Output generation (`report.md`, `results.json`, evidence bundle).

## Runtime Components
- `apps/api`: enqueue research jobs, expose run status.
- `apps/worker`: poll pending jobs and execute orchestrator pipeline.
- `apps/cli`: operator command surface for artist/work research and run status checks.
- `packages/orchestrator`: end-to-end run coordinator.

## Storage and Evidence
- Metadata: SQLite via Node built-in `node:sqlite` (`data/artbot.db`).
- Evidence: filesystem under `runs/<run_id>/evidence/`.
- Artifacts: `runs/<run_id>/results.json` and `runs/<run_id>/report.md`.

## Auth and Session Model
- Operator-supplied profiles are loaded through `AUTH_PROFILES_JSON`.
- Access modes: anonymous, authorized, licensed.
- Session persistence: Playwright storage state per profile under `playwright/.auth/`.
- Session refresh policy: refresh missing/expired storage-state files or auth-failure sessions based on profile TTL.
- Cookie injection: optional cookie file per run/profile.
- Manual login checkpoint: optional pre/post-auth screenshots.

## Reliability Controls
- Deterministic adapters first.
- Browser retries with linear backoff.
- Per-candidate evidence capture.
- Structured status and blocker reasons for each source attempt.
- No bypass/brute-force logic.
