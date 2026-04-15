Below is a repo-first assessment followed by a research-backed strategy report.

**Evidence labels**

* **[Repo]** directly supported by the code/docs I inspected
* **[Inference]** my inference from the repo shape and implementation choices
* **[Web]** current external research

I inspected the main apps, core packages, storage layer, orchestrator, adapter system, auth/browser stack, reporting paths, and the architecture/ops/internal planning docs. I did **not** validate every adapter live against production sites or test authenticated source access in this pass.

## Initial understanding of the repo

**[Repo]** This is not a toy scraper. It is a local-first, evidence-capturing art-market research system focused on Turkish coverage first and international coverage second. It already has **two product surfaces**:

1. a query-driven “find comps / normalize / score / value / report” pipeline, and
2. an artist-market inventory crawler that builds clusters, image matches, and review queues.

**[Inference]** Taken seriously, this project is trying to become an **art-market research operating system**: a tool for analysts, appraisers, advisors, collectors, and operators to discover inventory, capture evidence, normalize heterogeneous market data, assess reliability, and produce defensible outputs.

**[Inference]** The biggest gap is not code quality. The biggest gap is **ambition vs acquisition infrastructure**. The repo already has good seams for a serious product, but the external acquisition, storage lifecycle, evaluation, and compliance posture are not yet at the level implied by the product ambition.

---

# 1. Repo Understanding

## What the system appears to do

* **[Repo]** The system accepts artist/work research queries, plans sources, discovers candidate URLs, attempts HTTP extraction, selectively escalates to browser automation, normalizes price data, scores confidence, ranks comparables, computes a valuation range, and emits structured results plus human-readable reports.
* **[Repo]** A separate inventory workflow crawls artist-market listings over time, stores images and simple image features, clusters near-duplicates/near-matches, and creates review items for borderline cases.
* **[Repo]** The codebase is a TypeScript monorepo with `apps/api`, `apps/worker`, and `apps/cli`, backed by packages for shared types, normalization, browser core, storage, source registry, auth management, adapters, extraction, valuation, and orchestration.
* **[Repo]** State is stored in SQLite plus filesystem artifacts under run directories. There is already a run lease/heartbeat/recovery model, source attempt tracking, frontier/checkpoint storage, inventory records, images, clusters, and review queues.

## Key components and architecture

* **[Repo]** `packages/shared-types` defines a surprisingly strong typed model: `ResearchQuery`, `PriceRecord`, run summaries, inventory records, clusters, review items, valuation acceptance flags, confidence components, and access status.
* **[Repo]** `packages/orchestrator` is the real center of gravity. It owns source planning, dynamic concurrency, host circuit breaking, failure classification, browser escalation, dedupe, normalization, scoring, comparable ranking, valuation, and report writing.
* **[Repo]** `packages/source-registry` plus `packages/source-adapters` implement the adapter system. There are deterministic venue adapters, generic adapters, optional probe adapters, and a source policy layer that distinguishes public, auth-mixed, licensed-only, and probe sources.
* **[Repo]** `packages/extraction` contains the fetch stack, structured LLM fallback, and the generic lot parser. The parser is still mostly regex/heuristic-oriented with some JSON-LD/script extraction.
* **[Repo]** `packages/browser-core` and `packages/auth-manager` handle Playwright-based capture, storage-state reuse, cookie injection, manual login checkpoints, and some block/auth detection heuristics.
* **[Repo]** `packages/storage` is broader than a basic run table: it already includes host tracking, crawl frontiers, checkpoints, page cache, inventory records, artwork images, clusters, and review items.
* **[Repo]** `apps/cli` is ambitious: commands, TUI/workspace, auth/setup helpers, run watching, report access, local API/worker launching.

## Core workflows

### A. Query-driven research / valuation

* **[Repo]** Build query variants and source plan.
* **[Repo]** Discover candidate URLs from adapter seeds and optional web discovery.
* **[Repo]** Attempt low-cost extraction first.
* **[Repo]** Escalate to browser where evidence needs confirmation, auth is needed, or extraction quality is insufficient.
* **[Repo]** Normalize currencies and time basis, compute confidence, dedupe, rank comps, run valuation, and emit report artifacts.

### B. Artist-market inventory / clustering

* **[Repo]** Crawl market listings for an artist using frontier/checkpoints.
* **[Repo]** Persist inventory records and artwork images.
* **[Repo]** Compute simple pHash/grayscale-vector features.
* **[Repo]** Cluster likely duplicates / variants and emit a review queue for unresolved cases.
* **[Repo]** Export JSON/CSV/report artifacts.

## Strong points

* **[Repo]** Strong typed contracts. This is a real asset.
* **[Repo]** Good evidence-first mindset: screenshots, HTML snapshots, per-attempt records, access status, and acceptance flags.
* **[Repo]** Sensible separation of “accepted for evidence” vs “accepted for valuation.”
* **[Repo]** Turkey-first source policy is explicit, not accidental.
* **[Repo]** The worker lease/heartbeat/stale-run recovery model is already better than what many early-stage scrapers have.
* **[Repo]** The second surface area—inventory crawl, clustering, review queue—is strategically important and differentiating.
* **[Repo]** CI/release hygiene is unusually solid for this class of project.

## Weak points

* **[Repo]** Discovery is effectively single-provider today: Brave.
* **[Repo]** Many adapters are still “probe” or generic; the source matrix is ahead of the adapter depth.
* **[Repo]** Extraction remains heavily heuristic/regex-driven.
* **[Repo]** Browser block/auth detection is mostly string matching.
* **[Repo]** FX/inflation fallback data is static.
* **[Repo]** Artifact retention, compaction, and GC appear missing.
* **[Repo]** Auth/session material is stored locally in a way that looks operationally risky.
* **[Repo]** Observability exists conceptually, but not yet as a first-class production telemetry system.
* **[Repo]** The valuation stack is still heuristic and lightly benchmarked.

## Important inferred assumptions

* **[Inference]** The system is currently optimized for a **single operator or very small team**, not a multi-tenant production product.
* **[Inference]** It assumes that local disk is an acceptable long-lived evidence store.
* **[Inference]** It assumes that “run-centric outputs” are enough, while the more valuable long-term product is probably **entity-centric**.
* **[Inference]** It assumes that selective browser escalation plus heuristics will get far enough; for hard commercial coverage, that will not be sufficient.
* **[Inference]** It treats source integration mostly as “adapter logic,” but the product really needs to treat sources as **managed contracts** with health, cost, access mode, and evidence quality.

---

# 2. Opportunity Inventory

## Product opportunities

* **[Inference]** Build a **canonical artwork/entity graph**, not just run outputs. Artists, works, sale events, venues, inventory items, and evidence should become durable entities.
* **[Inference]** Add **continuous watchlists** for artists, galleries, auction houses, venues, and saved comparable sets.
* **[Inference]** Make **completed runs reusable**: annotations, saved comp baskets, manual exclusions, rerun-from-evidence, exportable “case files.”
* **[Inference]** Turn the inventory crawler into a first-class **market monitoring** product with alerts for new inventory, repricing, relisting, and cross-venue duplication.
* **[Inference]** Add a **review console** for evidence adjudication, parser repair, and duplicate/cluster resolution.
* **[Inference]** Support **provenance-style timelines** per artwork or cluster: where it appeared, in what form, with what metadata changes, at what price type.
* **[Inference]** Add **confidence explanation surfaces** for why a record was accepted/rejected and why a comp moved the valuation.
* **[Inference]** Build **operator collaboration**: notes, assignments, queue states, and audit trails.

