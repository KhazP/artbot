export type VenueType =
  | "auction_house"
  | "gallery"
  | "dealer"
  | "marketplace"
  | "database"
  | "other";

export type SourcePageType =
  | "lot"
  | "artist_page"
  | "price_db"
  | "listing"
  | "article"
  | "other";

export type PriceType =
  | "asking_price"
  | "estimate"
  | "hammer_price"
  | "realized_price"
  | "realized_with_buyers_premium"
  | "inquiry_only"
  | "unknown";

export type PriceSemanticLane = "realized" | "estimate" | "asking" | "inquiry" | "unknown";

export type ValuationLane = "realized" | "estimate" | "asking" | "none";

export type AcceptanceReason =
  | "valuation_ready"
  | "estimate_range_ready"
  | "asking_price_ready"
  | "inquiry_only_evidence"
  | "price_hidden_evidence"
  | "entity_mismatch"
  | "generic_shell_page"
  | "missing_numeric_price"
  | "missing_currency"
  | "missing_estimate_range"
  | "unknown_price_type"
  | "blocked_access";

export type SourceAccessStatus =
  | "public_access"
  | "auth_required"
  | "licensed_access"
  | "blocked"
  | "price_hidden";

export type FailureClass =
  | "access_blocked"
  | "waf_challenge"
  | "not_found"
  | "transport_timeout"
  | "transport_dns"
  | "transport_other"
  | "host_circuit";

export type AccessMode = "anonymous" | "authorized" | "licensed";

export type SourceLegalPosture =
  | "public_permitted"
  | "public_contract_sensitive"
  | "auth_required"
  | "licensed_only"
  | "operator_assisted_only";

export type ArtifactHandling = "standard" | "scrubbed_sensitive" | "internal_only";

export type RunStatus = "pending" | "running" | "completed" | "failed";

export type RunType = "artist" | "work" | "artist_market_inventory";
