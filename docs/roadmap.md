# ArtBot Roadmap

Updated: 2026-04-23

## 1. Product Objective

ArtBot should become a **high-coverage local art market crawler and valuation monitor** for artists and individual artworks.

Primary goal:

- find and aggregate as much lawful market data as possible,
- normalize historical prices correctly,
- produce defensible average market pricing and valuation outputs,
- help operators sell artworks at appropriate prices instead of guessing.

This is not primarily a generic scraper. It is a **local-first appraisal research system**.

## 2. Product Decisions

These decisions are fixed for this plan and should guide implementation:

- ArtBot is primarily a **market crawler / monitor**, not just a one-shot research script.
- The default install must remain **fully local** and usable from `npm install -g artbot` or a Git clone.
- ArtBot should optimize for **maximum lawful coverage**.
- Sources are in-bounds if they are lawful to access with:
  - public access,
  - operator credentials,
  - licensed integrations the operator already has.
- ArtBot should be **Turkey-first** but global by design.
- ArtBot should **auto-run and auto-value** as much as possible.
- Better source coverage, better local UX, and better reports are the top near-term priorities.
- Disk growth is a first-class product problem; old runs and heavy evidence must be manageable automatically.

## 3. North Star

ArtBot should become:

> the best local art appraisal research tool that can correctly value an artist’s paintings or a single painting using all available lawful price data from every listing, auction result, estimate page, and sale-related source it can discover.

## 4. Core Use Cases

### Artist market valuation

The operator enters an artist name.

ArtBot should:

- discover all relevant public, credentialed, and licensed sources,
- gather historic and current listings/results,
- cluster duplicates and repeat appearances,
- separate asking, estimate, realized, inquiry-only, and hidden-price evidence,
- calculate average market ranges by medium and period,
- produce an operator-ready report.

### Single artwork valuation

The operator enters:

- artist,
- title if known,
- medium,
- dimensions,
- optional year,
- optional image.

ArtBot should:

- find all matching appearances of the same artwork where possible,
- find comparable works when exact matches do not exist,
- normalize prices historically and across currencies,
- produce a best-effort valuation with evidence and confidence.

### Market monitoring

The operator wants continuous coverage for:

- key artists,
- key houses,
- galleries,
- marketplaces,
- inventories.

ArtBot should:

- watch for new listings,
- detect repricing,
- detect repeat appearances,
- surface new evidence automatically.

## 5. Non-Negotiable Product Rules

- Fully local default runtime.
- No cloud browser dependency in the default stack.
- No unauthorized bypass, credential stuffing, or brute-force access behavior.
- Evidence and valuation must remain separate lanes.
- Reports must show where data came from and what kind of price it is.
- Historical prices must use the correct event-date FX conversion.
- USD and EUR should always be available in output alongside the selected local currency.

## 6. Currency and Historical Pricing Plan

Currency handling must become a first-class feature, not a post-processing detail.

### Progress update

- [x] Added self-host-aware Firecrawl transport config (`FIRECRAWL_BASE_URL`, timeout, retries) while keeping it optional and disabled by default.
- [x] Added explicit normalization metadata fields for source currency/date interpretation, historical/current FX outputs, confidence, warnings, and manual-review flags.
- [x] Added TL/YTL/TRL-aware price normalization scaffolding with redenomination guardrails and event-date confidence tracking.
- [x] Added a read-only normalization inspector panel in the existing Ink TUI so operators can inspect normalization outcomes without switching tools.
- [x] Added SQLite-backed FX cache persistence plus normalization event storage for replayable historical/current conversion traces.
- [x] Added inflation-adjusted USD and EUR outputs as secondary fields while preserving nominal historical/current FX outputs as the core pricing view.
- [x] Added schema-bound LangChain structured extraction orchestration behind the existing deterministic/direct fallback path.
- [x] Expanded the Ink operator console with diagnostics-first `/sources`, `/review`, `/fx`, and `/errors` panes plus review adjudication commands.

### User-facing behavior

On onboarding or setup, the operator selects:

- home country,
- preferred display currency.

Every report should show:

- original source price and source currency,
- event date,
- normalized preferred currency at the historical event date,
- normalized USD at the historical event date,
- normalized EUR at the historical event date.

