# AUDIT

## 1) Executive Summary
- The core integrity hypothesis was correct: the runtime previously accepted non-priced records and allowed them to appear as high-confidence comps.
- I verified this on bundled artifact `runs/fd4da644-0900-4fb7-8dfb-cb32485faaae/results.json` (`22` accepted, `0` with numeric price).
- The architecture is still a prototype-style orchestrator: discovery is bounded expansion, adapter depth is mixed, and valuation logic remains lightweight.
- P0 implementation in this pass focused on trust gates and operational truthfulness:
  - typed acceptance enforcement in adapters and pipeline
  - valuation-only hard filtering
  - confidence model wiring (no blind overwrite)
  - stale Turkish domains corrected
  - Google-seeded Turkish generic adapter removed
  - API `/runs/:id` now reports actual valuation status from results
  - CI and deterministic Docker install added
- End-to-end app flow was run successfully (API + worker + CLI) with completed run:
  - run id `acd189dd-1491-41f3-88e4-e5a2351f424d`
  - `valuation_eligible_records = 0`
  - `accepted_for_valuation` null-price contamination = `0`

## 2) Detailed Findings By Severity

### Critical
1. Acceptance/valuation contamination (verified and fixed)
- Previous behavior: `priceType !== "unknown" || priceHidden` could accept non-priced records.
- Fix: typed acceptance and valuation eligibility now enforced in adapters via shared acceptance logic.
- Result: evidence-only records are retained, but excluded from valuation.

2. Confidence semantics mismatch (partially fixed)
- Previous behavior: pipeline overwrote adapter confidence with generic field-presence score.
- Fix: pipeline now uses `applyConfidenceModel(...)` to blend confidence dimensions and cap evidence-only records.
- Remaining: confidence calibration still needs labeled dataset tuning.

3. Query leakage into extracted fields (fixed)
- Previous behavior: title/year/medium/dimensions were filled from query when parser lacked fields.
- Fix: adapters now preserve query as hint notes, and keep extracted fields page-derived.

### High
4. Source coverage truthfulness gap (partially fixed)
- Previous behavior: active matrix included low-trust probes and Google-seeded Turkish generic.
- Fix: removed `turkish-auction-generic`; optional probes are now disabled by default behind `ENABLE_OPTIONAL_PROBE_ADAPTERS=true`.
- Remaining: many adapters are still probe/partial depth and require source-specific deep parsing.

5. Stale Turkish source configs (fixed)
- `portakal-catalog` updated to `https://www.rportakal.com`
- `clar-*` updated to `https://www.clarmuzayede.com`

6. Valuation model weakness (partially fixed)
- Fixes added:
  - valuation uses `accepted_for_valuation` only
  - lane-aware ranges (`realized/estimate/asking`)
  - ranking includes lane weighting, Turkey uplift, and recency bonus
- Remaining:
  - still no strong comparable feature model (title similarity, dimension distance, venue priors, etc.)

### Medium
7. Discovery/runtime architecture
- Still bounded candidate expansion and no persistent frontier/lease/reclaim.
- This remains a P1/P2 architectural item.

8. Worker resiliency
- Worker still lacks lease heartbeat/recovery semantics for interrupted runs.
- (Observed during manual kill/restart).

## 3) Source Coverage Matrix (Current Reality)
| Bucket | Reality | Status |
|---|---|---|
| Turkish deterministic adapters | Partial depth with generic parsing backbone | Active |
| Turkish generic adapters | Probe-level | Active but limited |
| International house adapters | Probe-level search/listing integrations | Active |
| Auth/licensed probes | Risky for default runs | Disabled by default |
| Discovery | Bounded in-memory expansion | Active |

## 4) Critical Integrity Risks (Current)
- Missing historical benchmark dataset for confidence calibration and valuation backtests.
- Frontier/lease model absent; interrupted runs can remain `running`.
- Core extraction still regex-heavy for many sources despite parser improvements.

## 5) Prioritized Roadmap
- **P0 (done in this pass)**:
  - typed acceptance + valuation gate
  - confidence model wiring
  - stale domain corrections
  - source truthfulness cleanup for obvious probes
  - API valuation truthfulness
  - CI + deterministic Docker install
- **P1**:
  - deepen top Turkey-first adapters with source-specific selectors/contracts
  - add source contract tests per adapter class
  - improve comparable scoring factors
- **P2**:
  - persistent frontier + worker lease/heartbeat/reclaim
  - per-source concurrency/budget controls
  - targeted international deep connectors
- **P3**:
  - licensed integrations under explicit policy
  - advanced valuation/backtest framework

## 6) Open Questions / Assumptions
- What minimum confidence/quality threshold is acceptable for operator-visible evidence-only records?
- Should estimate-range midpoint be used in valuation lane by default, or remain presentation-only?
- Which licensed sources are approved for internal use in production runs?
- What browser/runtime cost budget is acceptable per completed run?
