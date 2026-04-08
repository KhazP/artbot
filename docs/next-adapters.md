# Next-Priority Adapter Roadmap

## Priority 1 (Turkey Auction Depth)
1. `muzayedeapp-venue-expansion`
- Goal: add venue-specific route templates for known Müzayede-powered houses discovered in production logs.
- Acceptance: improved lot discovery yield with stable bounded candidate expansion.

2. `bayrak-and-turel-hardening`
- Goal: improve Bayrak/Turel parser stability on additional listing and lot templates.
- Acceptance: lower unknown-rate and no semantic regressions in inquiry-only classification.

3. `lefevre-auction-adapter` (if public lot pages remain stable)
- Goal: capture modern/contemporary Turkish lots and estimate/result fields.
- Acceptance: successful status + evidence capture on fixture pages.

## Priority 2 (International Comp Reliability)
4. `invaluable-lot-detail-adapter`
- Goal: move from listing-level probes to lot-detail extraction.
- Acceptance: explicit price type classification and source evidence.

5. `liveauctioneers-public-lot-adapter`
- Goal: supplement sparse Turkey coverage with adjacent international auction comps.
- Acceptance: robust blocked/auth handling + no fabricated fields.

## Priority 3 (Licensed and Authenticated Depth)
6. `sanatfiyat-licensed-hardening`
- Goal: source-specific parsing improvements with stronger lot normalization and provenance notes.
- Acceptance: reduced unknown/low-confidence rate on licensed fixtures and real runs.

7. `artsy-licensed-connector`
- Goal: authenticated query path when operator credentials are lawful and available.
- Acceptance: proper `auth_required`/`licensed_access` state transitions and session reuse.

8. `askart-licensed-connector`
- Goal: licensed lookup path with clear provenance/evidence logs.
- Acceptance: no numeric extraction when page is hidden/inquiry-only.

## Cross-Cutting
- Build fixture packs per adapter (`data/fixtures/adapters/<adapter-id>/`).
- Add adapter-level integration tests for `public_access`, `auth_required`, and `blocked` transitions.
- Add per-source rate-limit and retry policy calibration after first production logs.
