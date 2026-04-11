import { AuthManager } from "@artbot/auth-manager";
import type { AccessContext, ResearchQuery } from "@artbot/shared-types";
import { GenericSourceAdapter, type SourceAdapter, type SourceCandidate } from "@artbot/source-adapters";
import { buildDiscoveryConfigFromEnv, discoverWebCandidates, expandCandidatesLight } from "./discovery.js";
import { evaluateSourcePolicy } from "./source-policy.js";

export interface PlannedSource {
  adapter: SourceAdapter;
  accessContext: AccessContext;
  candidates: SourceCandidate[];
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isLikelyTurkeyHost(host: string): boolean {
  return host.endsWith(".tr") || host.includes("muzayede") || host.includes("sanat");
}

function buildDynamicAdapterForHost(host: string): SourceAdapter {
  return new GenericSourceAdapter({
    id: `dynamic-web-${host.replace(/[^a-z0-9]+/gi, "-")}`,
    sourceName: `Web Discovery (${host})`,
    venueName: host,
    venueType: "other",
    sourcePageType: "listing",
    tier: 4,
    country: isLikelyTurkeyHost(host) ? "Turkey" : null,
    city: null,
    baseUrl: `https://${host}`,
    searchPath: "/search?q="
  });
}

function isTurkeySource(adapter: SourceAdapter): boolean {
  return adapter.country?.toLowerCase() === "turkey";
}

function sortSources(query: ResearchQuery, adapters: SourceAdapter[]): SourceAdapter[] {
  const filtered =
    query.scope === "turkey_only" ? adapters.filter((adapter) => isTurkeySource(adapter)) : [...adapters];

  if (!query.turkeyFirst) {
    return filtered;
  }

  return filtered.sort((a, b) => {
    const aTurkey = isTurkeySource(a) ? 0 : 1;
    const bTurkey = isTurkeySource(b) ? 0 : 1;
    if (aTurkey !== bTurkey) return aTurkey - bTurkey;
    return a.tier - b.tier;
  });
}

export async function planSources(
  query: ResearchQuery,
  adapters: SourceAdapter[],
  authManager: AuthManager
): Promise<PlannedSource[]> {
  const discoveryConfig = buildDiscoveryConfigFromEnv(query.analysisMode);
  const sorted = sortSources(query, adapters);
  const planned: PlannedSource[] = [];

  for (const adapter of sorted) {
    const sourcePolicyDecision = evaluateSourcePolicy(adapter, query);
    const accessContext = authManager.resolveAccess({
      sourceName: adapter.sourceName,
      sourceUrl: adapter.id,
      sourceRequiresAuth: adapter.requiresAuth,
      sourceRequiresLicense: adapter.requiresLicense,
      requestedProfileId: query.authProfileId,
      allowLicensed: query.allowLicensed,
      manualLoginCheckpoint: query.manualLoginCheckpoint,
      cookieFile: query.cookieFile,
      licensedIntegrations: query.licensedIntegrations
    });

    if (!sourcePolicyDecision.allowed) {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source policy blocked this adapter.";
      accessContext.blockerReason = sourcePolicyDecision.reason;
    }

    if (!adapter.supportedAccessModes.includes(accessContext.mode) && accessContext.sourceAccessStatus !== "blocked") {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source does not support selected access mode.";
      accessContext.blockerReason = `Access mode ${accessContext.mode} is unsupported for adapter ${adapter.id}.`;
    }

    const rawCandidates = await adapter.discoverCandidates(query);
    const normalizedSeeds: SourceCandidate[] = rawCandidates.map((candidate) => ({
      ...candidate,
      provenance: candidate.provenance ?? "seed",
      score: candidate.score ?? 0.8,
      discoveredFromUrl: candidate.discoveredFromUrl ?? null
    }));

    const candidates = expandCandidatesLight(normalizedSeeds, query, discoveryConfig);
    planned.push({ adapter, accessContext, candidates });
  }

  const webCandidates = await discoverWebCandidates(query, discoveryConfig);
  if (webCandidates.length === 0) {
    return planned;
  }

  const hostToPlanned = new Map<string, PlannedSource>();
  for (const source of planned) {
    for (const candidate of source.candidates) {
      const host = hostFromUrl(candidate.url);
      if (host && !hostToPlanned.has(host)) {
        hostToPlanned.set(host, source);
      }
    }
  }

  const dynamicByHost = new Map<string, SourceCandidate[]>();
  for (const candidate of webCandidates) {
    const host = hostFromUrl(candidate.url);
    if (!host) continue;

    const existingSource = hostToPlanned.get(host);
    if (existingSource) {
      if (existingSource.candidates.some((existing) => existing.url === candidate.url)) {
        continue;
      }
      if (existingSource.candidates.length >= discoveryConfig.maxCandidatesPerSource) {
        continue;
      }
      existingSource.candidates.push(candidate);
      continue;
    }

    if (query.scope === "turkey_only" && !isLikelyTurkeyHost(host)) {
      continue;
    }

    const list = dynamicByHost.get(host) ?? [];
    if (list.some((existing) => existing.url === candidate.url)) {
      continue;
    }
    list.push(candidate);
    dynamicByHost.set(host, list);
  }

  for (const [host, candidates] of dynamicByHost) {
    const adapter = buildDynamicAdapterForHost(host);
    const sourcePolicyDecision = evaluateSourcePolicy(adapter, query);
    const accessContext = authManager.resolveAccess({
      sourceName: adapter.sourceName,
      sourceUrl: `https://${host}`,
      sourceRequiresAuth: adapter.requiresAuth,
      sourceRequiresLicense: adapter.requiresLicense,
      requestedProfileId: query.authProfileId,
      allowLicensed: query.allowLicensed,
      manualLoginCheckpoint: query.manualLoginCheckpoint,
      cookieFile: query.cookieFile,
      licensedIntegrations: query.licensedIntegrations
    });

    if (!sourcePolicyDecision.allowed) {
      accessContext.sourceAccessStatus = "blocked";
      accessContext.accessReason = "Source policy blocked this dynamic adapter.";
      accessContext.blockerReason = sourcePolicyDecision.reason;
    }

    planned.push({
      adapter,
      accessContext,
      candidates: candidates.slice(0, discoveryConfig.maxUrlsPerDiscoveredDomain)
    });
  }

  const totalCandidates = planned.reduce((sum, source) => sum + source.candidates.length, 0);
  if (totalCandidates > discoveryConfig.maxTotalCandidatesPerRun) {
    for (const source of planned) {
      source.candidates.sort((a, b) => b.score - a.score);
    }
    const trimmed = planned.map((source) => ({
      ...source,
      candidates: [] as SourceCandidate[]
    }));
    let remainingBudget = discoveryConfig.maxTotalCandidatesPerRun;
    let cursor = 0;
    while (remainingBudget > 0) {
      const source = planned[cursor % planned.length];
      const slot = trimmed[cursor % trimmed.length];
      const nextCandidate = source.candidates.shift();
      if (nextCandidate) {
        slot.candidates.push(nextCandidate);
        remainingBudget -= 1;
      }
      cursor += 1;
      if (planned.every((entry) => entry.candidates.length === 0)) {
        break;
      }
    }
    return trimmed.filter((source) => source.candidates.length > 0);
  }

  return planned;
}
