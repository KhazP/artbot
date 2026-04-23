# Documentation Structure

This repository follows a lightweight docs taxonomy inspired by Diataxis:

- `Tutorials`: guided onboarding and first-run flows.
- `How-to`: operational procedures for specific goals.
- `Reference`: factual system details (schemas, interfaces, contracts).
- `Explanation`: architecture and decision rationale.

## Current Mapping

- `docs/architecture.md`: Explanation
- `docs/roadmap.md`: Explanation
- `docs/decision-log.md`: Explanation
- `docs/dependency-decisions.md`: Explanation
- `docs/ops.md`: How-to
- `docs/evals.md`: How-to
- `docs/source-matrix.md`: Reference
- `docs/next-adapters.md`: Reference
- `docs/public-release.md`: How-to

## Development Docs

- `docs/development/README.md`: development-focused entry point

## Internal Docs

- `docs/internal/`: local/private planning notes (ignored by git)

## Runtime Artifact Conventions

For workspace runs, generated artifacts should live under `var/`:

- `var/data/`: local runtime databases
- `var/runs/`: run outputs (`results.json`, `report.md`, evidence)
- `var/logs/`: API/worker logs
- `var/state/`: local backend state files
