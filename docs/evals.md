# Eval Protocol

## Objective
Measure extraction truthfulness and valuation eligibility quality for Turkey-first market research.

## Dataset
- Primary: `data/fixtures/eval-artists.json`
- Source fixtures: `data/fixtures/adapters/*`
- Replay artifacts: run output snapshots under `runs/*` or `data/golden-results/*`

## Required Metrics (P0 Gates)
1. Valuation-eligible null-price rate must be `0%`.
2. Evidence-only records (`inquiry_only`, `price_hidden`, missing numeric/currency) must not enter valuation lane.
3. Acceptance reason distribution must be populated and stable (`acceptance_reason_breakdown`).
4. Top source fixtures must preserve semantic typing (`realized/estimate/asking/inquiry`).
5. Contract tests for top Turkish adapters must pass.

## Recommended Metrics (P1+)
1. Accepted-for-valuation precision/recall on labeled fixture pages.
2. Comparable ranking precision@k on manually reviewed cases.
3. Source health trend: block/auth failure rate and extraction field completeness.

## Command Template
1. Start API + worker.
2. Run CLI query:
   - `pnpm --filter @artbot/cli dev -- research artist --artist "<artist>" --wait`
3. Validate `runs/<run_id>/results.json`:
   - `records[].accepted_for_valuation` contains no `price_amount: null` entries.
