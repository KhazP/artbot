import type { PriceType } from "@artbot/shared-types";

export interface GenericParsedFields {
  title: string | null;
  lotNumber: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  priceAmount: number | null;
  priceType: PriceType;
  currency: string | null;
  saleDate: string | null;
  priceHidden: boolean;
  buyersPremiumIncluded: boolean | null;
}

function normalizeNumber(input: string): number | null {
  const cleaned = input.replace(/[^0-9,.\-]/g, "").trim();

  if (!cleaned) {
    return null;
  }

  const commaCount = (cleaned.match(/,/g) ?? []).length;
  const dotCount = (cleaned.match(/\./g) ?? []).length;
  const hasComma = commaCount > 0;
  const hasDot = dotCount > 0;

  let normalized = cleaned;

  if (hasComma && hasDot) {
    const decimalIsComma = cleaned.lastIndexOf(",") > cleaned.lastIndexOf(".");
    normalized = decimalIsComma
      ? cleaned.replace(/\./g, "").replace(/,/g, ".")
      : cleaned.replace(/,/g, "");
  } else if (hasComma) {
    if (commaCount > 1) {
      normalized = cleaned.replace(/,/g, "");
    } else {
      const [integer, fraction = ""] = cleaned.split(",");
      normalized = fraction.length === 3 ? `${integer}${fraction}` : `${integer}.${fraction}`;
    }
  } else if (hasDot) {
    if (dotCount > 1) {
      normalized = cleaned.replace(/\./g, "");
    } else {
      const [integer, fraction = ""] = cleaned.split(".");
      normalized = fraction.length === 3 ? `${integer}${fraction}` : cleaned;
    }
  }

  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function inferCurrency(text: string): string | null {
  if (/\bTRY\b|\bTL\b|₺/i.test(text)) return "TRY";
  if (/\bUSD\b|\$/i.test(text)) return "USD";
  if (/\bEUR\b|€/i.test(text)) return "EUR";
  if (/\bGBP\b|£/i.test(text)) return "GBP";
  return null;
}

export function parseGenericLotFields(content: string): GenericParsedFields {
  const text = content.replace(/\s+/g, " ").trim();
  const currency = inferCurrency(text);

  const lotMatch = text.match(/(?:lot|lot no|lot nr|lot#)\s*[:#]?\s*([a-z0-9-]+)/i);
  const estMatch = text.match(
    /(?:estimate|estimated|estimate range|tahmini|ekspertiz)\s*[:\-]?\s*([\d.,\s₺$€A-Za-z]+)\s*(?:-|to|–|—)\s*([\d.,\s₺$€A-Za-z]+)/i
  );
  const realizedMatch = text.match(
    /(?:realized|sold for|satış fiyatı|satildi|satıldı|çekiç|cekic|hammer)\s*[:\-]?\s*([\d.,\s₺$€A-Za-z]+)/i
  );
  const premiumMatch = text.match(
    /(?:buyers?\s*premium|buyer's premium|alıcı primi|alici primi)\s*(?:included|dahil|hariç|haric)?/i
  );
  const askMatch = text.match(
    /(?:asking price|buy now|hemen al|price|fiyat)\s*[:\-]?\s*([\d.,\s₺$€A-Za-z]+)/i
  );

  const inquiryOnly = /price on request|inquire|iletişime geçiniz|fiyat sorunuz/i.test(text);

  let priceType: PriceType = "unknown";
  let priceAmount: number | null = null;
  let estimateLow: number | null = null;
  let estimateHigh: number | null = null;
  let buyersPremiumIncluded: boolean | null = null;

  if (estMatch) {
    priceType = "estimate";
    estimateLow = normalizeNumber(estMatch[1]);
    estimateHigh = normalizeNumber(estMatch[2]);
  }

  if (realizedMatch) {
    priceAmount = normalizeNumber(realizedMatch[1]);
    const lowerText = text.toLowerCase();
    if (/hammer|çekiç|cekic/.test(lowerText)) {
      priceType = "hammer_price";
    } else if (
      /buyers?\s*premium|buyer's premium|alıcı primi|alici primi/.test(lowerText) &&
      /(included|dahil)/.test(lowerText)
    ) {
      priceType = "realized_with_buyers_premium";
      buyersPremiumIncluded = true;
    } else {
      priceType = "realized_price";
    }
  } else if (askMatch && !inquiryOnly) {
    priceType = "asking_price";
    priceAmount = normalizeNumber(askMatch[1]);
  }

  if (premiumMatch && buyersPremiumIncluded === null) {
    const premiumText = premiumMatch[0].toLowerCase();
    if (premiumText.includes("hariç") || premiumText.includes("haric")) {
      buyersPremiumIncluded = false;
    } else if (premiumText.includes("included") || premiumText.includes("dahil")) {
      buyersPremiumIncluded = true;
    }
  }

  if (inquiryOnly) {
    priceType = "inquiry_only";
    priceAmount = null;
  }

  const saleDateMatch = text.match(/(\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2})/);

  return {
    title: null,
    lotNumber: lotMatch ? lotMatch[1] : null,
    estimateLow,
    estimateHigh,
    priceAmount,
    priceType,
    currency,
    saleDate: saleDateMatch ? saleDateMatch[1] : null,
    priceHidden: inquiryOnly,
    buyersPremiumIncluded
  };
}
