import type { SourceFamilyBucket } from "@artbot/source-registry";

export interface FairnessConfig {
  enabled: boolean;
  warmupAttempts: number;
  familyMinAttempts: Partial<Record<SourceFamilyBucket, number>>;
  familyMaxShare: number;
  hostMaxShare: number;
  hostHardCap: number;
  blockedDecayStart: number;
  blockedDecayRate: number;
  blockedPauseAt: number;
  blockedPauseRate: number;
}

export interface RuntimeFairnessStats {
  totalAttempts: number;
  attemptsByFamily: Partial<Record<SourceFamilyBucket, number>>;
  blockedByFamily: Partial<Record<SourceFamilyBucket, number>>;
  evidenceByFamily: Partial<Record<SourceFamilyBucket, number>>;
  pricedByFamily: Partial<Record<SourceFamilyBucket, number>>;
  attemptsByHost: Record<string, number>;
  evidenceByHost: Record<string, number>;
  pricedByHost: Record<string, number>;
}

export interface FrontierFairnessInput {
  sourceFamilyBucket: SourceFamilyBucket;
  sourceHost: string;
  sourcePageType: "lot" | "artist_page" | "price_db" | "listing" | "article" | "other";
  provenance: "seed" | "query_variant" | "listing_expansion" | "signature_expansion" | "direct_lot" | "web_discovery";
  baseScore: number;
  isPreverifiedLot?: boolean;
}

export interface RuntimeAttemptUpdate {
  sourceFamilyBucket: SourceFamilyBucket;
  sourceHost: string;
  acceptedForEvidence: boolean;
  pricedAcceptance: boolean;
  sourceAccessStatus: "public_access" | "auth_required" | "licensed_access" | "blocked" | "price_hidden";
}

const DEFAULT_MINIMUMS: Partial<Record<SourceFamilyBucket, number>> = {
  turkey_first_party: 50,
  turkey_platform: 20,
  db_meta: 15,
  global_major: 15,
  global_marketplace: 15,
  global_direct_sale: 5,
  turkey_gallery_shop_private_sale: 0,
  open_web: 0
};

function toNumber(value: string | undefined, fallback: number): number {
  const parsed = Number(value ?? fallback);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function toInt(value: string | undefined, fallback: number): number {
  return Math.max(0, Math.floor(toNumber(value, fallback)));
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) {
    return fallback;
  }
  return value.trim().toLowerCase() === "true";
}

function isBlockedStatus(status: RuntimeAttemptUpdate["sourceAccessStatus"]): boolean {
  return status === "blocked" || status === "auth_required";
}

function ratio(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}

export function buildFairnessConfig(analysisMode: "fast" | "balanced" | "comprehensive"): FairnessConfig {
  const warmupDefault = analysisMode === "fast" ? 40 : analysisMode === "balanced" ? 80 : 120;
  const familyMaxShareDefault = analysisMode === "fast" ? 0.45 : analysisMode === "balanced" ? 0.4 : 0.35;

  return {
    enabled: toBoolean(process.env.FRONTIER_FAIRNESS_ENABLED, true),
    warmupAttempts: toInt(process.env.FRONTIER_FAIRNESS_WARMUP_ATTEMPTS, warmupDefault),
    familyMinAttempts: DEFAULT_MINIMUMS,
    familyMaxShare: toNumber(process.env.FRONTIER_FAIRNESS_FAMILY_MAX_SHARE, familyMaxShareDefault),
    hostMaxShare: toNumber(process.env.FRONTIER_FAIRNESS_HOST_MAX_SHARE, 0.15),
    hostHardCap: toInt(process.env.FRONTIER_FAIRNESS_HOST_HARD_CAP, 25),
    blockedDecayStart: toInt(process.env.FRONTIER_FAIRNESS_BLOCKED_DECAY_START, 8),
    blockedDecayRate: toNumber(process.env.FRONTIER_FAIRNESS_BLOCKED_DECAY_RATE, 0.6),
    blockedPauseAt: toInt(process.env.FRONTIER_FAIRNESS_BLOCKED_PAUSE_AT, 15),
    blockedPauseRate: toNumber(process.env.FRONTIER_FAIRNESS_BLOCKED_PAUSE_RATE, 0.8)
  };
}

export function createRuntimeFairnessStats(): RuntimeFairnessStats {
  return {
    totalAttempts: 0,
    attemptsByFamily: {},
    blockedByFamily: {},
    evidenceByFamily: {},
    pricedByFamily: {},
    attemptsByHost: {},
    evidenceByHost: {},
    pricedByHost: {}
  };
}

