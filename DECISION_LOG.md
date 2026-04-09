# DECISION_LOG

## 2026-04-09

### Decision: Keep explicit evidence vs valuation acceptance lanes
- **Decision**: runtime now carries `accepted_for_evidence` and `accepted_for_valuation` with lane + reasons.
- **Why**: single `accepted` boolean was allowing valuation contamination.
- **Tradeoff**: more schema/state surface, but materially better auditability.

### Decision: Hard valuation gate
- **Decision**: valuation consumes only `accepted_for_valuation` records.
- **Why**: prevent non-priced or inquiry-only records from influencing estimates.
- **Tradeoff**: lower short-term comp volume, higher trust.

### Decision: Confidence blending, not blind overwrite
- **Decision**: use confidence dimensions + `applyConfidenceModel(...)`; cap evidence-only confidence.
- **Why**: avoid misleading high confidence on non-valuation records.
- **Tradeoff**: still heuristic pending labeled calibration.

### Decision: Remove misleading Turkish Google-seed adapter
- **Decision**: `turkish-auction-generic` removed from active adapters.
- **Why**: brittle, low trust, policy noise.
- **Tradeoff**: less superficial breadth.

### Decision: Demote sensitive probes to opt-in
- **Decision**: `artsy/mutualart/askart/invaluable` probes now require `ENABLE_OPTIONAL_PROBE_ADAPTERS=true`.
- **Why**: avoid overstating default source coverage and reduce accidental low-trust ingestion.
- **Tradeoff**: fewer default integrations.

### Decision: Correct stale domains
- **Decision**: Clar -> `clarmuzayede.com`, Portakal -> `rportakal.com`.
- **Why**: increase real source yield and reduce broken routing.
- **Tradeoff**: fixture drift risk if source HTML changes.

### Decision: API must report real valuation status
- **Decision**: `/runs/:id` now reads valuation status/reason from results payload.
- **Why**: previous hardcoded `valuation_generated=false` violated operator trust.
- **Tradeoff**: slight file-IO overhead on run detail requests.

### Decision: Reproducibility first-class
- **Decision**: add CI workflow and `--frozen-lockfile` Docker install.
- **Why**: clean-machine reliability and regression detection.
- **Tradeoff**: stricter dependency discipline.

### Decision: Resolve default DB/runs paths from workspace root
- **Decision**: API and worker default `DATABASE_PATH`/`RUNS_ROOT` now resolve from workspace root (`INIT_CWD` fallback), not package-local cwd.
- **Why**: `pnpm --filter @artbot/api start` and `pnpm --filter @artbot/worker start` otherwise used different SQLite files and produced stuck `pending` runs.
- **Tradeoff**: defaults become repo-layout-aware; custom deployments should still set explicit env paths.
