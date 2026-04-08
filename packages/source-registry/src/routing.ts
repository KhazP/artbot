import { AuthManager } from "@artbot/auth-manager";
import type { AccessContext, ResearchQuery } from "@artbot/shared-types";
import type { SourceAdapter, SourceCandidate } from "@artbot/source-adapters";
import { buildDiscoveryConfigFromEnv, expandCandidatesLight } from "./discovery.js";

export interface PlannedSource {
  adapter: SourceAdapter;
  accessContext: AccessContext;
  candidates: SourceCandidate[];
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
  const discoveryConfig = buildDiscoveryConfigFromEnv();
  const sorted = sortSources(query, adapters);
  const planned: PlannedSource[] = [];

  for (const adapter of sorted) {
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

    if (!adapter.supportedAccessModes.includes(accessContext.mode)) {
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

  return planned;
}
