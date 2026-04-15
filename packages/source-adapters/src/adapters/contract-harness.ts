import { parseGenericLotFields } from "@artbot/extraction";
import type { SourceAccessStatus, SourcePageType } from "@artbot/shared-types";
import { evaluateAcceptance } from "./custom-adapter-utils.js";
import { parseFixtureSourceSpecificPatch } from "./specialized-adapters.js";

export interface FixtureContractInput {
  sourceName: string;
  sourcePageType: SourcePageType;
  html: string;
  url: string;
}

export function evaluateFixtureContract(input: FixtureContractInput, sourceStatus: SourceAccessStatus = "public_access") {
  const parsed = parseGenericLotFields(input.html, input.url);
  const patch = parseFixtureSourceSpecificPatch(input.sourceName, input.html);
  const merged =
    patch && (
      parsed.priceType === "unknown"
      || parsed.priceHidden !== patch.priceHidden
      || parsed.priceAmount == null
      || parsed.estimateLow == null
      || parsed.estimateHigh == null
    )
      ? {
          ...parsed,
          title: parsed.title ?? patch.title,
          artistName: parsed.artistName ?? patch.artistName,
          medium: parsed.medium ?? patch.medium,
          dimensionsText: parsed.dimensionsText ?? patch.dimensionsText,
          year: parsed.year ?? patch.year,
          imageUrl: parsed.imageUrl ?? patch.imageUrl,
          lotNumber: parsed.lotNumber ?? patch.lotNumber,
          estimateLow: parsed.estimateLow ?? patch.estimateLow,
          estimateHigh: parsed.estimateHigh ?? patch.estimateHigh,
          priceAmount: parsed.priceAmount ?? patch.priceAmount,
          priceType: parsed.priceType === "unknown" ? patch.priceType : parsed.priceType,
          currency: parsed.currency ?? patch.currency,
          saleDate: parsed.saleDate ?? patch.saleDate,
          priceHidden: parsed.priceHidden || patch.priceHidden,
          buyersPremiumIncluded: parsed.buyersPremiumIncluded ?? patch.buyersPremiumIncluded
        }
      : parsed;
  const effectiveSourceStatus = merged.priceHidden ? "price_hidden" : sourceStatus;
  const acceptance = evaluateAcceptance(merged, effectiveSourceStatus, {
    sourceName: input.sourceName,
    sourcePageType: input.sourcePageType
  });

  return {
    parsed: merged,
    acceptance,
    effectiveSourceStatus
  };
}