## Engineering opportunities

* **[Repo]** Formalize source capabilities instead of encoding them diffusely across adapters/env flags.
* **[Inference]** Split discovery, acquisition, extraction, normalization, valuation, and artifact management into clearer subsystem boundaries.
* **[Repo]** The existing `page_cache` is a missed leverage point; make replay and offline regression testing first-class.
* **[Inference]** Replace env-sprawl with typed config and policy objects.
* **[Inference]** Introduce content-addressed artifact storage and dedupe.
* **[Inference]** Add a plugin/contract harness for new source adapters.

## Scraping and access opportunities

* **[Inference]** Move from ad hoc session handling to a **host-aware session/proxy/fingerprint service**.
* **[Inference]** Adopt **platform-family adapters** wherever a shared auction software stack powers many houses.
* **[Inference]** Add structured browser extraction and DOM contract tests for JS-heavy sites.
* **[Inference]** Add host-specific health and breakage scoring, not just run-local failures.
* **[Inference]** Create access playbooks by source class: public archive, authenticated marketplace, JS-heavy gallery, soft-block site, hard-WAF site, licensed source.

## Research quality opportunities

* **[Repo]** The repo already distinguishes evidence-worthiness from valuation-worthiness; use that as the foundation of a real eval program.
* **[Inference]** Build golden sets per source and per failure mode.
* **[Inference]** Measure calibration: does “0.82 confidence” actually mean anything?
* **[Inference]** Add per-source field completeness scores and manual-correction rates.
* **[Inference]** Benchmark valuation error on held-out realized sales.

## Storage and lifecycle opportunities

* **[Inference]** Introduce hot/warm/cold retention classes for artifacts.
* **[Inference]** Keep manifests and selected proofs forever; expire bulky transient browser data aggressively.
* **[Inference]** Enforce run budgets, source budgets, and disk high-watermark GC.
* **[Inference]** Compress HTML/screenshots and dedupe identical artifacts across runs.

## Documentation/process opportunities

* **[Repo]** There are already architecture and ops docs, but the operational reality is ahead of the docs.
* **[Inference]** You need source playbooks, auth handling docs, retention policy docs, legal-use matrix docs, valuation methodology docs, and adapter authoring docs.
* **[Inference]** Internal docs should explicitly encode “what we will not do,” especially around questionable access patterns.

## Strategic opportunities

* **[Inference]** The most important strategic shift is from “price bot” to **evidence-backed market intelligence system**.
* **[Inference]** The second is from “scrape everything” to **source portfolio management**: licensed, partnered, deterministic public scrape, and operator-assisted subscription use.
* **[Inference]** The third is from “single run answers” to **persistent market memory**.

---

# 3. Documentation Audit

## Missing docs

* **[Repo]** There is no clear single document that explains the full lifecycle from query → discovery → extraction → evidence → normalization → valuation → reporting → retention.
* **[Repo]** There is no proper artifact taxonomy or retention/GC document.
* **[Repo]** There is no serious source adapter authoring manual with examples, invariants, and test expectations.
* **[Repo]** There is no auth/session handling runbook for operators.
* **[Repo]** There is no explicit data contract doc for `PriceRecord`, cluster membership, valuation eligibility, or source access status beyond code.
* **[Repo]** There is no incident guide for site breakage, WAF spikes, stale run recovery, or credential expiry.
* **[Repo]** There is no benchmark/eval handbook explaining how accuracy is measured and maintained.
* **[Repo]** There is no legal/allowed-use matrix by source.

## Weak docs

* **[Repo]** The architecture docs are useful, but still too high-level for a new maintainer to safely modify adapters, valuation, or browser flows.
* **[Repo]** Internal planning docs acknowledge gaps, but they do not yet translate into an operator-grade backlog or operating model.
* **[Inference]** The project explains “what exists” better than it explains “how to reason about it when it breaks.”

## Proposed doc set

### Public / contributor-facing

* Project overview
* Quickstart for local single-operator setup
* Architecture deep dive
* Source model and source policy
* Adapter authoring guide
* Browser/auth integration guide
* Storage and artifact model
* Valuation methodology overview
* CLI/TUI cookbook
* Testing and golden fixtures guide
* Contributing and release process

### Internal / operator-facing

* Source access matrix and legal notes
* Auth credential handling and rotation
* Proxy/session routing policy
* Incident response runbooks
* Retention/archival/GC policy
* Benchmark and eval handbook
* Source health dashboard definitions
* Evidence review SOP
* Licensed data handling rules
* Customer/reporting disclaimers and redaction rules

## Suggested table of contents for ideal docs

1. What this system is and is not
2. Product surfaces: research runs vs market monitoring
3. End-to-end data flow
4. Query model and source planning
5. Source classes and access modes
6. Adapter architecture and authoring
7. Browser escalation and auth state
8. Extraction and normalization contracts
9. Evidence capture and artifact taxonomy
10. Confidence, acceptance, and valuation lanes
11. Report generation and export surfaces
12. Storage, retention, archival, and GC
13. Observability and incident response
14. Benchmarks, evals, and regression suites
15. Security, privacy, and licensed data handling
16. Operator playbooks and troubleshooting

## Public vs internal split

* **Public**: architecture, contributing, testing, source classes, adapter authoring, storage model, CLI usage.
* **Internal**: exact source-specific access patterns, credential procedures, partner/licensed terms, proxy routing, risk postures, and incident runbooks.

---

# 4. Feature Expansion Map

## 1. Canonical artwork / sale / venue graph

* **Why it matters:** **[Inference]** This is the highest-leverage upgrade. It turns isolated runs into compounding data.
* **Dependencies:** entity resolution, durable IDs, merge/split workflows, review tooling.
* **Difficulty:** high.
* **Upside:** extremely high.

## 2. Continuous monitoring and alerting

* **Why it matters:** **[Inference]** Completed runs should not die. Analysts care when new evidence appears or price context changes.
* **Dependencies:** watchlists, revisit scheduling, source freshness tracking.
* **Difficulty:** medium.
* **Upside:** high.

## 3. Evidence review / adjudication console

* **Why it matters:** **[Inference]** The best way to improve extraction quality is to shorten the loop between failure and repair.
* **Dependencies:** artifact indexing, side-by-side snapshot viewer, parser outputs, annotations.
* **Difficulty:** medium.
* **Upside:** very high.

## 4. Saved comparable sets and valuation workspaces

* **Why it matters:** **[Inference]** Analysts don’t just need “a valuation”; they need repeatable comp sets and judgment surfaces.
* **Dependencies:** case state, record pinning/exclusion, report regeneration.
* **Difficulty:** medium.
* **Upside:** high.

## 5. Source health dashboard

* **Why it matters:** **[Inference]** Scraping systems die from silent source drift.
* **Dependencies:** metrics, canary runs, source-level telemetry.
* **Difficulty:** medium.
* **Upside:** high.

## 6. Multi-provider discovery ensemble

* **Why it matters:** **[Repo]** Brave-only discovery is too narrow.
* **Dependencies:** provider abstraction, budgeting, dedupe, host scoring.
* **Difficulty:** medium.
* **Upside:** high.

## 7. Stronger visual duplicate detection

* **Why it matters:** **[Repo]** Current image features are handcrafted and will underperform on crops, lighting differences, watermarks, and catalog variations.
* **Dependencies:** better embeddings, cluster review UX, image normalization.
* **Difficulty:** medium.
* **Upside:** high.

## 8. Provenance / appearance timeline view

