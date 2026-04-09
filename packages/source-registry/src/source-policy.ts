import type { ResearchQuery } from "@artbot/shared-types";
import type { SourceAdapter } from "@artbot/source-adapters";

export type SourcePolicyClass = "public_archive" | "public_auth_mixed" | "licensed_only" | "probe";

export interface SourcePolicyDecision {
  allowed: boolean;
  policyClass: SourcePolicyClass;
  reason: string;
}

const explicitPolicyByAdapterId: Record<string, SourcePolicyClass> = {
  "muzayedeapp-platform": "public_auth_mixed",
  "bayrak-muzayede-listing": "public_auth_mixed",
  "bayrak-muzayede-lot": "public_auth_mixed",
  "turel-art-listing": "public_archive",
  "antikasa-lot-adapter": "public_archive",
  "portakal-catalog": "public_archive",
  "clar-buy-now": "public_archive",
  "clar-archive": "public_archive",
  "artam-auction-records": "public_archive",
  "artam-lot": "public_archive",
  "alifart-lot": "public_archive",
  "sanatfiyat-licensed-extractor": "licensed_only",
  "invaluable-listing": "probe",
  "mutualart-probe": "probe",
  "askart-probe": "probe",
  "artsy-probe": "probe"
};

function inferPolicyClass(adapter: SourceAdapter): SourcePolicyClass {
  const explicit = explicitPolicyByAdapterId[adapter.id];
  if (explicit) return explicit;
  if (adapter.requiresLicense) return "licensed_only";
  if (adapter.requiresAuth) return "public_auth_mixed";
  return "public_archive";
}

export function evaluateSourcePolicy(adapter: SourceAdapter, query: ResearchQuery): SourcePolicyDecision {
  const policyClass = inferPolicyClass(adapter);

  if (policyClass === "probe" && process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS !== "true") {
    return {
      allowed: false,
      policyClass,
      reason: "Disabled by source policy (probe adapters are opt-in via ENABLE_OPTIONAL_PROBE_ADAPTERS=true)."
    };
  }

  if (policyClass === "licensed_only") {
    if (!query.allowLicensed) {
      return {
        allowed: false,
        policyClass,
        reason: "Disabled by source policy (licensed source requires --allow-licensed)."
      };
    }

    if (!query.licensedIntegrations.includes(adapter.sourceName)) {
      return {
        allowed: false,
        policyClass,
        reason: `Disabled by source policy (licensed integration "${adapter.sourceName}" not explicitly allowed).`
      };
    }
  }

  return {
    allowed: true,
    policyClass,
    reason: `Allowed by source policy (${policyClass}).`
  };
}

