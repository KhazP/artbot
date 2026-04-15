## Section A: Executive verdict

* **Verdict: not fully implemented yet.**
* The core design is real in code: curated source-family packs with legal posture, source-policy enforcement, selection-time family quotas, multi-lane hooks, transport/data-insufficient recovery, surface normalization, diagnostics, and LM-Studio-compatible local-AI hooks already exist.
* The missing pieces are the **runtime control plane**: execution-time family fairness, verified route fingerprinting, Artam-grade specialization, lane-aware host health, overwrite-safe lane merging, and full parity between the standard pipeline and the long-running inventory path.
* The bundled DB proves the gap: recent runs reached **178–226 attempts** with only **0–9 records** and **0–7 priced records**; one run can still “meet” the current coverage target because `valuation_readiness_ratio` is computed on a tiny accepted set.
* The biggest problem is **breadth illusion**: selection is diversified, but runtime scheduling still lets blocked or low-yield families consume too much of the frontier.
* The second biggest problem is **evidence loss**: later browser/auth/block outcomes can overwrite earlier acceptable cheap-fetch evidence.
* Assumption used below: **core painting coverage** means paintings + original works on paper; signed prints/serigraphs stay in a secondary 2D bucket and do **not** satisfy the core valuation gate.
* With the P0 changes below, reaching **85%+ valuation readiness**, **250+ total 2D Abidin Dino records**, and **150+ unique painting/work-on-paper records** is realistic **without relaxing quality gates**.

## Section A.1: Implementation progress (2026-04-15)

- [x] Milestone 1 code path implemented in both orchestrators:
  - lane-outcome merge policy added (`lane-outcomes.ts`) and wired into pipeline + inventory paths.
  - `browser_overwrite_prevented_count` diagnostics added to both run summaries.
  - inventory failure-attempt attribution bug fixed (`source_family` now uses real family, not adapter id).
- [x] Milestone 2 code path implemented:
  - runtime frontier fairness scoring added (`frontier-fairness.ts`) and wired into standard and inventory schedulers.
  - frontier metadata extended (`source_family`, `source_family_bucket`) and propagated through enqueue paths.
  - unverified synthetic search seed routing disabled by default unless explicitly allowed.
- [x] Milestone 3 code path implemented:
  - composite coverage gates implemented in `buildEvaluationMetrics`.
  - diagnostics expanded (`unverified_search_seed_count`, family share, lane-host breakdown, confidence/freshness mix, unique/duplicate counts).
  - report/browser surfaces updated to reflect composite gate status.
- [ ] Canary A (120 attempts) validated.
- [ ] Canary B (300 attempts) validated.
- [ ] Canary C (200 attempts) validated.

## Section A.2: Execution checklist status (2026-04-15, Europe/Istanbul)

### Runtime normalization

- [x] Canonical runtime storage chosen as `var/data/artbot.db` and `var/runs`.
- [x] `.env` updated to absolute canonical paths:
  - `DATABASE_PATH=/Users/alpyalay/Documents/GitHub/CCGAgent/var/data/artbot.db`
  - `RUNS_ROOT=/Users/alpyalay/Documents/GitHub/CCGAgent/var/runs`
- [x] API/worker/CLI now resolve relative `DATABASE_PATH` and `RUNS_ROOT` as workspace-root-relative in workspace mode.
- [x] Startup guardrails added:
  - resolved paths are logged on startup,
  - shared manifest is enforced at `var/state/runtime-storage-paths.json`,
  - role mismatch (api/worker/cli) fails fast.
- [x] Non-canonical DB files were preserved for backup during validation (not deleted).

### Test and canary reruns

- [x] `pnpm test` passed after normalization changes.
- [x] `pnpm --filter artbot dev canaries run --fixtures-root /Users/alpyalay/Documents/GitHub/CCGAgent/data/fixtures/adapters --json` passed with `pass=10`, `fail=0`.
- [x] Backend started and verified with `pnpm --filter artbot dev backend status --json` (API + worker running, logs under `var/logs`).

### Staged live validation runs

- [x] Run 1 launched and completed:
  - id: `88014f04-0d66-450c-ae50-b6eff5459cc7`
  - mode/scope: `fast`, `turkey_plus_international`
  - run summary snapshot: `attempts=12`, `evidence_records=0`, `valuation_eligible_records=0`, `unverified_search_seed_count=3`, `family_coverage_ratio=0`, `blocked_access_share=0`
- [ ] Run 1 gate passed (`family_coverage_ratio >= 0.50`, `blocked_access_share < 0.40`, `unverified_search_seed_count = 0`) — **status: fail**.

- [x] Run 2 launched:
  - id: `1286d896-c8d3-447d-8cfe-f3ac576aba33`
  - mode/scope: `balanced`, `turkey_only`
  - run summary snapshot (still running, `2026-04-15 17:08 +03`): `attempts=2559`, `evidence_records=334`, `valuation_eligible_records=0`, `priced_record_count=0`, `family_coverage_ratio=0`, `blocked_access_share=0.5889`
- [ ] Run 2 gate passed (`priced_record_count >= 40`, `inventory_record_count_2d >= 100`, `generic_shell_page_share < 0.15`) — **status: pending (run not terminal)**.

- [x] Run 3 launched:
  - id: `0105dd33-7fd4-47f5-abc5-5b341dde7d2c`
  - mode/scope: `balanced`, `turkey_plus_international`
  - run summary snapshot (still running, `2026-04-15 17:08 +03`): `attempts=1317`, `evidence_records=0`, `valuation_eligible_records=0`, `priced_record_count=0`, `unique_artwork_count=0`, `family_coverage_ratio=0`
- [ ] Run 3 gate passed (`>=20` new unique artworks and `>=2` global families with priced records) — **status: pending (run not terminal)**.

### Final acceptance

- [ ] Final acceptance met in a single completed run:
  - `valuation_readiness_ratio >= 0.85`
  - `priced_record_count >= 120`
  - `core_price_evidence_count >= 80`
  - `inventory_record_count_2d >= 250`
  - `unique_artwork_count >= 150`
  - `family_coverage_ratio >= 0.70`
  - `blocked_access_share < 0.25`
  - **status: pending (requires a single terminal run that satisfies all gates)**

### Gate Audit Table (Strict)

| Run | Terminal state | Gate | Observed metrics | Status |
| --- | --- | --- | --- | --- |
| Run 1 `88014f04-0d66-450c-ae50-b6eff5459cc7` | completed | `family_coverage_ratio >= 0.50`, `blocked_access_share < 0.40`, `unverified_search_seed_count = 0` | `family_coverage_ratio=0`, `blocked_access_share=0`, `unverified_search_seed_count=3` | **fail** |
| Run 2 `1286d896-c8d3-447d-8cfe-f3ac576aba33` | running | `priced_record_count >= 40`, `inventory_record_count_2d >= 100`, `generic_shell_page_share < 0.15` | `priced_record_count=0`, `inventory_record_count_2d=585` (global inventory snapshot), `generic_shell_page_share=unavailable until terminal summary` | **pending** |
| Run 3 `0105dd33-7fd4-47f5-abc5-5b341dde7d2c` | running | `>=20` new unique artworks, `>=2` global families with priced records | `run-scoped priced/new-unique metrics unavailable until terminal summary` | **pending** |
| Final acceptance (single run) | not reached | All final thresholds in this section | No terminal run currently satisfies the run-level prerequisites | **pending** |

---

## Section B: Requirement audit matrix

