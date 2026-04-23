import type { CanonicalCurrency } from "@artbot/shared-types";

export interface FxSnapshot {
  try: number | null;
  usd: number | null;
  eur: number | null;
}

function toFxCurrency(currency: CanonicalCurrency): "TRY" | "USD" | "EUR" | "GBP" | null {
  if (currency === "TRY_NEW" || currency === "TRL_OLD") return "TRY";
  if (currency === "USD" || currency === "EUR" || currency === "GBP") return currency;
  return null;
}

function toEur(amount: number, currency: "TRY" | "USD" | "EUR" | "GBP", rates: Record<string, number>): number | null {
  if (currency === "EUR") return amount;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return amount / rate;
}

function fromEur(amountEur: number, currency: "TRY" | "USD" | "EUR", rates: Record<string, number>): number | null {
  if (currency === "EUR") return amountEur;
  const rate = rates[currency];
  if (!rate || !Number.isFinite(rate) || rate <= 0) return null;
  return amountEur * rate;
}

export function convertCanonicalAmount(
  amount: number | null,
  currency: CanonicalCurrency,
  rates: Record<string, number>
): FxSnapshot {
  const fxCurrency = toFxCurrency(currency);
  if (amount === null || !fxCurrency) {
    return {
      try: null,
      usd: null,
      eur: null
    };
  }

  const amountEur = toEur(amount, fxCurrency, rates);
  if (amountEur === null) {
    return {
      try: null,
      usd: null,
      eur: null
    };
  }

  return {
    try: fromEur(amountEur, "TRY", rates),
    usd: fromEur(amountEur, "USD", rates),
    eur: amountEur
  };
}
