import { load } from "cheerio";
import type { PriceType } from "@artbot/shared-types";

export interface GenericParsedFields {
  title: string | null;
  artistName: string | null;
  medium: string | null;
  dimensionsText: string | null;
  year: string | null;
  imageUrl: string | null;
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

interface JsonLdFields {
  title: string | null;
  artistName: string | null;
  medium: string | null;
  dimensionsText: string | null;
  year: string | null;
  lotNumber: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  priceAmount: number | null;
  priceType: PriceType;
  currency: string | null;
  saleDate: string | null;
}

interface ScriptPayloadFields {
  title: string | null;
  artistName: string | null;
  medium: string | null;
  year: string | null;
  lotNumber: string | null;
  estimateLow: number | null;
  estimateHigh: number | null;
  priceAmount: number | null;
  priceType: PriceType;
  currency: string | null;
  saleDate: string | null;
  priceHidden: boolean;
}

interface CurrencyAmountMatch {
  amount: number;
  currency: string;
  index: number;
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

function containsInquiryOnlyIndicators(text: string): boolean {
  return /price on request|inquire|iletişime geçiniz|fiyat sorunuz|fiyat istek üzerine verilir|daha fazla bilgi için lütfen bize ulaşın/i.test(
    text
  );
}

function normalizeCurrencyToken(token: string | null): string | null {
  if (!token) return null;
  const normalized = token.trim().toUpperCase();
  if (normalized === "TL" || normalized === "TRY") return "TRY";
  if (normalized === "US$" || normalized === "$" || normalized === "USD") return "USD";
  if (normalized === "€" || normalized === "EUR") return "EUR";
  if (normalized === "£" || normalized === "GBP") return "GBP";
  return /^[A-Z]{3}$/.test(normalized) ? normalized : inferCurrency(normalized);
}

function extractCurrencyAmounts(text: string): CurrencyAmountMatch[] {
  const matches: CurrencyAmountMatch[] = [];
  const patternBefore =
    /(TRY|TL|USD|EUR|GBP|₺|\$|€|£)\s*([0-9]{1,3}(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)/gi;
  const patternAfter =
    /([0-9]{1,3}(?:[.,\s][0-9]{3})*(?:[.,][0-9]{1,2})?|[0-9]+(?:[.,][0-9]{1,2})?)\s*(TRY|TL|USD|EUR|GBP|₺|\$|€|£)/gi;

  for (const pattern of [patternBefore, patternAfter]) {
    let match: RegExpExecArray | null;
    while ((match = pattern.exec(text)) !== null) {
      const currencyToken = normalizeCurrencyToken(pattern === patternBefore ? match[1] : match[2]);
      const amountToken = pattern === patternBefore ? match[2] : match[1];
      const amount = normalizeNumber(amountToken);
      if (!currencyToken || amount === null || amount <= 0) {
        continue;
      }
      matches.push({
        amount,
        currency: currencyToken,
        index: match.index
      });
    }
  }

  const deduped = new Map<string, CurrencyAmountMatch>();
  for (const entry of matches) {
    const key = `${entry.currency}:${entry.amount}:${entry.index}`;
    if (!deduped.has(key)) {
      deduped.set(key, entry);
    }
  }

  return [...deduped.values()].sort((a, b) => a.index - b.index);
}

function sanitizeTitle(value: string | null | undefined): string | null {
  if (!value) return null;
  const cleaned = value
    .replace(/\s+/g, " ")
    .replace(/\s*[\-|–|—]\s*(auction|m[üu]zayede|lot|catalog|results?).*$/i, "")
    .trim();

  if (!cleaned || cleaned.length < 3) {
    return null;
  }

  return cleaned;
}

function isGenericTitle(value: string | null | undefined): boolean {
  const normalized = sanitizeTitle(value)?.toLowerCase() ?? "";
  if (!normalized) {
    return false;
  }

  return [
    /\bkatalog\b/i,
    /\blisting\b/i,
    /\blot detail\b/i,
    /\bsonu[cç]\b/i,
    /\barchive\b/i,
    /\bar[şs]iv\b/i,
    /\bhemen al\b/i,
    /^portakal\b/i,
    /^bayrak m[üu]zayede\b/i,
    /^sanatfiyat\b/i,
    /^invaluable\b/i,
    /^liveauctioneers\b/i,
    /^muzayede app\b/i,
    /^clar\b/i
  ].some((pattern) => pattern.test(normalized));
}

function extractTitle(content: string): string | null {
  if (/<[a-z][\s\S]*>/i.test(content)) {
    const $ = load(content);
    const candidates = [
      $("meta[property='og:title']").attr("content"),
      $("meta[name='twitter:title']").attr("content"),
      $("h1").first().text(),
      $("h2").first().text(),
      $("title").first().text()
    ];
    let genericFallback: string | null = null;
    for (const candidate of candidates) {
      const title = sanitizeTitle(candidate);
      if (title) {
        if (!isGenericTitle(title)) {
          return title;
        }
        genericFallback ??= title;
      }
    }
    return genericFallback;
  }

  const textTitle = content.match(/(?:title|eser adı|work title)\s*[:\-]\s*([^\n|]{3,150})/i)?.[1];
  return sanitizeTitle(textTitle);
}

function normalizeImageUrl(rawUrl: string | undefined, baseUrl?: string): string | null {
  if (!rawUrl) return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;

  try {
    if (trimmed.startsWith("//")) {
      return new URL(`https:${trimmed}`).toString();
    }
    if (baseUrl) {
      return new URL(trimmed, baseUrl).toString();
    }
    const parsed = new URL(trimmed);
    return parsed.toString();
  } catch {
    return null;
  }
}

function extractImageUrl(content: string, baseUrl?: string): string | null {
  if (!/<[a-z][\s\S]*>/i.test(content)) {
    return null;
  }

  const $ = load(content);
  const candidates = [
    $("meta[property='og:image']").attr("content"),
    $("meta[name='twitter:image']").attr("content"),
    $("meta[property='og:image:url']").attr("content"),
    $("img[data-zoom-image]").first().attr("data-zoom-image"),
    $("img[data-src]").first().attr("data-src"),
    $("img[src]").first().attr("src")
  ];

  for (const candidate of candidates) {
    const normalized = normalizeImageUrl(candidate, baseUrl);
    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function extractJsonLdScripts(content: string): string[] {
  const scripts: string[] = [];
  const scriptRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let match: RegExpExecArray | null;
  while ((match = scriptRegex.exec(content)) !== null) {
    if (match[1]?.trim()) {
      scripts.push(match[1].trim());
    }
  }
  return scripts;
}

function firstString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") return normalizeNumber(value);
  if (value && typeof value === "object") {
    const objectValue = value as Record<string, unknown>;
    const nestedCandidates = [objectValue.value, objectValue.amount, objectValue.price];
    for (const nestedCandidate of nestedCandidates) {
      const nestedNumber = firstNumber(nestedCandidate);
      if (nestedNumber !== null) {
        return nestedNumber;
      }
    }
  }
  return null;
}

function collectValueByKeys(node: unknown, keys: string[]): unknown {
  if (!node || typeof node !== "object") {
    return null;
  }

  if (Array.isArray(node)) {
    for (const child of node) {
      const nested = collectValueByKeys(child, keys);
      if (nested !== null && nested !== undefined) {
        return nested;
      }
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  for (const key of keys) {
    if (obj[key] !== undefined && obj[key] !== null) {
      return obj[key];
    }
  }

  for (const child of Object.values(obj)) {
    const nested = collectValueByKeys(child, keys);
    if (nested !== null && nested !== undefined) {
      return nested;
    }
  }

  return null;
}

function parseJsonLd(content: string): JsonLdFields {
  const fallback: JsonLdFields = {
    title: null,
    artistName: null,
    medium: null,
    dimensionsText: null,
    year: null,
    lotNumber: null,
    estimateLow: null,
    estimateHigh: null,
    priceAmount: null,
    priceType: "unknown",
    currency: null,
    saleDate: null
  };
  let bestMetadataOnly: JsonLdFields | null = null;

  const scripts = extractJsonLdScripts(content);
  for (const script of scripts) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(script);
    } catch {
      continue;
    }

    const rawTitle = collectValueByKeys(parsed, ["name", "headline"]);
    const title = sanitizeTitle(firstString(rawTitle));
    const artistName = firstString(collectValueByKeys(parsed, ["artist", "creator", "author", "brand"]));
    const medium = firstString(collectValueByKeys(parsed, ["artMedium", "material", "medium"]));
    const dimensionsText = firstString(collectValueByKeys(parsed, ["size", "dimensions"]));
    const yearRaw = firstString(collectValueByKeys(parsed, ["dateCreated", "productionDate", "year"]));
    const year = yearRaw?.match(/\b((?:18|19|20)\d{2})\b/)?.[1] ?? null;
    const lotNumber = firstString(collectValueByKeys(parsed, ["lotNumber", "sku", "identifier"]));
    const currency = firstString(collectValueByKeys(parsed, ["priceCurrency", "currency"]));
    const priceAmount = firstNumber(collectValueByKeys(parsed, ["price", "highPrice", "lowPrice"]));
    const estimateLow = firstNumber(collectValueByKeys(parsed, ["estimateLow", "lowEstimate", "lowPrice"]));
    const estimateHigh = firstNumber(collectValueByKeys(parsed, ["estimateHigh", "highEstimate", "highPrice"]));
    const saleDate = firstString(collectValueByKeys(parsed, ["startDate", "endDate", "datePublished", "dateCreated"]));

    const snapshot = JSON.stringify(parsed).toLowerCase();
    let priceType: PriceType = "unknown";
    if (estimateLow !== null || estimateHigh !== null) {
      priceType = "estimate";
    } else if (priceAmount !== null) {
      if (/hammer|realized|sold|sat[ıi]ld[ıi]/i.test(snapshot)) {
        priceType = "realized_price";
      } else {
        priceType = "asking_price";
      }
    }

    const candidate: JsonLdFields = {
      title,
      artistName,
      medium,
      dimensionsText,
      year,
      lotNumber,
      estimateLow,
      estimateHigh,
      priceAmount,
      priceType,
      currency,
      saleDate
    };

    const hasAnyFields =
      title ||
      artistName ||
      medium ||
      dimensionsText ||
      year ||
      lotNumber ||
      currency ||
      priceAmount !== null ||
      estimateLow !== null ||
      estimateHigh !== null ||
      saleDate;

    if (!hasAnyFields) {
      continue;
    }

    if (priceAmount !== null || estimateLow !== null || estimateHigh !== null) {
      return candidate;
    }

    if (!bestMetadataOnly) {
      bestMetadataOnly = candidate;
    }
  }

  return bestMetadataOnly ?? fallback;
}

function matchFirst(scriptContent: string, patterns: RegExp[]): RegExpMatchArray | null {
  for (const pattern of patterns) {
    const match = scriptContent.match(pattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function captureMatchValue(match: RegExpMatchArray | null): string {
  if (!match) {
    return "";
  }
  return (match[1] ?? match[2] ?? "").trim();
}

function extractScriptPayloadFields(content: string): ScriptPayloadFields {
  const fallback: ScriptPayloadFields = {
    title: null,
    artistName: null,
    medium: null,
    year: null,
    lotNumber: null,
    estimateLow: null,
    estimateHigh: null,
    priceAmount: null,
    priceType: "unknown",
    currency: null,
    saleDate: null,
    priceHidden: false
  };

  const scripts = content.match(/<script\b[^>]*>([\s\S]*?)<\/script>/gi) ?? [];
  const scriptBlob = (scripts.length > 0
    ? scripts.map((script) => script.replace(/<script\b[^>]*>/i, "").replace(/<\/script>/i, "")).join("\n")
    : content)
    .replace(/\\u20ba/gi, "₺")
    .replace(/\\u20ac/gi, "€")
    .replace(/\\u00a3/gi, "£");

  if (scriptBlob.trim().length === 0) {
    return fallback;
  }

  const lotNumber =
    matchFirst(scriptBlob, [
      /"(?:lotno|lotNo|lotNO)"\s*:\s*"([^"]{1,32})"/i,
      /'(?:lotno|lotNo|lotNO)'\s*:\s*'([^']{1,32})'/i,
      /"(?:lotNumber|lotNo|lot_no|lot_number|lotId)"\s*:\s*"([^"]{1,32})"/i,
      /'(?:lotNumber|lotNo|lot_no|lot_number|lotId)'\s*:\s*'([^']{1,32})'/i
    ])?.[1] ?? null;
  const estimateLowPrimary = matchFirst(scriptBlob, [
    /"(?:estimatedMin|estimate_min)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:estimatedMin|estimate_min)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i,
    /"(?:estimateLow|lowEstimate|minEstimate|estimate_from|startingPrice)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:estimateLow|lowEstimate|minEstimate|estimate_from|startingPrice)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i
  ]);
  const estimateLowFallback = matchFirst(scriptBlob, [
    /"(?:GBPLowEstimate|gbpLowEstimate|lowEstimateGBP)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:GBPLowEstimate|gbpLowEstimate|lowEstimateGBP)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i
  ]);
  const estimateLow = normalizeNumber(captureMatchValue(estimateLowPrimary ?? estimateLowFallback)) ?? null;
  const estimateHighPrimary = matchFirst(scriptBlob, [
    /"(?:estimatedMax|estimate_max)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:estimatedMax|estimate_max)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i,
    /"(?:estimateHigh|highEstimate|maxEstimate|estimate_to)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:estimateHigh|highEstimate|maxEstimate|estimate_to)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i
  ]);
  const estimateHighFallback = matchFirst(scriptBlob, [
    /"(?:GBPHighEstimate|gbpHighEstimate|highEstimateGBP)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:GBPHighEstimate|gbpHighEstimate|highEstimateGBP)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i
  ]);
  const estimateHigh = normalizeNumber(captureMatchValue(estimateHighPrimary ?? estimateHighFallback)) ?? null;

  const priceMatch = matchFirst(scriptBlob, [
    /"(?:auction_price|auctionPrice|opening_price|openingPrice)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:auction_price|auctionPrice|opening_price|openingPrice)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i,
    /"(?:realizedPrice|soldPrice|salePrice|finalPrice|hammerPrice|currentBid|lastBid|priceAmount|amount|startingBidAmount)"\s*:\s*(?:"([^"]+)"|([^,}\]]+))/i,
    /'(?:realizedPrice|soldPrice|salePrice|finalPrice|hammerPrice|currentBid|lastBid|priceAmount|amount|startingBidAmount)'\s*:\s*(?:'([^']+)'|([^,}\]]+))/i
  ]);
  const priceAmount = normalizeNumber(captureMatchValue(priceMatch));

  const currencyToken =
    matchFirst(scriptBlob, [
      /"(?:code)"\s*:\s*"([A-Za-z]{3})"/i,
      /'(?:code)'\s*:\s*'([A-Za-z]{3})'/i,
      /"(?:priceCurrency|currencyCode|currency)"\s*:\s*"([A-Za-z$€£₺]{1,5})"/i,
      /'(?:priceCurrency|currencyCode|currency)'\s*:\s*'([A-Za-z$€£₺]{1,5})'/i
    ])?.[1] ?? inferCurrency(scriptBlob);

  const saleDate =
    matchFirst(scriptBlob, [
      /"(?:saleDate|auctionDate|datePublished|publishedDate|eventDate|startDate|endDate|date)"\s*:\s*"([^"]{8,32})"/i,
      /'(?:saleDate|auctionDate|datePublished|publishedDate|eventDate|startDate|endDate|date)'\s*:\s*'([^']{8,32})'/i
    ])?.[1] ?? null;

  const title =
    matchFirst(scriptBlob, [
      /"(?:name|title)"\s*:\s*"([^"]{2,200})"/i,
      /'(?:name|title)'\s*:\s*'([^']{2,200})'/i
    ])?.[1] ?? null;
  const artistName =
    matchFirst(scriptBlob, [
      /"(?:artistName|artist_name|artist)"\s*:\s*"([^"]{2,200})"/i,
      /'(?:artistName|artist_name|artist)'\s*:\s*'([^']{2,200})'/i
    ])?.[1] ?? null;
  const medium =
    matchFirst(scriptBlob, [
      /"(?:short_desc|short_description|medium|material)"\s*:\s*"([^"]{2,300})"/i,
      /'(?:short_desc|short_description|medium|material)'\s*:\s*'([^']{2,300})'/i
    ])?.[1] ?? null;
  const year = scriptBlob.match(/\b((?:18|19|20)\d{2})\b/)?.[1] ?? null;
  const hiddenPriceMarker = matchFirst(scriptBlob, [
    /"(?:isShowPrice)"\s*:\s*(false|0)/i,
    /'(?:isShowPrice)'\s*:\s*(false|0)/i
  ]);

  let priceType: PriceType = "unknown";
  const lowerBlob = scriptBlob.toLowerCase();
  if (estimateLow !== null || estimateHigh !== null) {
    priceType = "estimate";
  } else if (priceAmount !== null) {
    if (/auction_price|hammerprice|hammer_price|hammer/.test(lowerBlob)) {
      priceType = "hammer_price";
    } else if (/realizedprice|soldprice|saleprice|finalprice|realized|sold/.test(lowerBlob)) {
      priceType = "realized_price";
    } else if (/askingprice|buy ?now|listingprice/.test(lowerBlob)) {
      priceType = "asking_price";
    } else {
      priceType = "asking_price";
    }
  }

  return {
    title: sanitizeTitle(title),
    artistName: firstString(artistName),
    medium: firstString(medium),
    year,
    lotNumber,
    estimateLow,
    estimateHigh,
    priceAmount,
    priceType,
    currency: normalizeCurrencyToken(currencyToken),
    saleDate,
    priceHidden: Boolean(hiddenPriceMarker)
  };
}