| Target capability                                                                          | Status      | Confidence | Why                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ----------- | ---------: | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Source-family registry with curated packs and legal posture metadata                       | **Done**    |       High | `source-families.ts` has curated packs, buckets, trust tiers, supported surfaces, host patterns, entry paths, crawl budgets; `source-policy.ts` enforces legal posture and opt-in licensed/probe behavior.                                                     |
| Discovery-first strategy with family quotas and broad query variants                       | **Partial** |       High | Family quotas exist in `familyQuotaProfile()`, but they apply to **source selection**, not runtime frontier fairness. Breadth is not guaranteed once execution starts.                                                                                         |
| Host fingerprint routing that avoids synthetic search assumptions                          | **Partial** |       High | Some routing logic exists, but dynamic adapters still synthesize `/search?q=` or `/?q=` and generic entrypoint builders still bias toward search-like routes.                                                                                                  |
| Multi-lane crawl flow (L0 deterministic, L1 cheap fetch, L2 Crawlee, L3 browser truth)     | **Partial** |       High | Standard pipeline contains cheap-fetch, Crawlee recovery/expansion, browser truth capture, and deterministic lane markers. Historical persisted runs do not yet show lane usage clearly, and the inventory path does not fully mirror browser-truth semantics. |
| Re-parse and re-accept logic after each lane                                               | **Partial** |       High | Browser/Crawlee raw snapshots are reparsed and re-evaluated, but there is no durable **best-lane ledger**; later outcomes can overwrite earlier good evidence.                                                                                                 |
| Trigger rules for transport failures and data-insufficient extraction                      | **Done**    |       High | `shouldTriggerCrawleeRecoveryForTransport()` and `shouldTriggerCrawleeRecoveryForAttempt()` are implemented and already cover the right failure classes.                                                                                                       |
| Guardrails for blocked/legal/auth-invalid cases                                            | **Done**    |       High | Auth/licensed/probe policy gating exists; blocked/auth pages are recognized and rejected from valuation.                                                                                                                                                       |
| Surface normalization (`source_surface`, `sale_channel`, `price_visibility`, `crawl_lane`) | **Done**    |       High | These fields exist in attempts/records and are annotated in both orchestrators.                                                                                                                                                                                |
| Lane-aware host health scoring                                                             | **Missing** |       High | Persisted host health is keyed only by host, not by lane/access/surface. Browser or auth failures can suppress otherwise useful cheap-fetch paths.                                                                                                             |
| Promotion flow from dynamic host success to curated family                                 | **Partial** |     Medium | Promotion candidates are reported in summaries, but there is no operational promotion pipeline that writes/approves curated family packs.                                                                                                                      |
| Mirrored behavior in both orchestration paths                                              | **Partial** |       High | The long-running inventory path has Crawlee recovery and diagnostics, but not full browser-truth parity; it also contains at least one source-family attribution bug on failure attempts.                                                                      |
| Extended diagnostics and run summary breakdowns                                            | **Partial** |       High | Diagnostics are already rich, but the metrics that matter for breadth are missing: absolute priced count, family coverage ratio, lane success ratio, volume-weighted coverage, unique-vs-duplicate counts, confidence/freshness mix.                           |

---

## Section C: Root-cause tree (ranked by impact)

1. **Runtime breadth is not guaranteed, so coverage can look healthy while volume stays low.**

   * `familyQuotaProfile()` diversifies **selected sources**, but standard scheduling is only **source round-robin**, and inventory scheduling is plain **FIFO by `created_at`**.
   * Once one family emits many candidates, it dominates the frontier.
   * Blocked families keep consuming attempts because there is no family-level decay, pause, or share cap.

2. **Synthetic search assumptions create dead ends.**

   * Dynamic adapters still manufacture `/?q=` or `/search?q=` seeds.
   * Many art-market hosts do not expose useful public search pages, so these routes turn into `blocked_access` or `generic_shell_page`.
   * This wastes frontier budget before the crawler reaches lot/detail pages.

3. **High-yield families are still under-specialized.**

   * Artam-style ecosystems need deterministic listing-to-lot expansion and structured-state extraction.
   * Generic parsing leaves too many records at listing-shell level, or misses numeric price semantics.

4. **Acceptance overwrite destroys useful evidence.**

   * Current browser truth capture can mark a record blocked/auth and clear `accepted_for_evidence` / `accepted_for_valuation`.
   * That means an earlier cheap-fetch estimate/asking/realized signal can vanish from the final accepted set.

5. **Host health is global when it must be contextual.**

   * A host that is bad in the browser lane can still be good in cheap-fetch.
   * A host that auth-gates artist pages can still expose public lot pages.
   * Global suppression undercuts useful lanes and reduces breadth.

6. **The current success metric is partly an illusion.**

   * Current `valuation_readiness_ratio` is `valuationEligibleRecords / acceptedRecords`.
   * One sampled run produced **9 accepted records, 7 valuation-ready** after **215 attempts**. That is **77.8%**, above the default `0.75` target, but operationally it is nowhere near “hundreds of records.”
   * There is no absolute priced-count gate, no family-coverage gate, and no duplicate-adjusted volume gate.

7. **Standard and inventory orchestration are not truly mirrored.**

   * The inventory path uses FIFO frontier consumption and does not implement the same browser-truth merge behavior as the standard path.
   * It also has a concrete attribution bug: failure attempts are created with `source_family: frontier.adapter_id` instead of the real family.
   * Result: summaries and fairness diagnostics are weaker exactly where long-running inventory should be strongest.

8. **Parser semantics still leak quality.**

   * `unknown_price_type` remains too common on JS-heavy or label-light pages.
   * One-sided estimates are effectively accepted as valuation-ready.
   * Currency inference is too heuristic in some cases.
   * Artist/title confidence is not strong enough to suppress marketplace false positives and non-painting contamination.

9. **Operational resilience is improved but not finished.**

   * Worker lease/heartbeat logic exists now, so this is not the original blocker.
   * Remaining issue: stale runs are recovered by failure, not true resume, and finalization still needs stronger idempotency to prevent partial/stuck outcomes.

---

## Section D: P0 / P1 / P2 patch blueprint

### P0 (immediate, must-do)

### P0.1 — Preserve the best lane outcome; never let a later blocked/auth browser pass erase earlier good evidence

**Problem solved:** useful cheap-fetch valuation evidence is lost when browser truth later encounters WAF/auth.

**Exact behavior change:** keep a `LaneOutcome[]` ledger per candidate and choose the best accepted outcome by trust, acceptance state, and confidence. A later blocked/auth result becomes a **verification note**, not a destructive overwrite, unless there was no earlier accepted evidence.

**Suggested location:**

* New: `packages/orchestrator/src/lane-outcomes.ts`
* Update: `packages/orchestrator/src/pipeline.ts`
* Update: `packages/orchestrator/src/artist-market-inventory.ts`

```ts
export interface LaneOutcome {
  lane: CrawlLane;
  attempt: SourceAttempt;
  record: PriceRecord | null;
}

function outcomeRank(o: LaneOutcome): number {
  const accepted =
    o.attempt.accepted_for_valuation ? 100 :
    o.attempt.accepted_for_evidence ? 60 : 0;
  const laneBonus = { deterministic: 8, cheap_fetch: 6, crawlee: 4, browser: 2 }[o.lane];
  const confidence = Math.round((o.record?.overall_confidence ?? o.attempt.confidence_score ?? 0) * 20);
  return accepted + laneBonus + confidence;
}

export function mergeLaneOutcome(current: LaneOutcome | null, next: LaneOutcome): LaneOutcome {
  if (!current) return next;

  const currentAccepted = current.attempt.accepted_for_evidence || current.attempt.accepted_for_valuation;
  const nextBlocked =
    next.attempt.source_access_status === "blocked" ||
    next.attempt.source_access_status === "auth_required" ||
    next.attempt.acceptance_reason === "blocked_access";

  if (currentAccepted && nextBlocked) {
    return {
      ...current,
      attempt: {
        ...current.attempt,
        notes: [...(current.attempt.notes ?? []), `verification_${next.attempt.source_access_status}`]
      },
      record: current.record
        ? { ...current.record, notes: [...(current.record.notes ?? []), `verification_${next.attempt.source_access_status}`] }
        : current.record
    };
  }

  return outcomeRank(next) > outcomeRank(current) ? next : current;
}
```

