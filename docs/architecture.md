# Turkish-Art-Price-Agent Architecture

## Objective
Deliver a session-aware, evidence-first art price research system with deterministic extraction paths and controlled browser escalation.

## Pipeline
1. Search and source selection (`@artbot/source-registry`).
2. Light discovery expansion (query variants + bounded candidate queue + listing-to-lot expansion).
3. Candidate extraction with cheap path (`@artbot/extraction` via Firecrawl if configured, else HTTP parser).
4. Session-aware verification (`@artbot/browser-core` with cookie injection and persistent context).
5. Access/status classification (`public_access`, `auth_required`, `licensed_access`, `blocked`, `price_hidden`).
6. Normalization and dedupe (`@artbot/normalization`).
7. Comparable ranking and valuation gate (`@artbot/valuation`).
8. Output generation (`report.md`, `results.json`, evidence bundle).

## Runtime Components
- `apps/api`: enqueue research jobs, expose run status.
- `apps/worker`: poll pending jobs and execute orchestrator pipeline.
- `apps/cli`: operator command surface for artist/work research and run status checks.
- `packages/orchestrator`: end-to-end run coordinator.

## Storage and Evidence
- Metadata: SQLite via Node built-in `node:sqlite` (`var/data/artbot.db`).
- Evidence: filesystem under `var/runs/<run_id>/evidence/`.
- Artifacts: `var/runs/<run_id>/results.json` and `var/runs/<run_id>/report.md`.

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
- Selective heavy evidence mode (`EVIDENCE_TRACE_MODE=selective`) captures Playwright trace/HAR for failed or low-confidence attempts.
- Schema-bound LLM fallback (Gemini or OpenAI-compatible local endpoint) is used only when deterministic parsing is insufficient.
- Per-candidate evidence capture.
- Structured status and blocker reasons for each source attempt.
- No bypass/brute-force logic.
