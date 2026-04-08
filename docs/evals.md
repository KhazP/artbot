# Eval Protocol

## Objective
Validate Turkey-first coverage, status typing, evidence capture, and dedupe reliability.

## Dataset
`data/fixtures/eval-artists.json` (derived from Erol Sağmanlı collection report; OCR-cleaned subset for v1).

## Checks
1. At least one valid public or authorized record for a meaningful subset of artists.
2. Correct price semantics (`asking_price`, `estimate`, `realized_price`, `inquiry_only`, etc.).
3. Accepted records include evidence paths (`screenshot_path`, `raw_snapshot_path`).
4. Dedupe keeps medium/size mismatches separate.
5. Source status distribution appears in run summary.

## Command Template
Run API + worker, then execute:
- `pnpm --filter @artbot/cli dev -- research-artist --artist "<artist>" --turkey-first`

Collect artifacts under `runs/<run_id>/`.