* **Why it matters:** **[Inference]** Users need to understand how a work has circulated and changed, not just what today’s extracted fields say.
* **Dependencies:** entity graph, cluster merges, event model.
* **Difficulty:** high.
* **Upside:** high.

## 9. Operator repair kit for adapters

* **Why it matters:** **[Inference]** Source maintenance cost is one of your future moats or failure modes.
* **Dependencies:** fixture capture, selector hints, diff tooling, replay packets.
* **Difficulty:** medium.
* **Upside:** high.

## 10. Team workflow primitives

* **Why it matters:** **[Inference]** The repo already wants to be more than a solo tool.
* **Dependencies:** user identities, permissions, audit log, assignment model.
* **Difficulty:** medium-high.
* **Upside:** medium-high.

## 11. External export / API surfaces

* **Why it matters:** **[Inference]** This is the bridge to monetization.
* **Dependencies:** stable schemas, redaction rules, retention guarantees.
* **Difficulty:** medium-high.
* **Upside:** high.

## 12. Licensed-source operator mode

* **Why it matters:** **[Inference]** Some sources are better handled as managed lookups or partner-fed data rather than scraping.
* **Dependencies:** access control, source-specific usage rules, evidence labeling.
* **Difficulty:** medium.
* **Upside:** high.

---

# 5. Existing Feature Polish

## What feels awkward or incomplete

* **[Repo]** Discovery is bounded but opaque. Operators likely won’t know why a source wasn’t searched, why a host was deprioritized, or why discovery ended.
* **[Repo]** Acceptance/valuation logic is thoughtful, but not surfaced cleanly enough as operator-facing explanations.
* **[Repo]** Auth flows rely on low-level knobs (`cookieFile`, manual checkpoint, profiles) that will confuse non-core maintainers.
* **[Repo]** Reports likely under-surface run diagnostics, rejected evidence, and “what to do next.”
* **[Repo]** The inventory review queue exists, but its operator ergonomics are probably not yet first-class.
* **[Repo]** Config is powerful but sprawling.

## Specific polish work

* **[Inference]** Show source plan before execution: chosen sources, skipped sources, why skipped, expected access mode.
* **[Inference]** Show per-record acceptance reasons and downgrade reasons prominently.
* **[Inference]** Add a “next best action” section to reports: log in to source X, rerun with licensed source Y, add manual artist alias, review duplicate cluster Z.
* **[Inference]** Make auth setup wizard source-aware: “this run will likely need profile A.”
* **[Inference]** Add source-family labels and badges in reports and run views.
* **[Inference]** Collapse config into profiles: `turkey_fast`, `turkey_deep`, `global_archive`, `inventory_monitor`.
* **[Inference]** Improve stale-run recovery messaging and replay from checkpoint.
* **[Inference]** Make rejected evidence reviewable, not just logged.

## High-leverage polish

1. **Operator explanations for acceptance/rejection**
2. **Auth and source-plan UX**
3. **Inventory review queue ergonomics**
4. **Diagnostic-rich reports**
5. **Preset policy profiles instead of raw env/config sprawl**

---

# 6. Scraping Reliability and Coverage Strategy

## Broad recommendations

* **[Inference]** Keep the current “cheap first, browser second” philosophy. It is directionally right.

* **[Inference]** But promote it from a tactic into a **formal acquisition architecture**:

  * discovery
  * candidate selection
  * low-cost fetch
  * structured parse
  * browser escalation
  * evidence promotion
  * replay/testing
  * source health feedback

* **[Inference]** Treat each host as a managed access profile with:

  * source class
  * auth requirements
  * tolerated request rate
  * preferred access path
  * proxy policy
  * session stickiness needs
  * anti-bot sensitivity
  * evidence requirements
  * legal risk notes

## Discovery layer

* **[Repo]** The repo already uses Brave Search API for web discovery.
* **[Web]** Brave remains a reasonable default because it offers an independent index and official Search API pricing of $5 per 1,000 requests with $5 in monthly free credits, plus documented 50 QPS. Exa adds search/content/research endpoints with different rate limits and per-request pricing, Tavily adds search/extract/crawl/research endpoints with credit-based pricing and higher production RPM, SerpApi adds structured search-engine scraping with CAPTCHA solving and broader search-engine coverage, while Google’s older site-restricted JSON API path has already been retired for traffic and is not a durable future bet. ([Brave][1])

**Recommendation**

* **[Inference]** Keep Brave as tier-1.
* **[Inference]** Add Exa or Tavily as tier-2 for richer content discovery and URL expansion.
* **[Inference]** Use SerpApi selectively for hard search-engine-dependent discovery or geo-localized result needs.
* **[Inference]** Stop thinking of discovery as “search provider choice”; think of it as **ensemble retrieval plus outcome-based host scoring**.

## Browser vs HTTP extraction

* **[Inference]** Build a source policy matrix:

  * **HTTP-first** for predictable server-rendered result pages and archives
  * **browser-first** for SPA-like result lists, lazy-loaded catalogs, or flows with client-rendered fields
  * **browser-only after auth** for session-bound or paywalled pages
  * **licensed-only** for sources where scraping is weak or contractually bad
* **[Inference]** Add per-source replayable fetch packets so browser escalation isn’t the only debugging path.

## Anti-bot strategy

* **[Inference]** Do not default to a universal stealth stack. That gets expensive and brittle.

* **[Inference]** Use a stepped ladder:

  1. direct HTTP/datacenter
  2. HTTP + retry/jitter/header variance
  3. sticky session on same IP
  4. browser on standard IP
  5. browser on residential/sticky proxy
  6. vendor unlocker or managed stealth
  7. operator/manual or partner path

* **[Web]** This layered model matches current vendor guidance. Crawlee’s `SessionPool` is explicitly built for rotating and persisting sessions, retiring blocked ones, and reusing cookies; `AutoscaledPool` manages concurrency based on resource availability. Apify Proxy supports datacenter, residential, and SERP proxies with health checks, smart rotation, and session persistence. Browserbase supports built-in managed residential proxies, BYO proxies, per-domain routing, and extensive session observability. Browserless pushes a stealth route, residential proxies, CAPTCHA solving, and reconnectable sessions. Bright Data positions residential proxies and Web Unlocker as higher-friction but higher-power access paths. ZenRows emphasizes pay-only-success and a scraping browser backed by large residential proxy pools. Scrapfly exposes session persistence, sticky proxies, caching, extraction templates, and anti-scraping protection, but also explicitly warns that reliable fixes for anti-bot changes may take days or weeks and that enterprise SLA plans start at high commitments. ([Crawlee][2])

**Recommendation**

* **[Inference]** Build your own host-aware policy layer and use vendors as *implementation options*, not as product logic.
* **[Inference]** Residential proxies should be a **surgical tool**, not the default.
* **[Inference]** CAPTCHA solving should be exception handling, not baseline architecture.
* **[Inference]** Session continuity matters more than raw IP rotation for authenticated and semi-authenticated art sources.

## Auth/session strategy

* **[Repo]** You already have auth profiles and Playwright storage state.
* **[Web]** Playwright officially recommends `storageState` for persisted authenticated state, but explicitly warns that the state file can contain sensitive cookies and headers capable of impersonating the user, and recommends keeping it out of repositories. Playwright also notes that auth state expires and should be regenerated or cleaned when appropriate. ([Playwright][3])

**Recommendation**

* **[Inference]** Promote auth to a managed subsystem:

  * encrypted storage-state vault
  * per-source profile scoping
  * TTL/expiry metadata
  * auth refresh workflows
  * session provenance in reports
  * “this record required authorized access” labeling

