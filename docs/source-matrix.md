# Source Matrix (v1)

| Adapter ID | Source | Tier | Region Priority | Requires Auth | Requires License | Supported Modes | Expected Statuses |
|---|---|---|---|---|---|---|---|
| artam-auction-records | Artam Auction Records | 1 | Turkey | No | No | anonymous/authorized/licensed | public_access, price_hidden, blocked |
| artam-lot | Artam Lots | 1 | Turkey | No | No | anonymous/authorized/licensed | public_access, price_hidden, blocked |
| alifart-lot | Alif Art | 1 | Turkey | No | No | anonymous/authorized/licensed | public_access, price_hidden, blocked |
| turkish-auction-generic | Turkish Auction Generic | 2 | Turkey | No | No | anonymous/authorized/licensed | public_access, blocked |
| sothebys-lot | Sothebys | 1 | International | No | No | anonymous/authorized/licensed | public_access, blocked, price_hidden |
| christies-lot | Christies | 1 | International | No | No | anonymous/authorized/licensed | public_access, blocked, price_hidden |
| bonhams-lot | Bonhams | 1 | International | No | No | anonymous/authorized/licensed | public_access, blocked, price_hidden |
| phillips-lot | Phillips | 1 | International | No | No | anonymous/authorized/licensed | public_access, blocked, price_hidden |
| artsy-probe | Artsy | 2 | International DB | Yes | No | anonymous/authorized/licensed | auth_required, public_access, blocked |
| mutualart-probe | MutualArt | 2 | International DB | Yes | No | anonymous/authorized/licensed | auth_required, public_access, blocked |
| askart-probe | askART | 2 | International DB | Yes | Yes | licensed | licensed_access, blocked |
| invaluable-listing | Invaluable | 2 | International | No | No | anonymous/authorized/licensed | public_access, blocked, price_hidden |

## Notes
- `price_hidden` is emitted when listing pages are inquiry-only or price-on-request.
- `blocked` is used when legal/contractual access is unavailable or technical blocking is detected.
