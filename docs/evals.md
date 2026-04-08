# Eval Protocol

## Objective
Validate Turkey-first coverage, status typing, evidence capture, and dedupe reliability.

## Dataset
`data/fixtures/eval-artists.json` (derived from Erol Sağmanlı collection report; OCR-cleaned subset for v1).

## Checks
1. At least one valid public or authorized record for a meaningful subset of artists.
2. Accepted record count is at least 2x previous baseline on the same eval artist subset.
3. Correct price semantics (`asking_price`, `estimate`, `realized_price`, `inquiry_only`, etc.).
4. Accepted records include evidence paths (`screenshot_path`, `raw_snapshot_path`).
5. Dedupe keeps medium/size mismatches separate.
6. Source status distribution appears in run summary.
7. Discovery summary fields are populated (`discovered_candidates`, `accepted_from_discovery`, `source_candidate_breakdown`).

## Command Template
Run API + worker, then execute:
- `pnpm --filter @artbot/cli dev -- research artist --artist "<artist>" --wait`

Collect artifacts under `runs/<run_id>/`.