* **[Inference]** Model session identity separately from browser identity separately from proxy identity. Right now those concerns look too collapsed.

## Per-source adapter strategy

* **[Inference]** Your future coverage will not scale house-by-house. It will scale **platform-family by platform-family**.

### High-priority families

* **[Web]** Müzayede APP explicitly markets auction-site software that runs under the auction house’s own domain, and its live product surface shows not only auctions but direct sale, offer-only, catalog-mode, and WhatsApp-assisted sale modes. That makes it especially valuable as a Turkish platform family rather than a single-source integration. ([Muzayede App][4])
* **[Web]** Auction Mobility is a white-label auction software platform with branded sites/apps, customer-data ownership claims, and a synchronized timed-sale integration with LiveAuctioneers. That means one family integration can create leverage across many auction houses and across both white-label and marketplace surfaces. ([Auction Mobility][5])
* **[Web]** Invaluable’s Catalog Upload API is seller-side and partner-mediated rather than a general buyer/research feed, but that still makes it strategically important: it shows where platform partnership can beat scraping. ([Invaluable][6])

**Recommendation**

* **[Inference]** Build source adapters around:

  * shared URL patterns
  * DOM signatures
  * JSON payload schemas
  * sale mode variants
  * auth expectations
  * evidence requirements
* **[Inference]** Platform-family leverage is one of the most important hidden opportunities in this repo.

## Monitoring and failure detection

* **[Inference]** Add per-source health metrics:

  * reachability
  * auth success
  * parse success
  * price completeness
  * accepted-for-evidence rate
  * accepted-for-valuation rate
  * manual correction rate
  * median latency
  * WAF/challenge incidence
  * source freshness lag
* **[Inference]** Run synthetic canaries daily against a curated URL list.
* **[Inference]** Keep golden HTML/HAR packets for each major source family.
* **[Inference]** Detect schema drift with DOM signature diffing and field completeness regression.
* **[Inference]** Track cost per accepted comp by source.

## Current tools/vendors/frameworks worth considering

### Best fit for self-managed hardening

* **[Web]** Crawlee/Apify are strongest where you want request queues, session pools, and autoscaled concurrency while keeping logic in your codebase. ([Crawlee][2])

### Best fit for remote browser observability

* **[Web]** Browserbase is strongest where you want managed browsers, built-in residential proxies, session recordings, logs, live debugging, and Stagehand-adjacent tooling. ([Browserbase Documentation][7])

### Best fit for managed stealth / reconnect

* **[Web]** Browserless is strongest where you want stealth routing, CAPTCHA handling, residential proxying, and reconnectable browser sessions. ([Browserless Docs][8])

### Best fit for brute-force unlock / enterprise access

* **[Web]** Bright Data is strongest when you need very large residential coverage or Web Unlocker-style managed unblocking, but it is an enterprise-leaning tool with access controls and KYC on some network modes. ([Bright Data Docs][9])

### Best fit for lower-friction API/browser bundle

* **[Web]** ZenRows is attractive for fast integration, shared-balance pricing, and “pay only for success.” ([ZenRows Docs][10])

### Best fit for cache/extraction/debug combo

* **[Web]** Scrapfly is attractive for caching, debug/replay, sessions, extraction templates/prompts/models, and offloaded large objects. ([Scrapfly][11])

## Practices likely to age badly

* **[Inference]** Single-provider discovery.
* **[Inference]** House-by-house adapter proliferation instead of platform-family abstraction.
* **[Inference]** Always-on residential proxy usage.
* **[Inference]** Treating paid subscription databases as scrape targets rather than licensed/partner paths.
* **[Inference]** Keeping every trace, HAR, screenshot, and raw HTML forever.
* **[Inference]** No source-health scoring.
* **[Inference]** No replayable test packets.

---

# 7. APIs, Data Providers, and Acquisition Paths

## A. Turkish core coverage

### Sanatfiyat

* **[Web]** Sanatfiyat currently positions itself as Turkey’s most comprehensive art data source, with roughly 7,100+ artists, 142,000+ works, upcoming auctions, realized-price data, and subscription plans around 400 TL/month for starter, 600 TL/month or 5,800 TL/year for standard, and 6,500 TL/year for pro. ([Sanat Fiyat][12])
* **Suitability:** very high for Turkish realized-price coverage.
* **Access notes:** licensed/subscription path.
* **Recommendation:** **[Inference]** Make this a first-class licensed integration, not a side-path.

### Müzayede APP family

* **[Web]** Müzayede APP markets software infrastructure for auction houses under their own domains and supports multiple commercial modes beyond timed auctions, including direct sale, offer-only, catalog mode, and WhatsApp-assisted sales. ([Muzayede App][4])
* **Suitability:** extremely high for Turkish inventory discovery.
* **Access notes:** public web + software-family leverage.
* **Recommendation:** **[Inference]** Prioritize a robust family adapter and normalize sale modes explicitly.

### Direct Turkish auction houses

* **[Repo]** You already have deterministic adapters for several Turkish venues/platforms.
* **[Inference]** Double down on depth, not breadth. Fewer, deeper Turkish adapters will outperform a larger shallow matrix.

## B. International realized-price / auction-platform coverage

### LiveAuctioneers

* **[Web]** LiveAuctioneers offers a free Auction Price Results Database with 29 million results, updated daily, covering art/antiques/jewelry/furniture/collectibles from thousands of global houses; its public material also positions it as a major international marketplace and highlights auction-house integration tooling. ([LiveAuctioneers][13])
* **Suitability:** very high for realized-price breadth.
* **Access notes:** public results database, marketplace surface, partner/channel opportunities.
* **Recommendation:** **[Inference]** Use as a major international realized-price pillar and partner target.

### Invaluable / AuctionZip / private-label network

* **[Web]** Invaluable’s Catalog Upload API is available through auction-management software partners and pushes timed/live sales across Invaluable, AuctionZip, and private-label sites; Invaluable’s own marketing highlights marketplace scale, bidding volume, and platform services. ([Invaluable][6])
* **Suitability:** high strategically; medium as a direct open integration.
* **Access notes:** partner-mediated rather than public general-purpose API.
* **Recommendation:** **[Inference]** Pursue partnership conversations rather than trying to out-scrape their platform forever.

### the-saleroom

* **[Web]** the-saleroom’s Price Guide is a subscriber product with over 21 million sold lots since 2000 and pricing around £14.95/month. ([support.the-saleroom.com][14])
* **Suitability:** medium-high for sold-price research.
* **Access notes:** subscription product.
* **Recommendation:** **[Inference]** Better as operator-assisted or licensed path than as a core scraping dependency.

## C. Subscription databases / professional data vendors

### askART

* **[Web]** askART advertises 500,000+ artists, millions of auction records, coverage back to 1987, monthly plans at $29.95, and standard usage limits of 100 auction record searches/views per month; its FAQ explicitly says commercial redistribution and systematic downloading are prohibited without licensing. ([askART][15])
* **Suitability:** useful, but contract-sensitive.
* **Recommendation:** **[Inference]** Do not build a scraping business on top of a consumer askART plan. Use licensing or operator-assisted workflows only.

### MutualArt

* **[Web]** MutualArt currently markets a price database for 932,000+ artists with upcoming estimates and realized prices, unlimited price database access on Premium from $39/month, and additional analytics/appraisal features on higher tiers. ([MutualArt][16])
* **Suitability:** good for breadth and analyst support.
* **Recommendation:** **[Inference]** Attractive as a licensed/operator research layer, less attractive as a fragile scrape target.

