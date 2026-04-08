import type { ResearchQuery } from "@artbot/shared-types";
import type { SourceCandidate } from "@artbot/source-adapters";

export interface DiscoveryConfig {
  enabled: boolean;
  maxCandidatesPerSource: number;
  maxQueryVariants: number;
  domainThrottlePerSource: number;
}

const TURKEY_DOMAIN_HINTS = [
  ".tr",
  "muzayede",
  "portakal",
  "clar",
  "bayrak",
  "turel",
  "antikasa",
  "artam",
  "alifart"
];

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function buildDiscoveryConfigFromEnv(): DiscoveryConfig {
  const maxCandidatesPerSource = Number(process.env.DISCOVERY_MAX_CANDIDATES_PER_SOURCE ?? 24);
  const maxQueryVariants = Number(process.env.DISCOVERY_MAX_VARIANTS ?? 3);
  const domainThrottlePerSource = Number(process.env.DISCOVERY_DOMAIN_THROTTLE_PER_SOURCE ?? 6);

  return {
    enabled: process.env.DISCOVERY_ENABLED !== "false",
    maxCandidatesPerSource: Number.isFinite(maxCandidatesPerSource) ? Math.max(1, maxCandidatesPerSource) : 24,
    maxQueryVariants: Number.isFinite(maxQueryVariants) ? Math.max(1, maxQueryVariants) : 3,
    domainThrottlePerSource: Number.isFinite(domainThrottlePerSource)
      ? Math.max(1, domainThrottlePerSource)
      : 6
  };
}

export function buildQueryVariants(query: ResearchQuery, maxVariants: number): string[] {
  const variants = unique(
    [
      [query.artist, query.title].filter(Boolean).join(" ").trim(),
      [query.artist, query.title, "tablo"].filter(Boolean).join(" ").trim(),
      [query.artist, query.title, "müzayede"].filter(Boolean).join(" ").trim(),
      [query.artist, query.title, "painting"].filter(Boolean).join(" ").trim(),
      [query.artist, query.title, "auction"].filter(Boolean).join(" ").trim()
    ].filter(Boolean)
  );

  return variants.slice(0, maxVariants);
}

function withVariant(url: string, variant: string): string | null {
  try {
    const parsed = new URL(url);
    const keys = ["q", "query", "term", "entry", "s", "search"];
    const key = keys.find((k) => parsed.searchParams.has(k));
    if (!key) {
      return null;
    }
    parsed.searchParams.set(key, variant);
    return parsed.toString();
  } catch {
    return null;
  }
}

function applyDomainThrottle(candidates: SourceCandidate[], maxPerDomain: number): SourceCandidate[] {
  const perDomain = new Map<string, number>();
  const accepted: SourceCandidate[] = [];

  for (const candidate of candidates) {
    let host = "unknown";
    try {
      host = new URL(candidate.url).hostname.toLowerCase();
    } catch {
      host = "unknown";
    }

    const count = perDomain.get(host) ?? 0;
    if (count >= maxPerDomain) {
      continue;
    }

    perDomain.set(host, count + 1);
    accepted.push(candidate);
  }

  return accepted;
}

function scoreWithTurkeyPriority(candidate: SourceCandidate, query: ResearchQuery): number {
  if (!query.turkeyFirst) {
    return candidate.score;
  }

  try {
    const host = new URL(candidate.url).hostname.toLowerCase();
    const isTurkeyLike = TURKEY_DOMAIN_HINTS.some((hint) => host.includes(hint));
    const boosted = isTurkeyLike ? candidate.score + 0.09 : candidate.score - 0.03;
    return Math.max(0, Math.min(1, boosted));
  } catch {
    return candidate.score;
  }
}

export function expandCandidatesLight(
  seeds: SourceCandidate[],
  query: ResearchQuery,
  config: DiscoveryConfig
): SourceCandidate[] {
  if (!config.enabled) {
    return seeds.slice(0, config.maxCandidatesPerSource);
  }

  const variants = buildQueryVariants(query, config.maxQueryVariants);
  const expanded: SourceCandidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: SourceCandidate): void => {
    if (!candidate.url || seen.has(candidate.url)) {
      return;
    }
    seen.add(candidate.url);
    expanded.push(candidate);
  };

  for (const seed of seeds) {
    push(seed);

    for (const variant of variants) {
      const variantUrl = withVariant(seed.url, variant);
      if (!variantUrl || variantUrl === seed.url) {
        continue;
      }
      push({
        ...seed,
        url: variantUrl,
        provenance: "query_variant",
        score: Math.max(0.4, seed.score - 0.22),
        discoveredFromUrl: seed.url
      });
    }
  }

  const throttled = applyDomainThrottle(expanded, config.domainThrottlePerSource);
  const rescored = throttled.map((candidate) => ({
    ...candidate,
    score: scoreWithTurkeyPriority(candidate, query)
  }));
  return rescored
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxCandidatesPerSource);
}
