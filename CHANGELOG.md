# Changelog

All notable changes to this project will be documented in this file.

## [0.3.1] - 2026-04-16

### Fixed
- `runs pin` and `runs unpin` now send explicit JSON request bodies, satisfying API body validation.
- `setup` now respects `--no-tui` / `ARTBOT_NO_TUI` and exits with non-interactive guidance.
- `runs list` and `runs show` automation paths now have explicit JSON-only coverage, including `pnpm ... -- --json ...` pass-through.
- Source-plan generation now surfaces progress feedback during longer preview/create phases.
- Storage summaries now classify all unpinned runs as expirable for accurate retention visibility.
- Published CLI entrypoint now suppresses the noisy `node:sqlite` experimental warning while preserving other warnings.

### Changed
- Root docs, npm package README, ops runbook, and release docs were synchronized to match shipped CLI behavior.

## [0.3.0] - 2026-04-16

### Added
- Storage visibility endpoint and CLI surface: `GET /storage/usage` and `artbot storage`.
- Per-run retention controls: `artbot runs pin --run-id <id>` and `artbot runs unpin --run-id <id>`.
- Pinned retention state in run list/details and TUI run views.
- Persisted cleanup observations (reclaimed bytes and timestamp) surfaced in storage summaries.

### Changed
- Automatic and manual artifact GC now treats pinned runs as protected and preserves promoted run artifacts.
- CLI storage rendering now accepts both flat and nested response shapes for robust API compatibility.
- Ops and user documentation updated for command-first usage, `--no-tui`, and retention/storage workflows.

## [0.2.0] - 2026-04-11

### Added
- TypeScript project-reference hardening for internal shared types.
- CI guardrail to build `@artbot/shared-types` before monorepo typecheck.
- Local pre-commit and pre-push hooks for CI-like checks.
- Browser-agent prompt for repeatable public-readiness audits.

### Changed
- Turbo typecheck ordering now requires upstream build readiness.
- Release/readiness docs updated for `KhazP/artbot` repository metadata.

## [0.1.0] - 2026-04-09

### Added
- Initial public baseline with CI, Docker reproducibility, and governance docs.