**Test cases:**

* cheap-fetch `estimate_range_ready` + browser `blocked_access` => keep cheap-fetch accepted record.
* cheap-fetch evidence-only + browser valuation-ready => promote browser outcome.
* cheap-fetch `entity_mismatch` + browser blocked => final remains rejected.
* browser blocked adds a verification note but does not clear valuation flags on an earlier accepted record.

**Risk and rollback:** risk is retaining a stale or weak cheap-fetch record when browser would have contradicted it. Rollback with `PRESERVE_BEST_LANE_OUTCOME=false`.

**Expected impact:** coverage **+3 to +8 pts**; priced record volume **+10% to +20%** by preventing destructive overwrites.

---

### P0.2 — Replace runtime FIFO/source-RR with a fairness scheduler that enforces family minima, family caps, and blocked-family decay

**Problem solved:** queue starvation and one-family bottlenecks.

**Exact behavior change:** score pending candidates by family deficit, host saturation, family blocked rate, prior yield, and page type. No family may exceed share caps before under-covered families hit minima.

**Suggested location:**

* New: `packages/orchestrator/src/frontier-fairness.ts`
* Update: `packages/orchestrator/src/pipeline.ts`
* Update: `packages/orchestrator/src/artist-market-inventory.ts`
* Update: `packages/shared-types/src/operations.ts` (`FrontierItem` should carry `source_family`)

```ts
export interface FairnessConfig {
  familyMinAttempts: Record<SourceFamilyBucket, number>;
  familyMaxShare: number;
  hostHardCap: number;
  blockedDecayStart: number;
  blockedPauseAt: number;
}

export function scoreFrontierItem(item: FrontierItem, stats: RuntimeStats, cfg: FairnessConfig): number {
  const family = item.source_family_bucket;
  const familyAttempts = stats.attemptsByFamily[family] ?? 0;
  const total = Math.max(1, stats.totalAttempts);
  const share = familyAttempts / total;
  const hostAttempts = stats.attemptsByHost[item.source_host] ?? 0;
  const blockedRate = stats.blockedRateByFamily[family] ?? 0;
  const yieldRate = stats.evidenceRateByFamily[family] ?? 0;

  let score = item.score;
  if (familyAttempts < (cfg.familyMinAttempts[family] ?? 0)) score += 1.5;
  if (share > cfg.familyMaxShare) score -= 1.0;
  if (hostAttempts >= cfg.hostHardCap && yieldRate === 0) score -= 1.2;
  if (familyAttempts >= cfg.blockedDecayStart && blockedRate > 0.6 && yieldRate === 0) score -= 1.4;
  if (familyAttempts >= cfg.blockedPauseAt && blockedRate > 0.8 && yieldRate === 0) score -= 10;
  if (item.source_page_type === "lot") score += 0.6;
  if (item.provenance === "listing_expansion") score += 0.4;
  return score;
}
```

**Concrete Abidin config (comprehensive mode):**

* First **120 attempts** must allocate at least:
  `turkey_first_party=50`, `turkey_platform=20`, `db_meta=15`, `global_major=15`, `global_marketplace=15`, `global_direct_sale=5`
* No family over **35%** of total attempts.
* No host over **25 attempts** before it yields at least **2 priced** or **5 evidence** records.
* Blocked family decay starts at **8 attempts** with **>60% blocked** and **0 evidence**.
* Pause a family for the run at **15 attempts** with **>80% blocked** and **0 evidence**, except for pre-verified lot URLs.

**Test cases:**

* Under-covered family still gets attempts even when another family has higher raw scores.
* Blocked family cannot consume more than 10% of the remaining frontier after decay.
* Standard and inventory paths choose the same next candidate when given the same pending set.

**Risk and rollback:** slight precision dip in the first 50–80 attempts because breadth is prioritized. Rollback with `FRONTIER_FAIRNESS_ENABLED=false`.

**Expected impact:** record volume **2x–4x** versus current low-volume runs; family coverage **+20 to +35 pts**.

---

### P0.3 — Disable unverified synthetic search routing; route only through verified entrypoints and fingerprints

**Problem solved:** dead-end `/search` and `/?q=` routes causing `blocked_access` and `generic_shell_page`.

**Exact behavior change:** dynamic/generic adapters may emit search seeds **only** when the family pack declares a verified search path. Otherwise they seed only curated entry paths, discovered artist/detail URLs, sitemap-like routes, or listing/archive pages.

**Suggested location:**

* Update: `packages/source-registry/src/source-families.ts`
* Update: `packages/source-registry/src/routing.ts`
* Update: `packages/source-adapters/src/adapters/generic-adapter.ts`

```ts
interface SourceFamilyPack {
  // existing...
  verified_search_paths?: string[];
  preferred_entrypoint_types?: Array<"artist_index" | "archive" | "catalog" | "listing" | "search" | "sitemap">;
}

function buildDynamicAdapterForHost(host: string, discoveredUrl: string): SourceAdapter {
  const pack = resolveFamilyPackByHost(host);
  const verifiedSearch = pack?.verified_search_paths?.[0] ?? "";
  return new GenericSourceAdapter({
    // ...
    searchPath: verifiedSearch,
    crawlStrategies: ["listing_to_lot", "rendered_dom"]
  });
}

public async discoverCandidates(query: AdapterExtractionContext["query"]): Promise<SourceCandidate[]> {
  const seeds = [...this.entrypoints.map(asSeedCandidate)];
  if (this.searchPath) seeds.push(asSearchCandidate(this.baseUrl, this.searchPath, query));
  return dedupeCandidates(seeds.filter((c) => !looksLikeSyntheticQueryFallback(c.url)));
}
```

**Test cases:**

* Dynamic host with no verified search path emits **no** search seed.
* Family pack with verified `/search` emits search only after archive/artist/listing entrypoints.
* Müzayede-style or Artam-style hosts do not fall back to `/?q=`.

**Risk and rollback:** risk is missing a small number of working public search routes on long-tail hosts. Rollback with `ALLOW_UNVERIFIED_SEARCH_SEEDS=true`.

**Expected impact:** `blocked_access` and `generic_shell_page` buckets should fall **15–30 pts** on current failure-heavy runs; breadth should improve materially.

---

### P0.4 — Add an Artam-specific deterministic adapter with listing→lot expansion and structured-state extraction

**Problem solved:** Artam is high-yield for Abidin Dino but still behaves too generically.

**Exact behavior change:** seed Artam via archive/auction/listing routes; extract lot URLs using Artam-specific regex; parse official structured payloads first; only use browser as a last public fallback on lot pages.

**Suggested location:**

* Update: `packages/source-adapters/src/adapters/specialized-adapters.ts`
* Update: `packages/source-registry/src/routing.ts`
* New fixtures: `packages/source-adapters/test/fixtures/artam/*`

```ts
export class ArtamAdapter implements SourceAdapter {
  public async discoverCandidates(query: AdapterExtractionContext["query"]): Promise<SourceCandidate[]> {
    return [
      seed("https://www.artam.com/archive"),
      seed("https://www.artam.com/muzayede"),
      seed("https://www.artam.com/artists"),
    ];
  }

  public async extract(candidate: SourceCandidate, ctx: AdapterExtractionContext): Promise<AdapterExtractionResult> {
    const page = await fetchCheapestFirst(candidate.url, ctx.sessionContext);
    const structured = extractStructuredPayloads(page.html, ["__NEXT_DATA__", "auction", "lot", "estimate"]);
    const parsed = parseArtamLot(page.html, structured, candidate.url);

    const discovered = candidate.sourcePageType === "listing"
      ? extractUrls(page.html, /\/muzayede\/\d+-[^"'\s/]+\/[^"'\s]+/g).map(asLotCandidate)
      : [];

    return finalizeAdapterResult(parsed, discovered, page.html, ctx);
  }
}
```