export function applyRuntimeAttemptToFairnessStats(
  stats: RuntimeFairnessStats,
  update: RuntimeAttemptUpdate
): RuntimeFairnessStats {
  stats.totalAttempts += 1;
  stats.attemptsByFamily[update.sourceFamilyBucket] = (stats.attemptsByFamily[update.sourceFamilyBucket] ?? 0) + 1;
  stats.attemptsByHost[update.sourceHost] = (stats.attemptsByHost[update.sourceHost] ?? 0) + 1;

  if (isBlockedStatus(update.sourceAccessStatus)) {
    stats.blockedByFamily[update.sourceFamilyBucket] = (stats.blockedByFamily[update.sourceFamilyBucket] ?? 0) + 1;
  }
  if (update.acceptedForEvidence) {
    stats.evidenceByFamily[update.sourceFamilyBucket] = (stats.evidenceByFamily[update.sourceFamilyBucket] ?? 0) + 1;
    stats.evidenceByHost[update.sourceHost] = (stats.evidenceByHost[update.sourceHost] ?? 0) + 1;
  }
  if (update.pricedAcceptance) {
    stats.pricedByFamily[update.sourceFamilyBucket] = (stats.pricedByFamily[update.sourceFamilyBucket] ?? 0) + 1;
    stats.pricedByHost[update.sourceHost] = (stats.pricedByHost[update.sourceHost] ?? 0) + 1;
  }

  return stats;
}

function familyDeficitBonus(
  input: FrontierFairnessInput,
  stats: RuntimeFairnessStats,
  config: FairnessConfig
): number {
  if (stats.totalAttempts >= config.warmupAttempts) {
    return 0;
  }
  const minRequired = config.familyMinAttempts[input.sourceFamilyBucket] ?? 0;
  if (minRequired <= 0) {
    return 0;
  }
  const familyAttempts = stats.attemptsByFamily[input.sourceFamilyBucket] ?? 0;
  if (familyAttempts >= minRequired) {
    return 0;
  }
  const deficit = minRequired - familyAttempts;
  return 1.5 + Math.min(1, deficit / Math.max(1, minRequired));
}

function familySharePenalty(
  input: FrontierFairnessInput,
  stats: RuntimeFairnessStats,
  config: FairnessConfig
): number {
  const familyAttempts = stats.attemptsByFamily[input.sourceFamilyBucket] ?? 0;
  const share = ratio(familyAttempts, Math.max(1, stats.totalAttempts));
  if (share <= config.familyMaxShare) {
    return 0;
  }
  return -1 * (0.75 + Math.min(1, share - config.familyMaxShare));
}

function hostPenalty(input: FrontierFairnessInput, stats: RuntimeFairnessStats, config: FairnessConfig): number {
  const hostAttempts = stats.attemptsByHost[input.sourceHost] ?? 0;
  const hostShare = ratio(hostAttempts, Math.max(1, stats.totalAttempts));
  let penalty = 0;

  if (hostShare > config.hostMaxShare) {
    penalty -= 0.8 + Math.min(1, hostShare - config.hostMaxShare);
  }

  const priced = stats.pricedByHost[input.sourceHost] ?? 0;
  if (hostAttempts >= config.hostHardCap && priced < 2) {
    penalty -= 1.6;
  }

  return penalty;
}

function blockedFamilyPenalty(
  input: FrontierFairnessInput,
  stats: RuntimeFairnessStats,
  config: FairnessConfig
): number {
  const familyAttempts = stats.attemptsByFamily[input.sourceFamilyBucket] ?? 0;
  if (familyAttempts <= 0) {
    return 0;
  }

  const blocked = stats.blockedByFamily[input.sourceFamilyBucket] ?? 0;
  const evidence = stats.evidenceByFamily[input.sourceFamilyBucket] ?? 0;
  const priced = stats.pricedByFamily[input.sourceFamilyBucket] ?? 0;
  const blockedRate = ratio(blocked, familyAttempts);
  const yieldRate = ratio(evidence, familyAttempts);
  const pricedRate = ratio(priced, familyAttempts);

  if (
    familyAttempts >= config.blockedPauseAt &&
    blockedRate >= config.blockedPauseRate &&
    pricedRate < 0.05 &&
    !input.isPreverifiedLot
  ) {
    return -10;
  }

  if (familyAttempts >= config.blockedDecayStart && blockedRate >= config.blockedDecayRate && pricedRate < 0.1) {
    return -2.2;
  }

  if (familyAttempts >= config.blockedDecayStart && blockedRate >= 0.45 && yieldRate < 0.2) {
    return -1;
  }

  return 0;
}

export function scoreFrontierItem(
  input: FrontierFairnessInput,
  stats: RuntimeFairnessStats,
  config: FairnessConfig
): number {
  if (!config.enabled) {
    return input.baseScore;
  }

  let score = input.baseScore;
  score += familyDeficitBonus(input, stats, config);
  score += familySharePenalty(input, stats, config);
  score += hostPenalty(input, stats, config);
  score += blockedFamilyPenalty(input, stats, config);

  if (input.sourcePageType === "lot") {
    score += 0.6;
  }
  if (input.provenance === "listing_expansion") {
    score += 0.4;
  }

  return score;
}
