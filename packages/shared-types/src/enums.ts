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

export type SourceAccessStatus =
  | "public_access"
  | "auth_required"
  | "licensed_access"
  | "blocked"
  | "price_hidden";

export type AccessMode = "anonymous" | "authorized" | "licensed";

export type RunStatus = "pending" | "running" | "completed" | "failed";