function estimateMidpoint(low: number | null, high: number | null): number | null {
  if (low !== null && high !== null) return (low + high) / 2;
  return low ?? high;
}

export function parseGenericLotFields(content: string, baseUrl?: string): GenericParsedFields {
  const text = content.replace(/\s+/g, " ").trim();
  const jsonLd = parseJsonLd(content);
  const scriptPayload = extractScriptPayloadFields(content);
  const hiddenBySourceFlag = scriptPayload.priceHidden;

  const lotMatch = text.match(/(?:lot no|lot nr|lot#|lot numarası|\blot\b)\s*[:#]?\s*([a-z0-9-]+)/i);
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

  const inquiryOnly = containsInquiryOnlyIndicators(text);

  let priceType: PriceType = jsonLd.priceType !== "unknown" ? jsonLd.priceType : scriptPayload.priceType;
  let priceAmount: number | null = jsonLd.priceAmount ?? scriptPayload.priceAmount;
  let estimateLow: number | null = jsonLd.estimateLow ?? scriptPayload.estimateLow;
  let estimateHigh: number | null = jsonLd.estimateHigh ?? scriptPayload.estimateHigh;
  let buyersPremiumIncluded: boolean | null = null;

  if (estMatch) {
    priceType = "estimate";
    estimateLow = normalizeNumber(estMatch[1]);
    estimateHigh = normalizeNumber(estMatch[2]);
    priceAmount = estimateMidpoint(estimateLow, estimateHigh);
  }

  if (realizedMatch) {
    const realizedAmount = normalizeNumber(realizedMatch[1]);
    const hasEstimateSignal = estimateLow !== null || estimateHigh !== null;
    if (realizedAmount !== null && realizedAmount > 0) {
      priceAmount = realizedAmount;
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
    } else if (!hasEstimateSignal) {
      priceAmount = realizedAmount;
    }
  } else if (askMatch && !inquiryOnly && priceType === "unknown") {
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
  const currencyMatches = extractCurrencyAmounts(text);
  const hasExplicitPriceSignal =
    Boolean(estMatch) ||
    Boolean(realizedMatch) ||
    Boolean(askMatch) ||
    priceAmount !== null ||
    estimateLow !== null ||
    estimateHigh !== null;
  let currency: string | null =
    jsonLd.currency ??
    scriptPayload.currency ??
    currencyMatches[0]?.currency ??
    (hasExplicitPriceSignal ? inferCurrency(text) : null) ??
    null;
  const currencyAmounts = currencyMatches
    .filter((entry) => !currency || entry.currency === currency)
    .map((entry) => entry.amount)
    .filter((amount) => amount > 0);
  const sortedCurrencyAmounts = [...currencyAmounts].sort((a, b) => a - b);

  if (priceType !== "inquiry_only") {
    if (priceType === "estimate" && estimateLow == null && estimateHigh == null && sortedCurrencyAmounts.length >= 2) {
      estimateLow = sortedCurrencyAmounts[0] ?? null;
      estimateHigh = sortedCurrencyAmounts[sortedCurrencyAmounts.length - 1] ?? null;
      priceAmount = estimateMidpoint(estimateLow, estimateHigh);
    }

    if (
      (priceType === "asking_price" ||
        priceType === "hammer_price" ||
        priceType === "realized_price" ||
        priceType === "realized_with_buyers_premium") &&
      (priceAmount == null || priceAmount <= 0) &&
      sortedCurrencyAmounts.length > 0
    ) {
      priceAmount = sortedCurrencyAmounts[sortedCurrencyAmounts.length - 1] ?? null;
    }

    if (priceType === "unknown" && sortedCurrencyAmounts.length > 0) {
      if (/estimate|estimated|estimate range|tahmini|ekspertiz/i.test(text) && sortedCurrencyAmounts.length >= 2) {
        priceType = "estimate";
        estimateLow = sortedCurrencyAmounts[0] ?? null;
        estimateHigh = sortedCurrencyAmounts[sortedCurrencyAmounts.length - 1] ?? null;
        priceAmount = estimateMidpoint(estimateLow, estimateHigh);
      } else if (/realized|sold|satış|satildi|satıldı|hammer|çekiç|cekic/i.test(text)) {
        priceType = "realized_price";
        priceAmount = sortedCurrencyAmounts[sortedCurrencyAmounts.length - 1] ?? null;
      } else {
        priceType = "asking_price";
        priceAmount = sortedCurrencyAmounts[sortedCurrencyAmounts.length - 1] ?? null;
      }
    }

    if (!currency && currencyMatches.length > 0) {
      currency = currencyMatches[0]?.currency ?? null;
    }
  }

  if (inquiryOnly || (priceAmount !== null && priceAmount <= 1 && containsInquiryOnlyIndicators(text))) {
    priceType = "inquiry_only";
    priceAmount = null;
    estimateLow = null;
    estimateHigh = null;
    currency = null;
  }

  if (hiddenBySourceFlag && priceType === "unknown") {
    priceType = "asking_price";
  }

  const hasResolvedNumericSignal = priceAmount !== null || estimateLow !== null || estimateHigh !== null;
  if (!hasResolvedNumericSignal && priceType !== "inquiry_only" && !hiddenBySourceFlag) {
    priceType = "unknown";
    currency = null;
  }

  const artistMatch = text.match(/(?:artist|sanatçı|sanatci)\s*[:\-]\s*([^|]{3,120})/i);
  const mediumMatch = text.match(/(?:medium|teknik|material)\s*[:\-]\s*([^|]{3,120})/i);
  const dimensionsMatch = text.match(
    /(?:dimensions?|ölçüler?|olculer|boyut(?:lar)?)\s*[:\-]?\s*([0-9.,\sx×*]+(?:cm|mm|in)?(?:\s*x\s*[0-9.,\sx×*]+(?:cm|mm|in)?)*)/i
  );
  const yearMatch = text.match(/(?:dated|year|yıl|yil|tarih)\s*[:\-]\s*((?:18|19|20)\d{2})/i) ?? text.match(/\b((?:18|19|20)\d{2})\b/);

  const lotFromText = lotMatch?.[1] ?? null;
  const normalizedLotFromText = lotFromText && !/^number$/i.test(lotFromText) ? lotFromText : null;

  return {
    title: jsonLd.title ?? scriptPayload.title ?? extractTitle(content),
    artistName: jsonLd.artistName ?? scriptPayload.artistName ?? (artistMatch ? artistMatch[1].trim() : null),
    medium: jsonLd.medium ?? scriptPayload.medium ?? (mediumMatch ? mediumMatch[1].trim() : null),
    dimensionsText: jsonLd.dimensionsText ?? (dimensionsMatch ? dimensionsMatch[1].trim() : null),
    year: jsonLd.year ?? scriptPayload.year ?? (yearMatch ? yearMatch[1] : null),
    imageUrl: extractImageUrl(content, baseUrl),
    lotNumber: normalizedLotFromText ?? jsonLd.lotNumber ?? scriptPayload.lotNumber,
    estimateLow,
    estimateHigh,
    priceAmount,
    priceType,
    currency,
    saleDate: saleDateMatch ? saleDateMatch[1] : jsonLd.saleDate ?? scriptPayload.saleDate,
    priceHidden: inquiryOnly || hiddenBySourceFlag,
    buyersPremiumIncluded
  };
}

export function parseLotFields(input: { html: string; markdown: string }): GenericParsedFields {
  const html = input.html ?? "";
  const markdown = input.markdown ?? "";
  return parseGenericLotFields(`${html}\n${markdown}`);
}
