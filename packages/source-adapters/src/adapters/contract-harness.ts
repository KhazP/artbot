import { parseGenericLotFields } from "@artbot/extraction";
import type { SourceAccessStatus, SourcePageType } from "@artbot/shared-types";
import { evaluateAcceptance } from "./custom-adapter-utils.js";

export interface FixtureContractInput {
  sourceName: string;
  sourcePageType: SourcePageType;
  html: string;
  url: string;
}

export function evaluateFixtureContract(input: FixtureContractInput, sourceStatus: SourceAccessStatus = "public_access") {
  const parsed = parseGenericLotFields(input.html, input.url);
  const effectiveSourceStatus = parsed.priceHidden ? "price_hidden" : sourceStatus;
  const acceptance = evaluateAcceptance(parsed, effectiveSourceStatus, {
    sourceName: input.sourceName,
    sourcePageType: input.sourcePageType
  });

  return {
    parsed,
    acceptance,
    effectiveSourceStatus
  };
}
