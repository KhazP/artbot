import type { CanonicalCurrency } from "@artbot/shared-types";

interface TurkishLiraInput {
  amount: number | null;
  rawCurrency: string | null;
  rawText?: string | null;
  eventDate: string | null;
}

export interface TurkishLiraResolution {
  canonicalCurrency: CanonicalCurrency;
  canonicalAmount: number | null;
  confidence: number;
  redenominationApplied: boolean;
  redenominationFactor: number | null;
  notes: string[];
  warnings: string[];
  reasons: string[];
}

const REDENOMINATION_FACTOR = 1 / 1_000_000;

function extractYear(eventDate: string | null): number | null {
  if (!eventDate) return null;
  const match = eventDate.match(/^(\d{4})/);
  if (!match) return null;
  const value = Number(match[1]);
  return Number.isFinite(value) ? value : null;
}

function normalizeCurrencyToken(rawCurrency: string | null): string | null {
  if (!rawCurrency) return null;
  const normalized = rawCurrency.trim().toUpperCase();
  if (!normalized) return null;
  if (normalized === "₺") return "TL";
  return normalized;
}

function hasOldLiraTextSignal(rawText: string | null | undefined): boolean {
  if (!rawText) return false;
  return /\bTRL\b|milyon\s*tl|milyar\s*tl|türk\s*lirası/i.test(rawText);
}

export function resolveTurkishLiraEra(input: TurkishLiraInput): TurkishLiraResolution {
  const token = normalizeCurrencyToken(input.rawCurrency);
  const year = extractYear(input.eventDate);
  const notes: string[] = [];
  const warnings: string[] = [];
  const reasons: string[] = [];

  if (token === "USD" || token === "EUR" || token === "GBP") {
    return {
      canonicalCurrency: token,
      canonicalAmount: input.amount,
      confidence: 1,
      redenominationApplied: false,
      redenominationFactor: null,
      notes,
      warnings,
      reasons: ["Non-TRY currency does not require Turkish lira era resolution."]
    };
  }

  if (token === "YTL") {
    return {
      canonicalCurrency: "TRY_NEW",
      canonicalAmount: input.amount,
      confidence: 0.99,
      redenominationApplied: false,
      redenominationFactor: null,
      notes: ["Interpreted YTL as post-redenomination Turkish lira."],
      warnings,
      reasons: ["YTL explicitly names the new Turkish lira period."]
    };
  }

  if (token === "TRY") {
    return {
      canonicalCurrency: "TRY_NEW",
      canonicalAmount: input.amount,
      confidence: 0.98,
      redenominationApplied: false,
      redenominationFactor: null,
      notes,
      warnings,
      reasons: ["TRY already identifies the post-redenomination currency code."]
    };
  }

  if (token === "TRL" || hasOldLiraTextSignal(input.rawText)) {
    const canonicalAmount =
      typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount * REDENOMINATION_FACTOR : null;
    return {
      canonicalCurrency: "TRL_OLD",
      canonicalAmount,
      confidence: 0.99,
      redenominationApplied: canonicalAmount !== null,
      redenominationFactor: REDENOMINATION_FACTOR,
      notes: canonicalAmount !== null ? ["Applied the 1,000,000-to-1 Turkish lira redenomination."] : [],
      warnings,
      reasons: ["TRL or old-lira text signals explicitly indicate pre-2005 Turkish lira."]
    };
  }

  if (token === "TL") {
    if (year !== null && year < 2005) {
      const canonicalAmount =
        typeof input.amount === "number" && Number.isFinite(input.amount) ? input.amount * REDENOMINATION_FACTOR : null;
      warnings.push("Plain TL before 2005 is ambiguous; defaulted to old Turkish lira.");
      return {
        canonicalCurrency: "TRL_OLD",
        canonicalAmount,
        confidence: 0.64,
        redenominationApplied: canonicalAmount !== null,
        redenominationFactor: REDENOMINATION_FACTOR,
        notes: canonicalAmount !== null ? ["Applied the 1,000,000-to-1 Turkish lira redenomination."] : [],
        warnings,
        reasons: ["Plain TL dated before 2005 usually refers to the old Turkish lira."]
      };
    }

    if (year !== null && year >= 2005 && year <= 2008) {
      warnings.push("Plain TL during the 2005-2008 transition window is ambiguous; review manually if material.");
      return {
        canonicalCurrency: "TRY_NEW",
        canonicalAmount: input.amount,
        confidence: 0.6,
        redenominationApplied: false,
        redenominationFactor: null,
        notes: ["Assumed post-redenomination Turkish lira for transition-window plain TL."],
        warnings,
        reasons: ["Plain TL in the transition window is usually new lira but can be ambiguous."]
      };
    }

    return {
      canonicalCurrency: "TRY_NEW",
      canonicalAmount: input.amount,
      confidence: year === null ? 0.7 : 0.9,
      redenominationApplied: false,
      redenominationFactor: null,
      notes: year === null ? ["Assumed modern Turkish lira because no event date was available."] : [],
      warnings: year === null ? ["Plain TL without an event date is ambiguous."] : warnings,
      reasons: [
        year === null
          ? "Plain TL without an event date defaults to modern Turkish lira with reduced confidence."
          : "Plain TL after the transition window is treated as modern Turkish lira."
      ]
    };
  }

  return {
    canonicalCurrency: "UNKNOWN",
    canonicalAmount: input.amount,
    confidence: 0.2,
    redenominationApplied: false,
    redenominationFactor: null,
    notes,
    warnings: ["Currency could not be canonicalized for normalization."],
    reasons: ["No supported currency token was available."]
  };
}