If the operator chooses TRY, reports should still show:

- TRY,
- USD,
- EUR.

If the operator chooses EUR, reports should still show:

- EUR,
- USD,
- the selected home/local currency if configured.

### Data model requirements

Every price record should store:

- `source_price_amount`,
- `source_currency`,
- `price_type`,
- `event_date`,
- `historical_fx_to_usd`,
- `historical_fx_to_eur`,
- `historical_fx_to_selected_currency`,
- `normalized_price_usd`,
- `normalized_price_eur`,
- `normalized_price_selected_currency`.

### Conversion policy

Use the event date, not today’s date, for FX conversion.

If a lot is from 2010:

- convert using 2010 historical rates,
- not present-day rates.

Optional later enhancement:

- add a second “today-equivalent / inflation-adjusted” view,
- but keep event-date historical FX as the primary truth.

## 7. Local Stack Decisions

ArtBot should standardize on this local-first stack:

### Default local stack

- `Playwright` for authenticated browser automation, storage state reuse, traces, screenshots, and network/XHR inspection.
- `Crawlee` for queueing, session pooling, concurrency, retry behavior, and the split between cheap and browser paths.
- `CheerioCrawler` or equivalent HTML-first path for cheap listing/detail extraction.
- `PlaywrightCrawler` only for JS-heavy, authenticated, or verification-required pages.
- `SearXNG` as the default local discovery provider.
- `LM Studio` as the default local OpenAI-compatible model server.
- `Ollama` as an additional supported local model/embedding backend.
- `SQLite + filesystem artifacts` as the default storage model.

### Optional local extras

- Firecrawl remains optional, never required for the default local install.
- Paid web discovery providers remain optional, never the primary path.
- Docker remains optional except for easy SearXNG bootstrap.

## 8. Scraping Improvement Strategy

### A. Source coverage strategy

Coverage growth should come from **source families**, not random one-off adapters.

Priority source groups:

1. Turkey-first auction/software families
2. Turkish galleries/dealers with stable catalog pages
3. International major houses
4. International art marketplaces and databases
5. Credentialed or licensed sources where the operator has lawful access

The system should prefer:

- deterministic family entrypoints,
- listing-to-lot expansion,
- structured API/XHR extraction,
- then browser rendering as fallback.

### B. Crawl ladder

ArtBot should use a strict crawl ladder:

1. deterministic adapter route
2. cheap HTTP fetch + HTML parse
3. `Crawlee` listing expansion / recovery
4. `Playwright` browser execution
5. operator-authenticated retry
6. evidence-only fallback or rejection

Do not let browser become the default path for all pages.

### C. Session model

Sessions should become source-aware and sticky.

Required behavior:

- one auth profile can map to multiple source families,
- storage state must be reused safely,
- sessions should be tied to lane + host + access mode,
- auth failures should trigger refresh or re-capture flow,
- browser failures must not poison cheap-fetch globally.

### D. Browser extraction

For JS-heavy sources, extraction should prefer:

- captured JSON payloads,
- XHR responses,
- JSON-LD,
- stable DOM contracts,
- then heuristic text parsing.

This is especially important for:

- marketplaces,
- dynamically rendered lot pages,
- search-driven artist pages.

### E. Runtime fairness

The scheduler should enforce source diversity at execution time.

Rules:

- no single family should dominate the frontier early,
- low-yield or blocked families should decay,
- high-yield families should be allowed deeper crawl only after minimum breadth is achieved,
- Turkey-first families should get early priority,
- international families should still get explicit reserved budget.

### F. Replay-first debugging

Before touching live traffic, debugging should prefer:

- raw snapshots,
- traces,
- HAR,
- stored HTML,
- replayed adapter tests.

This keeps iteration local, fast, and cheap.

## 9. Data Model Improvements

ArtBot should stop thinking primarily in “run outputs” and start thinking in canonical market entities.

### Canonical entities

- artist
- artwork
- source listing
- auction lot
- sale event
- gallery inventory item
- evidence artifact
- valuation output

### Required relationships

- one artwork can appear on many listings across time,
- one source listing may represent asking, estimate, realized, inquiry-only, or hidden-price evidence,
- one artwork can have multiple evidence records and multiple price events,
- reports should aggregate by artwork cluster, not just by raw record count.

