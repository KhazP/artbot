# IMPLEMENTATION_PLAN

## P0 / P1 / P2 / P3 Backlog

## P0 (Integrity + Trust Baseline)
1. Typed acceptance model (`accepted_for_evidence`, `accepted_for_valuation`, lane, reasons). ✅ done
2. Hard valuation gate on valuation-eligible records. ✅ done
3. Confidence redesign and pipeline wiring. ✅ done
4. Remove misleading Turkish Google-seed adapter. ✅ done
5. Correct stale Clar/Portakal domains. ✅ done
6. Parser hardening (metadata + structured + regex chain). ✅ done (baseline)
7. API valuation truthfulness (`/runs/:id`). ✅ done
8. CI + deterministic Docker install. ✅ done

## P1 (Depth + Explainability)
1. Deep source-specific selectors/parsers for top Turkish sources.
2. Adapter contract tests with fixture snapshots per source.
3. Comparable scoring factors beyond lane/confidence (title/medium/size/year).
4. Operator-focused diagnostics for comp influence explanations.

## P2 (Runtime Architecture)
1. Persistent frontier table and canonical request identity.
2. Worker lease/heartbeat/reclaim and stuck-run recovery.
3. Per-domain budgets, retries, and backoff policies.
4. Controlled international deep connectors.

## P3 (Advanced Internal Capability)
1. Licensed-source connectors under explicit policy and access controls.
2. Historical benchmarking and backtest dataset.
3. Advanced valuation models once benchmark quality is sufficient.

## 30 / 60 / 90 Day Roadmap
- **0-30 days**
  - complete Turkey-first adapter deepening for top 6
  - ship contract tests and source health checks
  - stabilize precision of valuation-eligible records
- **31-60 days**
  - implement frontier + leases + retry scheduling
  - expand explainable comparable scoring features
  - add source-level observability dashboards
- **61-90 days**
  - expand selected international connectors with deep extraction
  - evaluate licensed connector rollout
  - start valuation backtests against curated history

## Quick Wins This Week
1. Add per-source selector contracts for Bayrak, Müzayede App, Artam, Clar, Portakal, AlifArt.
2. Add regression tests for:
   - no valuation-eligible null-price records
   - acceptance reason breakdown consistency
3. Add run timeout/stuck-run recovery policy.
4. Add source health report command for operators.

## Exact Success Metrics (Top Items)
1. `accepted_for_valuation` records with missing numeric valuation input: **0%**.
2. `accepted_for_valuation` records missing currency where required: **0%**.
3. Top Turkish source contract test pass rate: **>=95%**.
4. End-to-end run completion in constrained mode: **100%** on smoke set.
5. API valuation status mismatch vs results file: **0%**.

## Files / Modules Affected (This Pass)
- `packages/source-adapters/src/adapters/custom-adapter-utils.ts`
- `packages/source-adapters/src/adapters/generic-adapter.ts`
- `packages/source-adapters/src/adapters/specialized-adapters.ts`
- `packages/source-adapters/src/adapters/seed-adapters.ts`
- `packages/extraction/src/lot-parser.ts`
- `packages/orchestrator/src/pipeline.ts`
- `packages/valuation/src/ranking.ts`
- `packages/valuation/src/range.ts`
- `packages/report-generation/src/markdown.ts`
- `packages/normalization/src/confidence.ts`
- `apps/api/src/server.ts`
- `packages/shared-types/src/record.ts`
- `docs/source-matrix.md`
- `docs/evals.md`
- `Dockerfile`
- `.github/workflows/ci.yml`
- `.gitignore`
