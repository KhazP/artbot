# Source Matrix (Current)

## Production Baseline (Enabled by Default)
| Adapter ID | Source | Type | Depth | Region | Auth/Licensing |
|---|---|---|---|---|---|
| muzayedeapp-platform | Müzayede App Platform | deterministic venue adapter | partial-deep (listing->lot expansion + extraction) | Turkey | public/auth/licensed modes |
| bayrak-muzayede-listing | Bayrak Listing | deterministic venue adapter | partial-deep | Turkey | public/auth/licensed modes |
| bayrak-muzayede-lot | Bayrak Lot | deterministic venue adapter | partial-deep | Turkey | public/auth/licensed modes |
| turel-art-listing | Türel Listing | deterministic venue adapter | partial | Turkey | public/auth/licensed modes |
| antikasa-lot-adapter | Antik A.S. Lot | deterministic venue adapter | partial | Turkey | public/auth/licensed modes |
| portakal-catalog | Portakal Catalog (`rportakal`) | deterministic venue adapter | partial | Turkey | public/auth/licensed modes |
| clar-buy-now | Clar Buy Now (`clarmuzayede`) | deterministic venue adapter | partial | Turkey | public/auth/licensed modes |
| clar-archive | Clar Archive (`clarmuzayede`) | deterministic venue adapter | partial | Turkey | public/auth/licensed modes |
| sanatfiyat-licensed-extractor | Sanatfiyat | deterministic licensed adapter | partial | Turkey | licensed only |
| artam-auction-records | Artam Records | generic adapter | probe/partial | Turkey | public/auth/licensed modes |
| artam-lot | Artam Lot | generic adapter | probe/partial | Turkey | public/auth/licensed modes |
| alifart-lot | Alif Art Lot | generic adapter | probe/partial | Turkey | public/auth/licensed modes |
| sothebys-lot | Sotheby’s | generic adapter | probe | International | public/auth/licensed modes |
| christies-lot | Christie’s | generic adapter | probe | International | public/auth/licensed modes |
| bonhams-lot | Bonhams | generic adapter | probe | International | public/auth/licensed modes |
| phillips-lot | Phillips | generic adapter | probe | International | public/auth/licensed modes |
| invaluable-lot-detail-adapter | Invaluable Lot Detail | deterministic venue adapter | partial | International | public/auth/licensed modes |
| liveauctioneers-public-lot-adapter | LiveAuctioneers Public Lots | deterministic venue adapter | partial | International | public/auth/licensed modes |

## Optional Probe Adapters (Disabled by Default)
Enabled only when `ENABLE_OPTIONAL_PROBE_ADAPTERS=true`.

| Adapter ID | Source | Status |
|---|---|---|
| artsy-probe | Artsy | auth-sensitive probe |
| mutualart-probe | MutualArt | auth-sensitive probe |
| askart-probe | askART | licensed/auth-sensitive probe |

## Notes
- `turkish-auction-generic` was removed to avoid Google-search seeding and misleading coverage.
- Coverage labels are now explicit: `partial-deep`, `partial`, `probe`.
- Valuation trust does **not** depend on adapter count; it depends on valuation-eligible extraction quality.