## 10. Valuation Engine Direction

Valuation should become more automatic, but only after evidence quality is strong enough.

### Inputs to valuation

- exact same-work matches,
- close comparables by artist,
- medium bucket,
- dimensions,
- year/period,
- sale vs ask vs estimate lane,
- freshness,
- source trust,
- repeated appearance history.

### Output expectations

Reports should provide:

- best estimate range,
- average market range,
- median market range,
- confidence,
- evidence count,
- exact-match count,
- comparable count,
- rejected evidence summary,
- coverage summary by source family.

## 11. Reporting Improvements

Reports should become a product surface, not just a dump.

### Artist report should include

- artist market summary,
- total lawful coverage found,
- price distribution by medium,
- realized vs estimate vs asking split,
- newest evidence,
- strongest source families,
- duplicate/repeat appearance summary,
- valuation range,
- confidence and caveats.

### Single artwork report should include

- canonical artwork identity summary,
- exact same-work appearances,
- nearest comparable works,
- normalized historical pricing table,
- source-by-source evidence list,
- valuation conclusion,
- explanation of why the value is what it is.

### Report UX requirements

- use original price + normalized currencies together,
- always show event date,
- clearly label price type,
- clearly distinguish evidence-only records from valuation-eligible records,
- support both markdown and browser/local UI presentation.

## 12. Local UX Plan

Local usability must improve materially.

### Setup flow

`artbot setup` should ask for:

- country,
- preferred currency,
- whether to enable SearXNG,
- whether to enable optional paid discovery providers,
- whether to enable licensed integrations,
- storage budget / retention preference,
- auth profile setup.

### Operator surfaces

Add or improve:

- runs dashboard,
- source health screen,
- auth/session status screen,
- storage usage screen,
- cleanup controls,
- report browser/viewer,
- monitoring/watchlist screen.

### Run controls

Operator should be able to choose:

- artist market crawl,
- artwork valuation,
- monitoring/watchlist mode,
- fast vs balanced vs comprehensive,
- retention policy per run.

## 13. Storage and Cleanup Plan

Disk usage must become manageable by default.

### Progress update

- [x] Added a product-facing `artbot cleanup` command for local artifact cleanup.
- [x] Added `artbot cleanup --dry-run`.
- [x] Added `artbot cleanup --max-size-gb <n>`.
- [x] Added `artbot cleanup --keep-last <n>` so operators can preserve the newest completed runs unless the storage budget still requires purging.
- [x] Added `artbot storage` so operators can see total `var/` usage, pinned vs expirable run counts, and last cleanup reclaimed bytes.
- [x] Tightened default artifact retention closer to the plan: accepted screenshots/raw evidence default to 14 days; traces/HAR default to 7 days; disputed/debug artifacts default to 7 days.
- [x] Added per-run preservation with `artbot runs pin --run-id <id>` and `artbot runs unpin --run-id <id>`.
- [x] Pinned runs now promote their retained artifacts so cleanup and automatic GC preserve them by default.
- [x] Surfaced pinned retention state in run list/detail output and the local TUI run history/detail views.
- [x] Added explicit machine-output modes with `--output-format text|json|stream-json` while keeping `--json` as a compatibility alias.
- [x] Added trusted-workspace controls with `artbot trust status|allow|deny` for interactive, browser-affecting, and local-service actions.
- [x] Added saved local session checkpoints with `artbot sessions list|resume|prune` plus TUI state restore for pane, focus, recent history, and last-run context.
- [x] Added repo-guidance detection in `doctor` plus a selective OSS CLI intake matrix for future ArtBot CLI uplift work.

### Required cleanup behavior

Add automatic retention with these classes:

- keep `results.json` and `report.md` by default,
- keep promoted/starred runs indefinitely,
- expire heavy artifacts aggressively,
- optionally expire old raw snapshots and traces,
- cap total disk budget under `var/`.

### Default retention policy

Recommended default:

- keep reports/results forever unless deleted,
- keep screenshots/raw HTML for 14 days,
- keep traces/HAR for 7 days,
- auto-delete failed low-value runs after 7 days,
- keep the latest 50 completed runs in full unless storage budget is exceeded.

### Required UX

Add:

- `artbot cleanup`,
- `artbot cleanup --dry-run`,
- `artbot cleanup --max-size-gb <n>`,
- `artbot cleanup --keep-last <n>`,
- automatic cleanup on startup or after run completion,
- per-run “pin / preserve” flag.

## 14. Success Metrics

### Coverage metrics

- number of unique priced records per artist,
- number of unique source families contributing priced evidence,
- number of unique artworks found,
- Turkey vs global source contribution mix,
- number of credentialed/licensed sources successfully contributing.

### Valuation metrics

- valuation-ready record count,
- exact-match evidence count,
- comparable count,
- duplicate collapse rate,
- evidence freshness mix,
- confidence calibration quality.

### UX metrics

- time from install to first useful run,
- time to configure auth profile,
- operator time spent cleaning storage,
- number of manual reruns required to get a useful report.

### Storage metrics

- disk used by `var/`,
- heavy artifact growth per run,
- automatic cleanup reclaimed bytes,
- count of pinned runs vs expirable runs.

## 15. Roadmap

## Phase 1: Local operator baseline

Goal:

- make ArtBot reliable and pleasant locally.

Deliverables:

- onboarding with country/currency selection,
- local cleanup policy and commands,
- source health UI,
- report UX refresh,
- current-run and storage visibility,
- pinned runs and retention classes.

Exit criteria:

- local install is easy,
- storage no longer grows without control,
- reports show historical normalized prices correctly.

## Phase 2: Coverage engine hardening

Goal:

- materially improve lawful source coverage.

Progress update:

- [x] Firecrawl is now self-host aware, public-access gated, and source-family allowlisted instead of being treated as a universal ingest path.
- [x] Structured extraction is now shared behind a LangChain-backed schema runner with direct-provider fallback.
- [x] Canonical OpenAI-compatible LLM config now persists through setup (`LLM_MODEL`, `LLM_API_KEY`) and Stagehand can run in `LOCAL` or `BROWSERBASE` mode without Browserbase-only assumptions.
- [x] FX persistence and normalization-event capture now survive process boundaries, enabling replay/debug instead of run-local-only inspection.
- [x] The operator shell now exposes diagnostics for source failures, review queues, normalization traces, and FX cache state without leaving Ink.

Deliverables:

- family-first adapter roadmap,
- stronger listing-to-lot expansion,
- improved session-aware crawling,
- lane-aware host health,
- better browser/XHR extraction,
- replay-first source debugging workflow.

Exit criteria:

- more priced evidence from both Turkey-first and global sources,
- fewer dead search seeds,
- fewer useless browser escalations.

## Phase 3: Canonical market memory

Goal:

- turn runs into durable market intelligence.

Deliverables:

- canonical artwork identity,
- repeat appearance tracking,
- artist market memory,
- cross-run reuse of evidence,
- watchlists and change detection.

Exit criteria:

- the same artwork can be recognized across multiple appearances,
- operator can monitor artists and markets over time.

## Phase 4: Auto-valuation quality

Goal:

- maximize auto-valuation confidence using broad evidence.

Deliverables:

- improved comp selection,
- stronger duplicate handling,
- better same-work matching,
- confidence explanation,
- exact-match vs comparable weighting,
- better artist/artwork reports.

Exit criteria:

- operator can trust ArtBot’s suggested pricing enough to use it in real sales workflow.

## 16. Immediate Backlog

These are the next concrete priorities:

1. Add retention and auto-cleanup so local installs stop running out of disk.
2. Add country/currency onboarding and make historical FX normalization explicit in reports.
3. Remove the remaining residual unverified search seed behavior from live runs.
4. Deepen high-value Turkey-first source families before adding long-tail sources.
5. Improve report quality for artist and single-work valuation.
6. Add source/session/storage health screens to the local UX.
7. Add stronger same-work and duplicate detection using local embeddings.
8. Build monitoring/watchlist mode on top of the existing crawl and clustering system.

## 17. Definition of Success

ArtBot succeeds when a local operator can:

- install it locally,
- connect lawful credentials where available,
- search an artist or a painting,
- gather broad lawful price evidence from Turkey and global sources,
- see historically correct normalized pricing in the selected currency plus USD/EUR,
- receive a report that is good enough to support real selling decisions,
- and keep using the system without disk or operational pain.