### Artnet

* **[Web]** Artnet’s subscription terms define a Price Database with searches dating back to 1985 and multiple subscription types, plus analytics/market alerts built on the database. The currently indexed product pages are messy, but the commercial product is clearly subscription-led rather than open-API-led. ([Artnet][17])
* **Suitability:** high value, high licensing sensitivity.
* **Recommendation:** **[Inference]** This is a commercial conversation, not an engineering stunt.

### Artprice

* **[Web]** Artprice publicly claims 875,900+ artists, 30 million auction results, and coverage across 7,200 auction houses, positioning itself as a professional art-market information leader with reports and subscriptions. ([Artprice][18])
* **Suitability:** very high if commercially accessible.
* **Recommendation:** **[Inference]** Another case where partnership/licensing is more realistic than building fragile extraction around a professional database.

## D. Discovery and marketplace surfaces

### Artsy

* **[Web]** Artsy’s public API is in the process of retirement, may be taken down without notice, is limited in scope, and only supports educational/non-commercial use for public-domain works; it is rate-limited to 5 requests per second and partner access is handled separately. Artsy’s marketplace scale remains meaningful, with official claims around 94K artists, 1M+ artworks, and 3K+ partner galleries and auction houses. ([Artsy Developers][19])
* **Suitability:** good for discovery and market surface awareness; weak as a core ingestion foundation.
* **Recommendation:** **[Inference]** Don’t architect around the public API. Treat Artsy as discovery/partner surface.

### Barnebys

* **[Web]** Barnebys positions itself as a search engine/listing layer across more than 2,000 auction houses, dealers, and galleries globally. ([Barnebys.com][20])
* **Suitability:** high for discovery, lower for primary evidence.
* **Recommendation:** **[Inference]** Good as lead generation, not as final proof.

### Major houses

* **[Web]** Sotheby’s, Bonhams, Phillips and peers maintain official result surfaces and lot pages; in this pass I did not find public developer APIs worth relying on. Official result pages remain valuable as deterministic targets when public and accessible. ([Bonhams][21])

## E. Auction software / platform partnerships

### Auction Mobility

* **[Web]** White-label platform, branded apps/sites, synchronized timed-sale integration with LiveAuctioneers, strong operator leverage. ([Auction Mobility][5])

### Invaluable software ecosystem

* **[Web]** Catalog Upload API through software partners shows a real integration path into seller workflows. ([Invaluable][6])

**Strategic conclusion**

* **[Inference]** Some of your best future coverage will come from **partnering with software ecosystems**, not scraping every downstream house one by one.

## F. Authority and enrichment sources

* **[Web]** Wikidata is a free/open structured knowledge base that supports machine-readable linked data; Getty’s vocabularies, including ULAN, are available as linked open data/XML/tables/APIs and are specifically built for the visual-arts domain; VIAF links major authority files across institutions and languages. ([Wikidata][22])

**Recommendation**

* **[Inference]** Use these for canonical artist resolution, alternate names, place normalization, and authority-backed identity joins.

## Recommended acquisition strategy by source category

1. **[Inference] Tier 1: licensed/partner sources**
   Sanatfiyat, LiveAuctioneers partnerships, Invaluable/Auction Mobility paths, Artprice/Artnet/askART/MutualArt commercial conversations.

2. **[Inference] Tier 2: deterministic public scraping**
   Turkish houses, Müzayede APP family, official major-house result pages, predictable auction archives.

3. **[Inference] Tier 3: discovery providers**
   Brave + Exa/Tavily + selective SerpApi.

4. **[Inference] Tier 4: operator-assisted subscription use**
   When licensing exists but full automation does not yet make sense.

---

# 8. Completed Run Lifecycle and Storage Strategy

## What to keep forever

* **[Inference]** Run metadata and summaries
* **[Inference]** Normalized accepted records
* **[Inference]** Comparable rankings and valuation outputs
* **[Inference]** Evidence manifests: URL, timestamps, content hash, parser version, source class, access mode, acceptance rationale
* **[Inference]** Selected hero screenshot or key evidence asset for each accepted record
* **[Inference]** Cluster memberships and review decisions
* **[Inference]** Audit trail of human overrides

## What to keep for medium-term retention

* **[Inference]** Raw HTML for accepted or disputed records
* **[Inference]** Full screenshots for accepted/disputed records
* **[Inference]** Rejected-but-interesting artifacts from high-value sources
* **[Inference]** Source-attempt debug payloads for breakage analysis

Retention target: 90–180 days unless promoted.

## What to keep briefly

* **[Inference]** Playwright traces, HARs, full browser videos, temp downloads, browser profiles, oversized duplicate screenshots
* **[Inference]** These should usually be failure-only or investigation-only artifacts.

Retention target: 7–30 days.

## What to drop aggressively

* **[Inference]** Transient browser caches
* **[Inference]** Duplicate HTML with identical content hashes
* **[Inference]** Duplicate screenshots after dedupe/thumbnail generation
* **[Inference]** Successful-run traces/HARs when no exception or ambiguity occurred

## Proposed artifact taxonomy

1. **Control-plane state**: SQLite rows
2. **Normalized data**: records, clusters, valuation outputs
3. **Evidence manifest**: structured metadata about proofs
4. **Light artifacts**: compressed HTML, thumbnails, cropped screenshots
5. **Heavy artifacts**: full screenshots, trace, HAR, video
6. **Ephemeral browser state**: temp profiles, caches, downloads

## Concrete implementation suggestions

* **[Inference]** Use content-addressed storage by hash for HTML/screenshots.
* **[Inference]** Store manifest rows that reference content hashes instead of per-run duplicate files.
* **[Inference]** Compress HTML with zstd/gzip and store screenshots in a web-efficient format for routine evidence while allowing original retention for selected forensic cases.
* **[Inference]** Add run-size budgets and per-source monthly storage budgets.
* **[Inference]** Add a GC daemon with a high-watermark kill switch and a “promote run to archive” action.
* **[Inference]** Make “manifest-only preservation” a first-class mode.

## Replayability

* **[Repo]** You already have a `page_cache` table.
* **[Inference]** Use it. A serious version of this system needs replayable extraction against stored HTML/JSON/HAR without hitting the live web.

## Preventing storage blowups

* **[Web]** Playwright recommends traces and videos mainly for debugging flows, with configurations like `on-first-retry` / `retain-on-failure`; HAR replay and trace viewing are designed for targeted debugging, not blanket archival. Browserbase’s docs similarly frame session recordings, logs, and HAR/tracing as observability/debugging tools. ([Playwright][23])
* **[Web]** Litestream continuously replicates SQLite to S3-compatible/object storage and supports restore/point-in-time recovery workflows. AWS S3 Intelligent-Tiering automatically moves objects to lower-cost tiers after 30 and 90 days of no access, with optional deeper archive tiers. ([litestream.io][24])

**Recommendation**

* **[Inference]** Operational stack:

  * SQLite remains hot control-plane state
  * Litestream replicates it off-machine
  * artifacts go to S3-compatible object storage
  * lifecycle rules tier down old artifacts
  * only promoted runs retain heavy evidence long-term

---

# 9. Research Quality and Evaluation Plan

## Metrics

### Acquisition metrics

* **[Inference]** Source coverage per query class
* **[Inference]** Yield per source
* **[Inference]** Freshness lag
* **[Inference]** cost per accepted evidence item
* **[Inference]** cost per valuation-ready comp

### Extraction metrics