**Test cases:**

* Artam listing fixture expands to at least **30** lot URLs on a realistic archive page.
* Artam lot fixture parses estimate/currency/title/dimensions/date correctly.
* Listing shell pages are not accepted as evidence unless record-level artist signals exist.

**Risk and rollback:** site-specific maintenance cost. Rollback with `ARTAM_SPECIALIZED_ADAPTER=false`, which falls back to the generic family adapter.

**Expected impact:** on Abidin Dino specifically, this is the highest-value patch; expected incremental gain is **+50 to +150 records** when combined with fairness.

---

### P0.5 — Make host health lane-aware and fix orchestration parity bugs immediately

**Problem solved:** browser/auth failures poison cheap-fetch routing, and inventory diagnostics are distorted.

**Exact behavior change:** key host health by `(host, crawl_lane, access_mode, source_surface)` and use context-specific penalties. Fix inventory failure attempts to use the actual family, not `adapter_id`.

**Suggested location:**

* Update: `packages/shared-types/src/operations.ts`
* Update: `packages/storage/src/storage.ts`
* Update: `packages/source-registry/src/routing.ts`
* Update: `packages/orchestrator/src/artist-market-inventory.ts`

```ts
type HostHealthKey = `${string}|${CrawlLane}|${AccessMode}|${SourceSurface}`;

function hostHealthKey(a: SourceAttempt): HostHealthKey {
  return `${a.transport_host ?? "unknown"}|${a.crawl_lane}|${a.access_mode}|${a.source_surface}`;
}

public recordHostAttemptScoped(attempt: SourceAttempt): void {
  const key = hostHealthKey(attempt);
  // update scoped stats
}

private buildFailureAttempt(
  run: RunEntity,
  frontier: FrontierItem,
  sourceFamily: string,
  sourceAccessStatus: SourceAccessStatus,
  error: string,
  transportKind?: TransportErrorKind
): SourceAttempt {
  return { /* ... */, source_family: sourceFamily, /* ... */ };
}
```

**Test cases:**

* Browser-block history does not suppress cheap-fetch attempts on the same host.
* Auth-required artist pages do not suppress public lot pages on the same host.
* Inventory failure attempts report the real source family.

**Risk and rollback:** schema/migration overhead. Rollback by keeping the current global host table as fallback if no scoped record exists.

**Expected impact:** coverage **+5 to +10 pts**, record volume **+10% to +30%**, and much cleaner family/lane diagnostics.

---

### P0.6 — Replace ratio-only “coverage met” with absolute-volume and family-breadth gates

**Problem solved:** current target can be met with 7 priced records and no meaningful breadth.

**Exact behavior change:** `coverage_target_met` becomes a composite objective, not a single ratio.

**Suggested location:**

* Update: `packages/shared-types/src/operations.ts`
* Update: `packages/orchestrator/src/run-insights.ts`
* Update: `packages/report-generation/src/markdown.ts`
* Update: `packages/browser-report/src/normalize.ts`

```ts
const coverageTargetMet =
  valuationReadinessRatio >= 0.85 &&
  pricedRecordCount >= 120 &&
  corePriceEvidenceCount >= 80 &&
  familyCoverageRatio >= 0.70 &&
  uniqueArtworkCount >= 150 &&
  blockedAccessShare < 0.25;
```

**Test cases:**

* A run with `7 priced / 9 accepted` no longer passes.
* A run with high priced count but one-family concentration fails family-coverage gate.
* Duplicate-heavy runs fail unique-artwork gate.

**Risk and rollback:** near-term dashboards will look worse before they look better. Rollback with `STRICT_VOLUME_GATES=false`.

**Expected impact:** no direct volume gain, but it removes false success and forces the system to optimize for the real mission.

---

### P1 (next iteration)

### P1.1 — Harden extraction for JS-heavy/API-backed lot pages with a canonical extraction ladder

**Problem solved:** `unknown_price_type`, missing numeric fields, and JS-only lot pages.

**Exact behavior change:** extract in this order:

1. visible HTML labels, 2) JSON-LD, 3) hydration blobs (`__NEXT_DATA__`, `__NUXT__`, Redux/Apollo state), 4) inline JSON/script payloads, 5) publicly reachable same-origin JSON endpoints discovered from page source, 6) browser raw snapshot fallback.

**Suggested location:**

* New: `packages/extraction/src/structured-lot-parser.ts`
* Update: `packages/extraction/src/lot-parser.ts`
* Update: `packages/orchestrator/src/pipeline.ts`

```ts
export function extractCanonicalLot(page: FetchedPage): ParsedLot {
  const candidates = [
    parseLabeledDom(page.html),
    parseJsonLd(page.html),
    parseHydrationState(page.html),
    parseInlinePayloads(page.html),
    parsePublicApiPayloads(page.html, page.url)
  ].filter(Boolean);

  return coalesceLotFields(candidates, {
    preferOfficialStructured: true,
    requireSamePageCurrency: true,
    neverInferPriceAcrossPages: true
  });
}
```

**Test cases:**

* JSON-LD-only page yields estimate and currency.
* Next.js hydration-only page yields title/artist/date/price.
* Public XHR endpoint found in page source can be fetched anonymously and parsed.

**Risk and rollback:** risk is overfitting to current frameworks. Rollback via `STRUCTURED_ENDPOINT_EXTRACTOR=false`.

**Expected impact:** `unknown_price_type` down to **<5%** on good detail pages; priced volume **+10% to +20%**.

---

### P1.2 — Tighten numeric parsing, entity matching, and medium filtering

**Problem solved:** false positives, one-sided estimates, marketplace noise, and non-painting contamination.

**Exact behavior change:**

* Treat one-sided estimates as **evidence-only**, not valuation-ready.
* Add `bid_current` / `opening_bid` as explicit non-valuation price types.
* Use locale-aware money parsing.
* Add artist alias matching and negative qualifiers (`after`, `attributed to`, `school of`, `style of`).
* Split medium buckets: `painting`, `work_on_paper`, `print`, `book`, `sculpture`, `other`.

**Suggested location:**

* Update: `packages/extraction/src/lot-parser.ts`
* Update: `packages/source-adapters/src/adapters/custom-adapter-utils.ts`
* Update: `packages/orchestrator/src/artist-market-inventory.ts`

```ts
export function parseLocalizedMoney(raw: string, localeHint?: string): number | null { /* ... */ }

export function classifyPriceContext(ctx: string): PriceType {
  if (/\b(realized|sold for|hammer)\b/i.test(ctx)) return "realized";
  if (/\b(muhammen|estimate)\b/i.test(ctx)) return "estimate";
  if (/\b(current price|current bid|opening bid)\b/i.test(ctx)) return "bid_current";
  if (/\b(price on request|fiyat istek üzerine|enquire)\b/i.test(ctx)) return "inquiry_only";
  return "unknown";
}
```

**Test cases:**

* `5.000 - 7.000 GBP`, `GBP 5,000–7,000`, `7.500,00 TL` all parse correctly.
* `Muhammen Bedel` classifies as estimate.
* `Current Price` on a live page becomes evidence-only, not realized.
* Books and unsigned print lots do not count toward the painting gate.

**Risk and rollback:** tighter gates can reduce apparent yield in the short term. Rollback with `STRICT_SEMANTICS_MODE=false`.

**Expected impact:** better report quality immediately; duplicate-adjusted unique artwork count becomes trustworthy.

---

### P1.3 — Operationalize promotion from dynamic host success and make stale-run recovery resumable

**Problem solved:** good dynamic hosts never graduate to curated families, and stale runs still waste progress.

**Exact behavior change:**

* Promote a dynamic host to a generated family-candidate artifact when it has stable URL fingerprints and sustained yield.
* Resume stale runs from frontier/checkpoint state instead of auto-failing them whenever possible.

**Suggested location:**

