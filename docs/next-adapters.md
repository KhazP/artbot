# Next-Priority Adapter Roadmap

## Priority 1 (Turkey Auction Depth)
1. `antikasa-lot-adapter`
- Goal: lot-level extraction of realized/estimate fields from Antik A.Ş.
- Acceptance: parse at least lot number, sale date, and realized/estimate for stable public pages.

2. `lefevre-auction-adapter` (if public lot pages remain stable)
- Goal: capture modern/contemporary Turkish lots and estimate/result fields.
- Acceptance: successful status + evidence capture on fixture pages.

3. `istanbul-muzayede-generic-adapter`
- Goal: expand Turkish regional venue coverage using reusable lot/list templates.
- Acceptance: no false merges; status classification remains correct.

## Priority 2 (International Comp Reliability)
4. `invaluable-lot-detail-adapter`
- Goal: move from listing-level probes to lot-detail extraction.
- Acceptance: explicit price type classification and source evidence.

5. `liveauctioneers-public-lot-adapter`
- Goal: supplement sparse Turkey coverage with adjacent international auction comps.
- Acceptance: robust blocked/auth handling + no fabricated fields.

## Priority 3 (Licensed and Authenticated Depth)
6. `artsy-licensed-connector`
- Goal: authenticated query path when operator credentials are lawful and available.
- Acceptance: proper `auth_required`/`licensed_access` state transitions and session reuse.

7. `askart-licensed-connector`
- Goal: licensed lookup path with clear provenance/evidence logs.
- Acceptance: no numeric extraction when page is hidden/inquiry-only.

## Cross-Cutting
- Build fixture packs per adapter (`data/fixtures/adapters/<adapter-id>/`).
- Add adapter-level integration tests for `public_access`, `auth_required`, and `blocked` transitions.
- Add per-source rate-limit and retry policy calibration after first production logs.