* **[Inference]** field completeness
* **[Inference]** price-type correctness
* **[Inference]** currency correctness
* **[Inference]** entity resolution correctness
* **[Inference]** screenshot/HTML/evidence completeness

### Acceptance metrics

* **[Inference]** precision of `accepted_for_evidence`
* **[Inference]** precision of `accepted_for_valuation`
* **[Inference]** false rejection rate
* **[Inference]** manual override rate

### Valuation metrics

* **[Inference]** error against held-out realized prices
* **[Inference]** interval coverage
* **[Inference]** outlier robustness
* **[Inference]** confidence calibration

### Operational metrics

* **[Inference]** median run duration
* **[Inference]** stale run frequency
* **[Inference]** source breakage rate
* **[Inference]** auth expiry frequency
* **[Inference]** disk growth rate

## Test suites

* **[Inference]** Per-source golden HTML fixtures
* **[Inference]** replayable HAR/trace fixtures for hard JS sources
* **[Inference]** parser unit tests for bilingual price/date/medium/dimension cases
* **[Inference]** adapter contract tests
* **[Inference]** end-to-end synthetic canaries
* **[Inference]** regression pack for Turkish auction terminology and sales modes
* **[Inference]** duplicate/cluster benchmark set

## Golden sets to build first

1. **Top Turkish venues**
2. **Müzayede APP family**
3. **LiveAuctioneers / Invaluable-like marketplace lots**
4. **Major-house official result pages**
5. **Dealer/gallery asking-price pages**
6. **Hidden-price / inquiry-only pages**
7. **Auth-required cases**
8. **Duplicate / relisted / rephotographed works**

## Dashboards

* **[Inference]** source health dashboard
* **[Inference]** parse completeness dashboard
* **[Inference]** valuation calibration dashboard
* **[Inference]** storage growth dashboard
* **[Inference]** review queue dashboard
* **[Inference]** licensed-source usage dashboard

## Review loops

* **[Inference]** Human review must be able to:

  * mark correct/incorrect fields
  * confirm/reject evidence
  * split/merge clusters
  * annotate sale mode anomalies
  * pin or exclude comps
* **[Inference]** Every correction should feed back into:

  * source-specific rules
  * parser heuristics
  * confidence weighting
  * benchmark sets

## Regression protection

* **[Inference]** No adapter change should ship without replay against golden sets.
* **[Inference]** No valuation logic change should ship without interval/error comparison against a benchmark cohort.
* **[Inference]** No source-discovery tweak should ship without tracking effect on accepted evidence yield and false positives.

---

# 10. Architecture and Codebase Improvement Plan

## Refactors

### 1. Make source integration a true plugin system

* **[Inference]** Define explicit capability contracts:

  * anonymous/public/auth/licensed
  * sale modes supported
  * structured payloads available
  * browser necessity
  * evidence requirements
  * expected price types

### 2. Separate the core pipeline into clearer layers

* **[Inference]** Today the orchestrator does a lot. Create sharper boundaries:

  * discovery
  * candidate planning
  * acquisition
  * extraction
  * acceptance
  * normalization
  * ranking
  * valuation
  * reporting
  * artifact lifecycle

### 3. Introduce canonical entities

* **[Inference]** Durable artist/work/venue/event IDs are the core missing abstraction.

### 4. Replace env-driven behavior with typed runtime policy

* **[Inference]** A typed config/policy model will reduce hidden operational drift.

### 5. Turn artifact handling into its own subsystem

* **[Inference]** Right now artifacts feel like a side effect. They should be a first-class service with retention and dedupe semantics.

## Reliability-focused code changes

* **[Inference]** Promote session state into a source-aware session manager.
* **[Inference]** Add host policy objects with budgets, proxy requirements, and retry semantics.
* **[Inference]** Use `page_cache`/replay artifacts for offline debugging and tests.
* **[Inference]** Store structured failure reasons and attach recommended remediation paths.
* **[Inference]** Add per-source circuit-breaker state that survives run boundaries.

## Maintainability-focused code changes

* **[Inference]** Version your schemas explicitly.
* **[Inference]** Create adapter test harness utilities and fixture builders.
* **[Inference]** Centralize parser primitives for money/date/estimate extraction.
* **[Inference]** Standardize result promotion rules so adapters don’t drift semantically.
* **[Inference]** Move report composition away from ad hoc string-building toward structured report models.

## Observability

* **[Web]** OpenTelemetry is a vendor-neutral framework for traces, metrics, and logs, and its JavaScript implementation supports Node.js instrumentation and exporters. ([OpenTelemetry][25])
* **[Inference]** Instrument the system with end-to-end spans:

  * run span
  * source span
  * candidate acquisition span
  * browser capture span
  * parser span
  * valuation span
  * report span
* **[Inference]** Emit source-health metrics and attach run IDs/artifact IDs for correlation.

## Storage / data model evolution

* **[Inference]** Keep SQLite for local-first development and maybe single-node production.
* **[Inference]** But separate concerns:

  * SQLite for operational state
  * object store for artifacts
  * optional analytic/search store for entity graph and retrieval

---

# 11. Security, Legal, and Compliance Risk Review

## Security risks

* **[Repo]** Auth profiles, cookie files, and Playwright storage state appear to live locally and unencrypted.

* **[Repo]** Artifacts may capture PII, auth tokens, bidder/account details, or licensed content.

* **[Repo]** Local run directories are likely to become a sensitive evidence cache.

* **[Inference]** Logs may leak source URLs, credentials, cookies, or personal data unless aggressively redacted.

* **[Web]** Playwright explicitly warns that stored browser state may contain sensitive cookies and headers that can impersonate the user and should not be committed to repositories. ([Playwright][3])

## Legal / ToS / IP risks

* **[Web]** Artsy’s public API is expressly non-commercial and limited in scope, while its public API is being retired. Artsy’s site terms also frame content as personal, non-commercial viewing use unless otherwise permitted. ([Artsy Developers][19])
* **[Web]** askART explicitly prohibits commercial redistribution and systematic downloading without licensing. ([askART][26])
* **[Inference]** Similar risk exists for other subscription databases even where public search pages exist.
* **[Inference]** Any system storing screenshots/HTML from licensed sources must define who may view exports and how long they may be retained.

## Privacy / compliance risks

* **[Web]** Under Turkey’s KVKK regime, controllers must implement technical and organizational measures, and the Board’s 2019/10 decision interprets breach notification timing as within 72 hours after awareness; the erasure/destruction by-law also formalizes deletion/destruction/anonymization obligations. Public commentary around the 2024 amendments notes that updated cross-border transfer rules took effect June 1, 2024, with transition ending September 1, 2024. ([KVKK][27])
* **[Web]** GDPR remains the official EU baseline under Regulation (EU) 2016/679 and has applied since May 25, 2018, including breach-notification duties and accountability requirements. ([Eur-Lex][28])

## Sensible mitigation posture

* **[Inference]** Encrypt auth state and sensitive artifacts at rest.
* **[Inference]** Separate operator credentials by source and role.
* **[Inference]** Add artifact redaction and token scrubbing.
* **[Inference]** Add role-based access control before multi-user rollout.
* **[Inference]** Tag each source by legal posture:

  * public permitted
  * public but contract-sensitive
  * auth-required
  * licensed-only
  * operator-assisted only
* **[Inference]** Build a source usage matrix reviewed with counsel.
* **[Inference]** Add explicit export restrictions for licensed-source-derived evidence.
* **[Inference]** Maintain retention/destruction policy and breach response plan.

## Questions to resolve with counsel or partners