* New: `packages/source-registry/src/promotion.ts`
* Update: `packages/orchestrator/src/pipeline.ts`
* Update: `packages/storage/src/storage.ts`
* Update: `apps/worker/src/index.ts`

```ts
if (
  hostStats.dynamic &&
  hostStats.valuationReady >= 3 &&
  hostStats.reliability >= 0.40 &&
  hostStats.stableFingerprintRate >= 0.80
) {
  emitPromotionCandidate({
    host,
    suggestedFamily,
    entryPaths,
    verifiedSearchPaths,
    supportedSurfaces,
    legalPosture
  });
}

if (run.leaseExpired && pendingFrontierCount > 0) {
  markRunQueuedForResume(run.id, checkpoint);
}
```

**Test cases:**

* Successful dynamic host emits a promotion artifact after threshold is met.
* Dynamic host with mixed auth/blocked patterns does not promote.
* Expired-running run with pending frontier is resumed exactly once.
* Double finalization becomes idempotent.

**Risk and rollback:** promotion artifacts may overfit without fixtures; stale-run resume can expose hidden concurrency bugs. Rollback with `PROMOTION_PIPELINE_ENABLED=false` and `RESUMABLE_RUNS=false`.

**Expected impact:** medium-term scale improvement and fewer “stuck run” losses.

---

### P2 (hardening and scale)

### P2.1 — Unify both orchestration paths around one persistent frontier and adaptive budget allocator

**Problem solved:** standard and inventory paths still diverge in runtime behavior and state durability.

**Exact behavior change:**

* Move the standard research pipeline onto the same persistent frontier abstraction as inventory.
* Allocate additional budget after warm-up based on observed family yield, but only within fairness caps.

**Suggested location:**

* Update: `packages/storage/src/storage.ts`
* Update: `packages/orchestrator/src/pipeline.ts`
* Update: `packages/orchestrator/src/artist-market-inventory.ts`

```ts
const adaptiveBudget =
  clamp(baseBudget * (0.5 + 1.5 * emaYieldByFamily[family]), minBudget, maxBudget);

nextScore += adaptiveBudgetBoost(item.source_family_bucket);
```

**Test cases:**

* Same run plan in standard/inventory mode yields the same candidate ordering.
* High-yield families get more depth only after all families satisfy minima.
* Crash/restart preserves frontier order and dedupe state.

**Risk and rollback:** larger storage migration. Rollback by keeping standard path in-memory scheduler behind `UNIFIED_FRONTIER=false`.

**Expected impact:** lower regression risk, better recoverability, smoother scale-out.

---

### P2.2 — Calibrate confidence, freshness, and report weighting

**Problem solved:** final reports can still over-weight weak asking comps or stale duplicates.

**Exact behavior change:**

* Calibrate confidence bands from labeled fixtures.
* Weight final report evidence by trust tier, price type, freshness, and source family.
* Use asking comps as lower-weight context, not as dominant valuation anchors.

**Suggested location:**

* Update: `packages/orchestrator/src/artist-market-inventory.ts`
* Update: `packages/report-generation/src/*`
* New fixtures/benchmarks under `tests/benchmarks/abidin-dino/*`

```ts
const reportWeight =
  trustTierWeight(record) *
  priceTypeWeight(record.price_type) *
  freshnessWeight(record.sale_date ?? record.listed_date) *
  confidenceWeight(record.overall_confidence);
```

**Test cases:**

* Asking-only records cannot dominate the top comp set.
* Duplicate marketplaces collapse into one cluster weight.
* Fresh, high-trust official results outrank older low-trust direct-sale listings.

**Risk and rollback:** changes report ordering. Rollback with `CALIBRATED_REPORT_WEIGHTING=false`.

**Expected impact:** stronger final report credibility even when raw volume rises.

---

## Section E: Source-family intelligence table (Abidin Dino)

**Yield below is an operational inference from public route richness, observed Abidin-specific presence, and public price visibility.**

