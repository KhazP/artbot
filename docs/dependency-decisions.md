# Dependency and Reuse Decisions

## Adopted
1. `playwright`
- URL: https://github.com/microsoft/playwright
- License: Apache-2.0
- Reused: browser automation runtime and persistent session-state handling.
- Why: most reliable deterministic browser control for JS-heavy pages and auth-aware contexts.

2. `@browserbasehq/stagehand` (optional)
- URL: https://github.com/browserbase/stagehand
- License: MIT
- Reused: optional Browserbase-backed browser-native AI capture path.
- Why: useful fallback for dynamic flows while keeping deterministic Playwright as baseline.

3. `@mendable/firecrawl-js`
- URL: https://github.com/mendableai/firecrawl
- License: MIT (SDK package metadata)
- Reused: cheap fetch-first extraction for public pages with markdown/html outputs.
- Why: reduces browser usage cost before escalating to full sessions.

4. `zod`
- URL: https://github.com/colinhacks/zod
- License: MIT
- Reused: schema validation for queries, records, and source attempt evidence.
- Why: strict typed boundaries and predictable runtime validation.

5. `vitest`
- URL: https://github.com/vitest-dev/vitest
- License: MIT
- Reused: unit/integration tests for access policy, session helpers, normalization, and adapter behavior.
- Why: fast TypeScript-native testing in monorepo workspaces.

6. Node built-in `node:sqlite`
- URL: https://nodejs.org/api/sqlite.html
- License: Node.js runtime licensing (MIT-style)
- Reused: local-first run metadata persistence.
- Why: avoids native addon compilation friction for local bootstrap.

## Deferred/Optional
1. Apify Actor connector
- URL: https://apify.com/store
- License: actor-specific
- Status: deferred in v1; architecture remains adapter-pluggable for future connector wrapping.

2. Postgres backend
- URL: https://www.postgresql.org/
- License: PostgreSQL License
- Status: deferred in v1; SQLite chosen for local-first bootstrap.

## Rejected for v1
- Monolithic wandering agent loop.
- Unbounded LLM extraction for deterministic fields.
- Any bypass/brute-force logic.