1. Are subscription database outputs usable internally for valuation support, and on what redistribution limits?
2. Can screenshots of source pages be retained/exported in customer-facing reports?
3. Which jurisdictions apply when operator credentials are Turkish, EU, UK, or US-based?
4. Do authorized sessions imply additional handling for bidder or account-level data?
5. What is the policy for cross-border storage of browser artifacts and logs?
6. What partner/licensing terms are realistic with Turkish and international data vendors?

---

# 12. Strategic Roadmap

## Status update (2026-04-14)

Legend:

* `[x]` completed enough to remove from the immediate reliability backlog
* `[~]` partially completed; still open
* `[ ]` still open

### Reliability backlog status

* `[x]` Source health scoring now persists per-source metrics and is surfaced in CLI/API/browser report.
* `[x]` Synthetic canary pack now persists history and covers the priority families: Müzayede App, Bayrak, Türel, Clar, Portakal, Antik A.S., Sanatfiyat, Invaluable, LiveAuctioneers.
* `[x]` Operator-facing acceptance/rejection explanations now exist at the record level in markdown reports, browser reports, and run payloads.
* `[x]` Session identity, browser identity, and proxy identity are now separate runtime concepts.
* `[x]` Legal posture labeling and access provenance labeling are now carried through source plan, attempts, records, reports, and artifact manifests.
* `[x]` Sensitive artifact handling is hardened beyond auth state: non-public/auth/licensed captures are scrubbed or suppressed, and licensed/auth-derived exports are marked restricted.
* `[x]` High-value source-family hardening landed for Bayrak, Türel, Sanatfiyat, Invaluable, LiveAuctioneers, and Müzayede-family offline coverage.
* `[x]` Artifact GC/retention now has lifecycle enforcement: automatic post-run GC, dry-run inspection, per-class deletion accounting, and conservative preservation of restricted/promoted artifacts.
* `[x]` Golden-fixture and replay regression coverage now includes explicit replay artifact selection (`raw`/`har`/`auto`) plus selective/always/off heavy-evidence gating.
* `[x]` Multi-provider discovery now validates yield, caps, and deterministic primary→secondary failover and persists those diagnostics through CLI/report surfaces.
* `[x]` Canonical entity graph now persists deterministic cluster identity and survives reruns with stable cluster IDs.
* `[x]` Cluster rebuild now preserves historical artist inventory context across reruns instead of limiting clustering to only the current run.
* `[x]` Evidence review/adjudication console now includes queue inspection plus explicit adjudication actions through API/CLI.
* `[x]` Artam cached extraction now preserves recovery escalation (Crawlee/browser) for non-parseable candidates.
* `[ ]` Continuous watchlists and market monitoring remain open.
* `[ ]` Stronger duplicate embeddings remain open.
* `[ ]` Benchmark-backed valuation calibration remains open.
* `[ ]` Source usage/legal matrix and counsel review remain open.
* `[ ]` Litestream/object-storage durability and hot/warm/cold tiering remain open.
* `[ ]` OpenTelemetry-grade observability remains open.

## Now (0–90 days)

1. `[x]` **Deepen the highest-value source families**, not the long tail.
2. `[x]` **Ship artifact retention/GC** before storage becomes a tax you carry forever.
3. `[x]` **Build source health dashboards and synthetic canaries.**
4. `[x]` **Create golden sets and replay-based regression tests.**
5. `[x]` **Harden auth/session secret handling.**
6. `[x]` **Add multi-provider discovery.**
7. `[x]` **Improve operator-facing acceptance/rejection explanations.**

## Next (3–9 months)

1. **Session/proxy policy layer**
2. **Better visual duplicate detection**
3. **Continuous watchlists and monitoring**
4. **Partner/licensed-source conversations**
5. **Team workflows and audit trails**
6. **Graph/review operator UX hardening**
7. **Cross-run entity-history analytics**

## Later (9+ months)

1. **Customer-facing API/data product**
2. **Full market monitoring product**
3. **Institutional workflow integrations**
4. **Benchmark-backed valuation productization**
5. **Hybrid partner + scraping acquisition moat**

## High-impact / low-effort

* `[x]` Artifact GC
* `[x]` Better reports
* `[x]` source health metrics
* `[x]` replay fixtures
* `[x]` source plan transparency
* `[x]` auth secret hardening

## High-impact / high-effort

* partner/licensed acquisition layer
* session/proxy platform
* benchmarked valuation calibration
* cross-run entity-history analytics
* monitoring/watchlist automation

## Risky but potentially transformative bets

* **[Inference]** Build around platform-family leverage (Müzayede APP, Auction Mobility, Invaluable ecosystem).
* **[Inference]** Become the canonical Turkish art-market evidence graph.
* **[Inference]** Combine persistent artwork tracking with valuation and provenance-style appearance history.

## Business context

* **[Web]** The global art market was estimated at about $59.6B in 2025, up 4% year over year, with dealer sales up 2% and public auction sales up 9%; the prior 2024 market was estimated at $57.5B, down 12% but with transaction volumes still growing. ([Art Basel][29])
* **[Inference]** This is large enough for a serious vertical product, but not so large that a generic consumer app is the obvious play.
* **[Inference]** The best business models are likely B2B/B2B2C:

  * analyst workstation seats
  * premium data/API access
  * managed monitoring
  * valuation/research support
  * source intelligence for lenders/insurers/appraisers/advisors/auction houses

---

# 13. Top 25 Recommendations

1. **Build a canonical artwork/entity graph.**
   Impact: very high. Effort: high.
   This is the architectural unlock for compounding value.

2. **Add source health scoring and daily canaries.**
   Impact: very high. Effort: medium.
   Silent source drift is your biggest operational risk.

3. **Implement artifact retention, dedupe, and GC now.**
   Impact: very high. Effort: medium.
   Prevent future disk debt and preserve only what matters.

4. **Promote Sanatfiyat to a first-class licensed integration.**
   Impact: very high. Effort: medium.
   Best immediate Turkish data leverage. ([Sanat Fiyat][12])

5. **Treat Müzayede APP as a platform family, not a single source.**
   Impact: very high. Effort: medium-high.
   One adapter family can unlock many Turkish surfaces. ([Muzayede App][4])

6. **Add a second discovery provider.**
   Impact: high. Effort: low-medium.
   Brave-only discovery is too brittle. ([Brave][30])

7. **Build replay-based regression tests from stored HTML/HAR.**
   Impact: high. Effort: medium.
   Use live traffic once; debug forever offline.

8. **Create an evidence review/adjudication console.**
   Impact: high. Effort: medium-high.
   This will shorten adapter repair loops dramatically.

9. **Separate session identity, browser identity, and proxy identity.**
   Impact: high. Effort: medium-high.
   Current auth/session handling is too collapsed.

10. **Encrypt auth state and sensitive artifacts at rest.**
    Impact: high. Effort: medium.
    This is security debt already. ([Playwright][3])

11. **Adopt platform-family adapters for Auction Mobility / LiveAuctioneers style ecosystems.**
    Impact: high. Effort: medium-high.
    Better leverage than house-by-house scraping. ([Auction Mobility][31])

12. **Benchmark valuation on held-out realized-price cohorts.**
    Impact: high. Effort: medium-high.
    Current valuation sophistication exceeds its evidence base.

13. **Upgrade duplicate detection with stronger visual embeddings.**
    Impact: high. Effort: medium.
    The current image features are not robust enough.

14. **Add per-record explanation surfaces in reports/UI.**
    Impact: high. Effort: low-medium.
    Operators need to know why something counted.