| Family              | Best entrypoints                                                             | Listing / lot-detail fingerprints                                                   | Price patterns / quirks                                                                                                            | Anti-bot / auth pattern                                                                  | Recommended lane order                                                                                                       | Expected yield                               | Evidence                            |
| ------------------- | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ----------------------------------- |
| **Artam**           | archive, auction listings, artist/archive routes, sitemap-driven entrypoints | official lot URLs under `/muzayede/<auction-id>-<auction-slug>/<lot-slug>`          | Turkish auction semantics; prioritize estimate/realized labels and lot metadata                                                    | image/shell-style pages possible; browser should be last-resort on public lot pages only | **L0 specialized listing→lot**, L1 cheap parse, L2 Crawlee on listing pages, L3 browser only for unresolved public lot pages | **High**                                     | ([Artam][1])                        |
| **Portakal**        | home, collections, past/completed auction pages, private-sales/shop pages    | `/products/<slug>`, `/collections/...`, `/pages/<catalog-slug>`                     | many product pages are **price-on-request** / inquiry-only; treat as evidence-only; historical catalog pages can still be valuable | mostly public; do not waste browser on obvious POA pages                                 | **L0 deterministic product/page routes**, L1 cheap parse, L2 listing expansion, L3 rare                                      | **High breadth / medium priced**             | ([Portakal Sanat ve Kültür Evi][2]) |
| **Müzayede App**    | `acik-muzayedeler.html`, partner gallery pages, auction archive pages        | lot-like pages ending in numeric `.html`; partner pages also end in numeric `.html` | current price, lot no, dimensions, partner auctioneer; treat live current price as evidence unless sale is closed                  | root/home can 403 while deeper pages remain reachable                                    | **L0 partner listing expansion**, L1 cheap lot parse, L2 Crawlee on listing pages, avoid root/browser-first                  | **High**                                     | ([Müzayede App][3])                 |
| **Clar Auction**    | `/en/live-auction/...`, `/en/auction/...?...tagId=` detail routes            | live-auction and auction detail URLs with lot tag/query IDs                         | public pages show current price and estimated value; current price is not realized                                                 | account/terms required to bid, but viewing is public                                     | **L0 deterministic lot pages**, L1 cheap parse, L2 browser only for public JS-heavy pages, never follow bid/login flow       | **Medium**                                   | ([Clarmuzayede][4])                 |
| **Alif Art**        | home, past-hall auction pages, category routes, direct lot pages             | public lot pages on `alifart.com` with stable slug-like paths                       | `Muhammen Bedel` is the key estimate label; multiple currencies are visible on the site; live bidding requires identity/deposit    | public lot pages, but live participation is auth/deposit gated                           | **L0 deterministic detail/past-hall**, L1 cheap parse, L2 listing Crawlee, L3 rare                                           | **Medium**                                   | ([Alif Art][5])                     |
| **Sanatfiyat**      | artist-detail pages, artist index, search                                    | `/tr/artist-detail/<id>/abidin-dino`                                                | strong discovery/meta value; members-only content means anonymous mode should not expect full price details                        | membership/package wall on valuable content                                              | **L0 licensed mode if entitled; otherwise discovery-only**; no browser escalation beyond wall detection                      | **High discovery / low anonymous valuation** | ([Sanat Fiyat][6])                  |
| **Invaluable**      | public artist page, auction-house pages, sold-price discovery                | `/artist/abidine-dino-.../` and linked sold-price pages                             | public artist page shows many auction records and recent houses; some detailed sold prices can be partially gated                  | public discovery is good; deeper sold-price detail varies by page                        | **L0 discovery-first**, L1 cheap parse on public result pages, L2 browser low priority                                       | **High breadth / medium priced**             | ([Invaluable][7])                   |
| **MutualArt**       | artist profile, artwork pages, performance/results tabs                      | `/Artist/Dino-Abidine/...` and `/Artwork/...`                                       | strong discovery breadth; performance data often premium-gated                                                                     | premium wall is common; use public artwork pages for evidence/discovery only             | **L0 discovery-first**, L1 cheap parse on public artwork pages, avoid browser on premium walls                               | **High breadth / medium-low priced**         | ([MutualArt][8])                    |
| **Sotheby’s**       | official lot pages, results/ecatalogue routes                                | `/en/buy/auction/<year>/<auction>/<lot>` and older ecatalogue lot URLs              | estimates are often public; some result visibility is login-dependent                                                              | mostly public lot pages; browser usually only needed for JS/hydration extraction         | **L0 deterministic lot**, L1 cheap structured parse, L2 browser only when public but JS-heavy                                | **Medium / high quality**                    | ([Sothebys.com][9])                 |
| **Christie’s**      | official lot pages                                                           | `/en/lot/lot-<id>`                                                                  | strong lot metadata; realized visibility varies                                                                                    | public lot pages; browser is occasional fallback only                                    | **L0 deterministic lot**, L1 cheap parse, L2 browser rare                                                                    | **Medium / high quality**                    | ([Christie's][10])                  |
| **LiveAuctioneers** | item pages, price-result pages                                               | `/item/<id>_<slug>` and `/price-result/.../`                                        | many pages show “See Sold Price” or attributed lots; keep attribution and uncertainty filters strict                               | public discovery is decent; value extraction quality is mixed                            | **L0 deterministic item/result pages**, L1 cheap parse, L2 low-priority browser                                              | **Medium**                                   | ([LiveAuctioneers][11])             |
| **1stDibs**         | direct listing pages                                                         | long direct-sale listing paths ending in `id-f_<id>`                                | useful for asking-price comps only; do not mix with realized data                                                                  | generally public numeric asking prices on some pages                                     | **L0 cheap parse only**, no browser unless image/title missing                                                               | **Medium for asking comps**                  | ([1stDibs][12])                     |

**Adjunct families worth keeping behind the first wave:**
Türel Art has public archive-style product pages with USD prices and stock-status cues, so it is useful as a low-yield direct-sale/evidence family. Galeri Nev Istanbul is useful for canonical titles, images, and artist/work inventory, but many commerce surfaces are enquiry-based. Artsy is useful for discovery, but pricing is more gated and should stay behind stronger public-value families. ([Turelart][13])

---

## Section F: Extraction and normalization hardening spec

### 1) Canonical extraction order for JS-heavy or API-backed lot pages

1. **Visible labeled fields in the fetched HTML**
   Prefer same-page labels like `Muhammen Bedel`, `Estimate`, `Realized`, `Current Price`, `Price on Request`, `Lot No`, dimensions, date.
2. **JSON-LD**
   `Product`, `VisualArtwork`, `Offer`, `AggregateOffer`, `AuctionLot`.
3. **Hydration blobs**
   `__NEXT_DATA__`, `__NUXT__`, `window.__INITIAL_STATE__`, Redux stores, Apollo caches.
4. **Inline script payloads / serialized JSON fragments**
5. **Public same-origin API calls** discovered from page source
   Anonymous `GET` only; no opaque auth-dependent endpoints.
6. **Browser raw snapshot DOM parse**
7. **Never infer numeric price from a different page, similar lot, or another source**

### 2) Canonical price semantics

| Detected context                                                | Canonical `price_type`        |                 Valuation eligible? | Rule                                                                      |
| --------------------------------------------------------------- | ----------------------------- | ----------------------------------: | ------------------------------------------------------------------------- |
| `realized`, `sold for`, `hammer`, `auction result`              | `realized`                    |                                 Yes | numeric + currency required                                               |
| `estimate`, `muhammen`, `estimated value`                       | `estimate`                    | **Yes only with both low and high** | one-sided estimate is evidence-only                                       |
| `price`, `buy now`, fixed listed price                          | `asking_price`                |                                 Yes | numeric + currency required                                               |
| `current price`, `current bid`, `opening bid`, `starting bid`   | `bid_current` / `opening_bid` |                                  No | evidence-only until sale is closed and explicitly realized                |
| `price on request`, `fiyat istek üzerine`, `enquire`, `inquire` | `inquiry_only`                |                                  No | evidence-only                                                             |
| `see sold price` with no numeric                                | `price_hidden`                |                                  No | evidence-only                                                             |
| ambiguous numeric with no reliable label                        | `unknown`                     |                                  No | reject from evidence retention unless another strong labeled field exists |

### 3) Numeric parsing rules

* Accept quoted and unquoted numerics.
* Handle locale separators: `7.500,00`, `7,500.00`, `5.000 - 7.000`, `GBP 5,000–7,000`.
* Keep currency and numeric parsing coupled. Do not accept a numeric estimate without page-level currency confirmation.
* Treat `$` as **ambiguous** until locale/site defaults resolve it; do not auto-map to USD without context.
* Require both ends of an estimate range to share the same currency.
* Never midpoint or backfill a missing estimate side for valuation.

### 4) Canonical field precedence

For `estimateLow/estimateHigh`, `priceAmount`, `currency`, `saleDate`, `lotNumber`:

1. Official same-page structured fields on the detail page
2. Official same-page labeled text
3. Same-page public JSON/XHR payload
4. Same-page hydration blobs
5. Heuristic regex extraction

Cross-source inference is allowed for **artist alias confirmation only**, never for numeric price.

### 5) Entity matching and false-positive reduction

Use a scored matcher:

```ts
artistScore =
  0.45 * structuredArtistMatch +
  0.25 * pageTitleMatch +
  0.15 * urlSlugMatch +
  0.15 * nearbyLabelMatch;
```

**Abidin alias set**

* `abidin dino`
* `âbidin dino`
* `abidine dino`
* `dino abidine`

**Negative qualifiers**

* `after`
* `attributed to`
* `school of`
* `style of`
* `circle of`
* `follower of`

Rules:

* Any negative qualifier drops valuation eligibility.
* For marketplace pages, require at least **two** artist signals unless the structured artist field matches exactly.
* Books, ephemera, and non-visual references to Abidin Dino stay out of the painting gate.

### 6) Medium normalization

Add `medium_bucket`:

* `painting`
* `work_on_paper`
* `print`
* `book`
* `sculpture`
* `other`

**Core painting gate** counts only `painting` + `work_on_paper`.
`print` stays in the extended inventory but is excluded from the core painting threshold.

### 7) LLM usage policy

Use local AI through LM Studio or provider fallback only for:

* borderline relevance reranking,
* duplicate/cluster adjudication,
* title normalization assistance.

Do **not** use any LLM to invent price fields, infer missing currency, or override deterministic rejection for unclear price semantics.

---

## Section G: Queue fairness and host-health model

### 1) Runtime fairness controls

**Abidin comprehensive default**

* Warm-up window: **first 120 attempts**
* Minimum attempts by family in warm-up:

  * `turkey_first_party = 50`
  * `turkey_platform = 20`
  * `db_meta = 15`
  * `global_major = 15`
  * `global_marketplace = 15`
  * `global_direct_sale = 5`

**Caps**

* No family > **35%** of total attempts
* No host > **15%** of total attempts
* No host > **25 attempts** before yielding either:

  * **2 priced records**, or
  * **5 evidence records**

**Blocked-family fast-fail**

* At **8 attempts**, if family block rate > **60%** and evidence yield = 0 → halve family score
* At **15 attempts**, if family block rate > **80%** and evidence yield = 0 → pause family for the run, except pre-verified official lot URLs

**Generic-shell fast-fail**

* At **10 attempts** on a host, if `generic_shell_page + blocked_access > 70%` and priced yield = 0 → soft-pause host in that lane

### 2) Progressive exploration schedule

| Phase   | Attempts | Allowed work                                                                          |
| ------- | -------: | ------------------------------------------------------------------------------------- |
| Phase 1 |     1–60 | only verified seeds, artist pages, archive/listing pages, direct lot URLs             |
| Phase 2 |   61–180 | enable listing→lot expansion for families with evidence yield ≥ 8%                    |
| Phase 3 |  181–500 | deeper lot expansion plus browser truth only on unresolved high-value pages           |
| Phase 4 |     501+ | gap-fill under-covered families, decades, mediums, and missing high-trust price types |

### 3) Lane-aware host health

**Key:** `host|crawl_lane|access_mode|source_surface`

**Score**

```ts
healthScore =
  0.45 * evidenceAcceptRate +
  0.35 * valuationAcceptRate +
  0.10 * parseSuccessRate -
  0.20 * blockedRate -
  0.15 * authRate;
```

**Suppression rules**

* suppress only that context when:

  * attempts in context ≥ **6**, and
  * `healthScore < 0.20` or `blockedRate > 0.70`
* decay penalties after:

  * **3 consecutive successes**, or
  * **7 days** of no failures

This fixes the current problem where browser failures suppress cheap-fetch on the same host.

---

## Section H: Metrics, diagnostics, and acceptance thresholds

### 1) Metrics to define and use

| Metric                           | Definition                                                                                          |                                             Target / threshold |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | -------------------------------------------------------------: |
| `valuation_readiness_ratio`      | `priced_record_count / max(1, evidence_record_count)`                                               |                                                     **≥ 0.85** |
| `priced_record_count`            | accepted valuation-ready records with numeric price/estimate and currency                           |                                                      **≥ 120** |
| `core_price_evidence_count`      | valuation-ready **realized + estimate** records, plus fixed-price first-party asking pages only     |                                                       **≥ 80** |
| `family_coverage_ratio`          | families that hit minimum attempts **and** yielded ≥1 priced record / selected families             |                                                     **≥ 0.70** |
| `lane_success_ratio[lane]`       | accepted evidence attempts in lane / attempts in lane                                               | cheap_fetch **≥ 0.18**, crawlee **≥ 0.12**, browser **≥ 0.25** |
| `volume_weighted_coverage_score` | `0.45*min(1, priced/120) + 0.25*familyCoverage + 0.20*valuationReadiness + 0.10*min(1, unique/150)` |                                                     **≥ 0.85** |
| `unique_artwork_count`           | deduped cluster count among core painting/work-on-paper records                                     |                                                      **≥ 150** |
| `duplicate_listing_rate`         | `(raw_core_records - unique_artworks) / raw_core_records`                                           |                    **≤ 0.45** overall, **≤ 0.25** among priced |
| `fresh_record_ratio`             | priced records dated within last 15 years / all priced records                                      |                                                     **≥ 0.40** |
| `confidence_mix`                 | high / medium / low confidence proportions among priced records                                     |                                         high+medium **≥ 0.90** |
| `high_trust_priced_count`        | priced records from trust-tier-high official families                                               |                                                       **≥ 60** |
| `inventory_record_count_2d`      | total accepted 2D visual-art records (core + secondary print bucket)                                |                                                      **≥ 250** |

### 2) Diagnostics to add

Add these to both summaries:

* `browser_overwrite_prevented_count`
* `unverified_search_seed_count`
* `family_block_decay_count`
* `family_share_breakdown`
* `lane_host_health_breakdown`
* `core_price_evidence_count`
* `record_medium_breakdown`
* `unique_artwork_count`
* `duplicate_listing_count`
* `confidence_mix`
* `freshness_mix`
* `promotion_candidate_conversion_count`

### 3) “Done” means all of the following

* `valuation_readiness_ratio >= 0.85`
* `priced_record_count >= 120`
* `core_price_evidence_count >= 80`
* `inventory_record_count_2d >= 250`
* `unique_artwork_count >= 150`
* `family_coverage_ratio >= 0.70`
* `high_trust_priced_count >= 60`
* `blocked_access_share < 0.25` after the first 200 attempts
* `generic_shell_page_share < 0.10`
* `unknown_price_type_share < 0.05`
* `browser_overwrite_prevented_count > 0` initially during validation, then the destructive overwrite path should disappear from accepted output
* No single family > `35%` of attempts or > `45%` of priced records

---

## Section I: Test plan (unit, integration, run-level canaries)

### Unit tests

| Module                       | Test                                 | Pass condition                                               |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------ |
| `lane-outcomes.ts`           | `keepsCheapFetchWhenBrowserBlocks`   | accepted cheap-fetch outcome survives browser block/auth     |
| `lane-outcomes.ts`           | `promotesStrongerLaterOutcome`       | stronger later valuation-ready outcome replaces weaker one   |
| `frontier-fairness.ts`       | `enforcesFamilyMinimums`             | under-covered families outrank over-share families           |
| `frontier-fairness.ts`       | `decaysBlockedFamily`                | blocked zero-yield family cannot dominate remaining frontier |
| `routing.ts`                 | `noUnverifiedSearchSeed`             | dynamic adapter emits no `/?q=` without verified path        |
| `custom-adapter-utils.ts`    | `oneSidedEstimateIsEvidenceOnly`     | estimate with only one bound is not valuation-ready          |
| `lot-parser.ts`              | `classifiesCurrentBidAsEvidenceOnly` | current price does not become realized                       |
| `storage.ts`                 | `scopedHostHealthDoesNotCrossPoison` | browser-failure stats do not suppress cheap-fetch            |
| `artist-market-inventory.ts` | `failureAttemptUsesRealFamily`       | `source_family` is not `adapter_id`                          |

### Integration tests

| Fixture family         | Scenario                        | Pass condition                                                                |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------- |
| Artam                  | archive/listing fixture         | expands at least 30 lot URLs, ≥70% detail parse success on fixture set        |
| Portakal               | product + old catalog page      | POA pages become evidence-only; catalog pages remain parseable                |
| Müzayede App           | partner gallery page + lot page | lot expansion works even when root/home is not useful                         |
| Clar                   | live-auction detail page        | estimate/current-price semantics parsed; no login traversal                   |
| Alif Art               | public lot page                 | `Muhammen Bedel` recognized as estimate                                       |
| Sotheby’s / Christie’s | official public lot pages       | structured fields beat heuristic regex extraction                             |
| Invaluable / MutualArt | public artist page              | discovery candidates extracted; premium walls do not trigger unlawful fetches |
| Standard vs inventory  | same fixture corpus             | same acceptance reason and normalized fields across both paths                |

### Run-level canaries

| Canary                            |                                 Budget | Pass threshold                                                                              |
| --------------------------------- | -------------------------------------: | ------------------------------------------------------------------------------------------- |
| `abidin-breadth-canary`           |                           120 attempts | `family_coverage_ratio ≥ 0.50`, `blocked_access < 0.40`, `unverified_search_seed_count = 0` |
| `abidin-turkey-depth-canary`      |                           300 attempts | `priced_record_count ≥ 40`, `inventory_record_count_2d ≥ 100`, `generic_shell_page < 0.15`  |
| `abidin-global-enrichment-canary` |                           200 attempts | adds `≥20` unique artworks and `≥2` global families with priced records                     |
| `abidin-final-acceptance`         | stop at thresholds or 720 attempts max | all Section H done criteria satisfied                                                       |

---

## Section J: Step-by-step execution playbook to hit 85%+ and hundreds of records

### 1) Pre-run checks

1. Merge **all P0 patches** first. Do not rerun live at scale before that.
2. Enable only lawful modes:

   * anonymous by default,
   * authorized/licensed only where you already have entitlement and explicit config.
3. Set deterministic config:

   * `STRUCTURED_LLM_PROVIDER=openai_compatible`
   * `LLM_BASE_URL=<LM Studio OpenAI-compatible endpoint>` for local reranking only
   * `WEB_DISCOVERY_ENABLED=true`
   * primary + secondary discovery provider configured
4. Turn on feature flags:

   * `PRESERVE_BEST_LANE_OUTCOME=true`
   * `FRONTIER_FAIRNESS_ENABLED=true`
   * `ALLOW_UNVERIFIED_SEARCH_SEEDS=false`
   * `ARTAM_SPECIALIZED_ADAPTER=true`
   * `LANE_AWARE_HOST_HEALTH=true`
   * `STRICT_VOLUME_GATES=true`
5. Prepare Abidin alias variants:

   * `Abidin Dino`
   * `Âbidin Dino`
   * `Abidine Dino`
   * `Dino Abidine`
6. Enforce medium buckets before the run:

   * core: `painting`, `work_on_paper`
   * secondary: `print`
   * exclude from core: `book`, `other`

### 2) Family plan for the first full Abidin run

**Mandatory first wave**

* Artam
* Portakal
* Müzayede App
* Clar Auction
* Alif Art
* Sanatfiyat (licensed if entitled; otherwise discovery-only)
* Invaluable
* MutualArt
* Sotheby’s
* Christie’s

**Secondary**

* LiveAuctioneers
* 1stDibs

### 3) Iterative run loop

#### Run 0 — offline replay

* Run fixture suite only.
* **Go** only if:

  * overwrite-safe lane merge passes,
  * no unverified search seeds,
  * Artam fixture expansion works,
  * both orchestrators agree on normalization.

#### Run 1 — breadth canary

* Budget: **120 attempts**
* Goal: prove breadth, not final volume.
* **Go** if:

  * `family_coverage_ratio >= 0.50`
  * `blocked_access < 0.40`
  * `generic_shell_page < 0.20`
  * at least **1** successful Crawlee recovery is recorded
* **Patch before rerun** if any of:

  * `blocked_access > 0.40`
  * `generic_shell_page > 0.20`
  * `unverified_search_seed_count > 0`
  * `family_coverage_ratio < 0.50`

#### Run 2 — Turkey depth

* Budget: **300 attempts**
* Focus families: Artam, Portakal, Müzayede App, Clar, Alif Art
* Goal:

  * `inventory_record_count_2d >= 100`
  * `priced_record_count >= 40`
  * `high_trust_priced_count >= 25`
* **Patch before rerun** if:

  * any of the top 3 families yields `<1 evidence record / 15 attempts`
  * Artam-specific `generic_shell_page > 0.15`
  * `unknown_price_type > 0.10` on detail pages

#### Run 3 — global enrichment

* Budget: **200 attempts**
* Focus families: Invaluable, MutualArt, Sotheby’s, Christie’s, LiveAuctioneers, 1stDibs
* Goal:

  * add **≥20** unique artworks
  * at least **2** global families with priced records
  * improve freshness and confidence mix
* **Patch before rerun** if:

  * global families add `<10` new unique artworks total
  * marketplace duplicates exceed **35%** of new additions

#### Run 4 — gap fill

* Budget: **100 attempts**
* Use only under-covered families, decades, or medium buckets.
* Stop when all Section H thresholds are met.

### 4) Patch-vs-rerun decision rules

**Patch, do not rerun blindly, when:**

* `blocked_access > 40%` by attempt 80
* `generic_shell_page > 20%` on a high-priority family after 15 family attempts
* `unknown_price_type > 10%` on pages that clearly contain numeric text
* `browser_overwrite_prevented_count == 0` but browser block/auth still appears in traces
* `family_coverage_ratio < 0.50` after 120 attempts
* no crawlee/browser lane successes are recorded while data-insufficient rejections remain high

**Rerun is acceptable when:**

* the prior run failed on lease/finalization only,
* the frontier never reached intended families due config drift,
* or diagnostics show the previous run ended before warm-up minima were satisfied.

### 5) Final acceptance criteria for “done”

Declare success only when **all** of these are true in one full run:

* `valuation_readiness_ratio >= 0.85`
* `priced_record_count >= 120`
* `core_price_evidence_count >= 80`
* `inventory_record_count_2d >= 250`
* `unique_artwork_count >= 150`
* `family_coverage_ratio >= 0.70`
* `high_trust_priced_count >= 60`
* `blocked_access_share < 0.25`
* `generic_shell_page_share < 0.10`
* `unknown_price_type_share < 0.05`

---

## Section K: Risk register and fallback strategies

| Risk                                              | Why it matters                                       | Safe fallback                                                                      |
| ------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Route drift on Artam / Portakal / Müzayede App    | specialized adapters can go stale                    | keep generic adapter as a flaggable fallback; preserve fixtures and route tests    |
| Licensed/meta families become more gated          | discovery remains useful but valuation depth drops   | keep them discovery-only unless explicit licensed entitlement is configured        |
| Duplicate inflation from aggregators              | can fake “hundreds” without adding breadth           | use unique-artwork and duplicate-rate gates; never count duplicates toward success |
| Print/book contamination inflates painting counts | weakens the valuation report                         | enforce `medium_bucket`; core gate counts only painting + work_on_paper            |
| Browser lane cost or blocking spikes              | can waste budget and overwrite signals               | keep browser trigger-only; never universal-browser every page                      |
| LM Studio / provider instability                  | borderline reranking may fail                        | deterministic parsers remain source of truth; AI is advisory only                  |
| Resumable run logic introduces concurrency bugs   | could create duplicate finalization                  | add idempotent finalizer and one-resume-only tests                                 |
| Metrics remain gameable                           | team may optimize for a ratio instead of the mission | require absolute counts, family coverage, and duplicate-adjusted volume            |
| Documentation drift from actual code              | future teams may mis-diagnose the system             | update ops + architecture docs immediately after P0 merge                          |

This is the shortest path from your current codebase to an honest 85%+ valuation-ready pipeline that also produces the breadth you actually need for Abidin Dino.

[1]: https://artam.com/muzayede/340-cagdas-ve-klasik-tablolar/abidin-dino-1913-1993-yuzler "https://artam.com/muzayede/340-cagdas-ve-klasik-tablolar/abidin-dino-1913-1993-yuzler"
[2]: https://www.rportakal.com/ "https://www.rportakal.com/"
[3]: https://www.muzayede.app/acik-muzayedeler.html "https://www.muzayede.app/acik-muzayedeler.html"
[4]: https://www.clarmuzayede.com/en/live-auction/34308/antiques-auction "https://www.clarmuzayede.com/en/live-auction/34308/antiques-auction"
[5]: https://www.alifart.com/ "https://www.alifart.com/"
[6]: https://sanatfiyat.com/tr/artist-detail/95/abidin-dino "https://sanatfiyat.com/tr/artist-detail/95/abidin-dino"
[7]: https://www.invaluable.com/artist/abidine-dino-c5plzo7nwe/ "https://www.invaluable.com/artist/abidine-dino-c5plzo7nwe/"
[8]: https://www.mutualart.com/Artist/Dino-Abidine/65E2496F42E5724F "https://www.mutualart.com/Artist/Dino-Abidine/65E2496F42E5724F"
[9]: https://www.sothebys.com/en/buy/auction/2024/modern-contemporary-middle-east-2/labyrinth "https://www.sothebys.com/en/buy/auction/2024/modern-contemporary-middle-east-2/labyrinth"
[10]: https://www.christies.com/en/lot/lot-5132402 "https://www.christies.com/en/lot/lot-5132402"
[11]: https://www.liveauctioneers.com/item/173210325_stano-filko-mixed-media-abstract-composition "https://www.liveauctioneers.com/item/173210325_stano-filko-mixed-media-abstract-composition"
[12]: https://www.1stdibs.com/furniture/wall-decorations/paintings/abstract-painting-dino-abidin-25-no-3/id-f_21816302/ "https://www.1stdibs.com/furniture/wall-decorations/paintings/abstract-painting-dino-abidin-25-no-3/id-f_21816302/"
[13]: https://www.turelart.com/hakki-anli-masadakiler-tablo-tuyb-35x44cm/ "https://www.turelart.com/hakki-anli-masadakiler-tablo-tuyb-35x44cm/"
