import type { ResearchQuery, SourceLegalPosture } from "@artbot/shared-types";
import type { SourceAdapter } from "@artbot/source-adapters";

export type SourcePolicyClass = "public_archive" | "public_auth_mixed" | "licensed_only" | "probe";

export interface SourcePolicyDecision {
  allowed: boolean;
  policyClass: SourcePolicyClass;
  legalPosture: SourceLegalPosture;
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
  "invaluable-lot-detail-adapter": "public_archive",
  "liveauctioneers-public-lot-adapter": "public_archive",
  "sanatfiyat-licensed-extractor": "licensed_only",
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

function legalPostureForPolicyClass(policyClass: SourcePolicyClass): SourceLegalPosture {
  switch (policyClass) {
    case "public_archive":
      return "public_permitted";
    case "public_auth_mixed":
      return "public_contract_sensitive";
    case "licensed_only":
      return "licensed_only";
    case "probe":
      return "operator_assisted_only";
  }
}

export function evaluateSourcePolicy(adapter: SourceAdapter, query: ResearchQuery): SourcePolicyDecision {
  const customLegalPosture = (adapter as SourceAdapter & { customLegalPosture?: SourceLegalPosture }).customLegalPosture;
  const policyClass = inferPolicyClass(adapter);
  const legalPosture = customLegalPosture ?? legalPostureForPolicyClass(policyClass);

  if (policyClass === "probe" && process.env.ENABLE_OPTIONAL_PROBE_ADAPTERS !== "true") {
    return {
      allowed: false,
      policyClass,
      legalPosture,
      reason: "Disabled by source policy (probe adapters are opt-in via ENABLE_OPTIONAL_PROBE_ADAPTERS=true)."
    };
  }

  if (policyClass === "licensed_only") {
    if (!query.allowLicensed) {
      return {
        allowed: false,
        policyClass,
        legalPosture,
        reason: "Disabled by source policy (licensed source requires --allow-licensed)."
      };
    }

    if (!query.licensedIntegrations.includes(adapter.sourceName)) {
      return {
        allowed: false,
        policyClass,
        legalPosture,
        reason: `Disabled by source policy (licensed integration "${adapter.sourceName}" not explicitly allowed).`
      };
    }
  }

  return {
    allowed: true,
    policyClass,
    legalPosture,
    reason: `Allowed by source policy (${policyClass}).`
  };
}