15. **Formalize source capability contracts and version them.**
    Impact: high. Effort: medium.
    This will reduce adapter entropy.

16. **Make completed runs editable, annotatable case files.**
    Impact: high. Effort: medium.
    Finished runs should become reusable knowledge assets.

17. **Use Litestream + object storage for durable backup.**
    Impact: medium-high. Effort: medium.
    Keep local-first simplicity while gaining resilience. ([litestream.io][24])

18. **Apply lifecycle rules and hot/warm/cold storage tiers.**
    Impact: medium-high. Effort: medium.
    S3-style tiering is an easy cost-control win. ([AWS Documentation][32])

19. **Instrument the pipeline with OpenTelemetry.**
    Impact: medium-high. Effort: medium.
    You need run/source/adapter observability. ([OpenTelemetry][25])

20. **Stop treating subscription data vendors as scrape-first targets.**
    Impact: medium-high. Effort: low.
    For Artprice/Artnet/askART/MutualArt, licensing is strategically saner. ([askART][26])

21. **Build source usage/legal matrix and review with counsel.**
    Impact: medium-high. Effort: medium.
    Especially important before customer-facing outputs.

22. **Add watchlists and continuous market monitoring.**
    Impact: medium-high. Effort: medium.
    Converts one-shot research into recurring product value.

23. **Collapse config into named operating profiles.**
    Impact: medium. Effort: low-medium.
    Better DX and fewer footguns.

24. **Pursue partner conversations with platform operators, not just venues.**
    Impact: medium-high. Effort: high.
    Invaluable/Auction Mobility ecosystems are leverage points. ([Invaluable][6])

25. **Reposition the product internally as an evidence-backed analyst workstation.**
    Impact: high. Effort: low.
    This strategic clarity will improve roadmap decisions.

---

# 14. Open Research Questions

1. **Which 10 source families drive 80% of the practical value?**
2. **What percentage of important Turkish inventory is actually reachable through Müzayede APP-style software families?**
3. **Which international sources are best for realized prices vs estimates vs asking prices vs inventory discovery?**
4. **Which subscription/partner paths are commercially viable in the first 6 months?**
5. **What is the minimum benchmark set needed to calibrate valuation credibly?**
6. **What fields are most often wrong today: currency, price type, sale date, medium, dimensions, artist identity, or duplicate grouping?**
7. **How much of the value comes from persistent monitoring vs one-shot searches?**
8. **Which user segment is primary: appraisers, advisors, collectors, lenders, insurers, auction houses, or galleries?**
9. **Should the long-term product be run-centric, entity-centric, or both?**
10. **What evidence is legally safe to store forever, and what must be compacted or redacted?**
11. **How much coverage improvement comes from better discovery vs deeper source contracts?**
12. **Which sources are worth full browser automation, and which should be abandoned in favor of licensing or partnership?**
13. **How accurate are current confidence scores under human review?**
14. **What is the real unit economics of accepted comps by source and by access mode?**
15. **How much can source breakage be predicted from DOM/schema signatures before runs fail?**
16. **Could the inventory/clustering surface become the wedge product ahead of full valuation?**
17. **What would a defensible customer-facing “valuation explanation” need to show to build trust?**
18. **Which sources require country-specific access, language handling, or operator-managed auth refresh?**
19. **What is the right boundary between deterministic rules and LLM-assisted extraction?**
20. **When should a source be marked “operator-assisted only” rather than automated?**

---

## Bottom line

**[Inference]** The repo already contains the skeleton of a serious product. The smartest next move is **not** to add more random adapters. It is to harden the system around four pillars:

1. **source-family leverage and acquisition strategy**
2. **evidence lifecycle and replayability**
3. **quality measurement and human review loops**
4. **security/legal discipline around auth and licensed data**

**[Inference]** If you execute those four well, this stops being “a scraping project” and starts becoming a durable market-intelligence product.

The best next step is to turn the top 25 into a sequenced 90-day engineering and research plan.

[1]: https://brave.com/search/api/ "https://brave.com/search/api/"
[2]: https://crawlee.dev/api/core/class/SessionPool "https://crawlee.dev/api/core/class/SessionPool"
[3]: https://playwright.dev/docs/auth "https://playwright.dev/docs/auth"
[4]: https://www.muzayedeapp.com/en/for-auction-houses "https://www.muzayedeapp.com/en/for-auction-houses"
[5]: https://www.auctionmobility.com/ "https://www.auctionmobility.com/"
[6]: https://www.invaluable.com/inv/apiinfo/ "https://www.invaluable.com/inv/apiinfo/"
[7]: https://docs.browserbase.com/features/observability "https://docs.browserbase.com/features/observability"
[8]: https://docs.browserless.io/browserql/scraping/bot-detectors "https://docs.browserless.io/browserql/scraping/bot-detectors"
[9]: https://docs.brightdata.com/proxy-networks/residential "https://docs.brightdata.com/proxy-networks/residential"
[10]: https://docs.zenrows.com/first-steps/pricing "https://docs.zenrows.com/first-steps/pricing"
[11]: https://scrapfly.io/docs/scrape-api/extraction "https://scrapfly.io/docs/scrape-api/extraction"
[12]: https://sanatfiyat.com/tr "https://sanatfiyat.com/tr"
[13]: https://www.liveauctioneers.com/auction-results "https://www.liveauctioneers.com/auction-results"
[14]: https://support.the-saleroom.com/hc/en-gb/articles/115000069214-What-is-the-Price-Guide "https://support.the-saleroom.com/hc/en-gb/articles/115000069214-What-is-the-Price-Guide"
[15]: https://www.askart.com/ "https://www.askart.com/"
[16]: https://www.mutualart.com/price-database "https://www.mutualart.com/price-database"
[17]: https://cn.artnet.com/price-database "https://cn.artnet.com/price-database"
[18]: https://www.artprice.com/home/index/trr "https://www.artprice.com/home/index/trr"
[19]: https://developers.artsy.net/ "https://developers.artsy.net/"
[20]: https://www.barnebys.com/ "https://www.barnebys.com/"
[21]: https://www.bonhams.com/auctions/results/ "https://www.bonhams.com/auctions/results/"
[22]: https://www.wikidata.org/ "https://www.wikidata.org/"
[23]: https://playwright.dev/docs/trace-viewer-intro "https://playwright.dev/docs/trace-viewer-intro"
[24]: https://litestream.io/reference/replicate/ "https://litestream.io/reference/replicate/"
[25]: https://opentelemetry.io/docs/ "https://opentelemetry.io/docs/"
[26]: https://www.askart.com/Info_Institution.aspx "https://www.askart.com/Info_Institution.aspx"
[27]: https://www.kvkk.gov.tr/Icerik/6601/Obligations-Concerning-Data-Security- "https://www.kvkk.gov.tr/Icerik/6601/Obligations-Concerning-Data-Security-"
[28]: https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng "https://eur-lex.europa.eu/eli/reg/2016/679/art_32/oj/eng"
[29]: https://www.artbasel.com/stories/the-art-basel-and-ubs-global-art-market-report-2026 "https://www.artbasel.com/stories/the-art-basel-and-ubs-global-art-market-report-2026"
[30]: https://brave.com/search/api "https://brave.com/search/api"
[31]: https://www.auctionmobility.com/solutions/ "https://www.auctionmobility.com/solutions/"
[32]: https://docs.aws.amazon.com/AmazonS3/latest/userguide/intelligent-tiering-overview.html "https://docs.aws.amazon.com/AmazonS3/latest/userguide/intelligent-tiering-overview.html"
