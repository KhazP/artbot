export type FxQuoteCurrency = "EUR" | "USD" | "TRY" | "GBP";

export interface FxRateTable {
  base: "EUR";
  date: string;
  rates: Record<FxQuoteCurrency, number>;
  source: "ecb_api" | "tcmb_fallback" | "static_fallback";
}

export interface InflationTable {
  source: "us_cpi_static";
  baseYear: number;
  cpiByYear: Record<number, number>;
}

export interface FxRateStore {
  getRatesForDate(date: string, baseCurrency?: FxRateTable["base"]): Promise<Array<{
    base_currency: FxRateTable["base"];
    quote_currency: FxQuoteCurrency;
    date: string;
    rate: number;
    source: FxRateTable["source"];
    fetched_at: string;
    quality_flag: string;
  }>> | Array<{
    base_currency: FxRateTable["base"];
    quote_currency: FxQuoteCurrency;
    date: string;
    rate: number;
    source: FxRateTable["source"];
    fetched_at: string;
    quality_flag: string;
  }>;
  upsertFxRateDaily(input: {
    base_currency: FxRateTable["base"];
    quote_currency: FxQuoteCurrency;
    date: string;
    rate: number;
    source: FxRateTable["source"];
    quality_flag: "historical_exact" | "historical_fallback" | "current_cache";
  }): Promise<unknown> | unknown;
}

const fallbackRates: FxRateTable = {
  base: "EUR",
  date: "2026-04-08",
  rates: {
    EUR: 1,
    USD: 1.09,
    TRY: 44.52,
    GBP: 0.86
  },
  source: "static_fallback"
};

const US_CPI_BY_YEAR: Record<number, number> = {
  2000: 172.2,
  2001: 177.1,
  2002: 179.9,
  2003: 184.0,
  2004: 188.9,
  2005: 195.3,
  2006: 201.6,
  2007: 207.3,
  2008: 215.3,
  2009: 214.5,
  2010: 218.1,
  2011: 224.9,
  2012: 229.6,
  2013: 233.0,
  2014: 236.7,
  2015: 237.0,
  2016: 240.0,
  2017: 245.1,
  2018: 251.1,
  2019: 255.7,
  2020: 258.8,
  2021: 271.0,
  2022: 292.7,
  2023: 305.4,
  2024: 314.2,
  2025: 322.5,
  2026: 331.0
};

function toIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function parseDate(value: string): Date | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date;
}

function csvRateValue(rawCsv: string): number | null {
  const lines = rawCsv
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  if (lines.length < 2) {
    return null;
  }

  for (let i = lines.length - 1; i >= 1; i -= 1) {
    const cols = lines[i].split(",");
    const valueRaw = cols[cols.length - 1]?.replace(/"/g, "").trim();
    if (!valueRaw) continue;
    const value = Number(valueRaw);
    if (Number.isFinite(value)) {
      return value;
    }
  }
  return null;
}

function extractUsdTryFromTcmbXml(xml: string): number | null {
  const currencyMatch = xml.match(/<Currency[^>]*CurrencyCode="USD"[\s\S]*?<\/Currency>/i);
  if (!currencyMatch) return null;
  const block = currencyMatch[0];
  const forexSelling = block.match(/<ForexSelling>([^<]+)<\/ForexSelling>/i)?.[1];
  if (!forexSelling) return null;
  const value = Number(forexSelling.replace(",", ".").trim());
  return Number.isFinite(value) ? value : null;
}

export class FxRateProvider {
  private readonly cache = new Map<string, FxRateTable>();
  private readonly inflation: InflationTable;

  constructor(
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly inflationBaseYear = Number(process.env.USD_INFLATION_BASE_YEAR ?? 2026),
    private readonly store?: FxRateStore
  ) {
    this.cache.set(fallbackRates.date, fallbackRates);
    this.inflation = {
      source: "us_cpi_static",
      baseYear: this.inflationBaseYear,
      cpiByYear: US_CPI_BY_YEAR
    };
  }

  public async getRates(forDate?: string): Promise<FxRateTable> {
    if (!forDate) {
      return fallbackRates;
    }

    const normalizedDate = this.normalizeDateInput(forDate);
    if (!normalizedDate) {
      return fallbackRates;
    }

    if (this.cache.has(normalizedDate)) {
      return this.cache.get(normalizedDate) as FxRateTable;
    }

    const persisted = await this.loadPersistedRates(normalizedDate);
    if (persisted) {
      this.cache.set(normalizedDate, persisted);
      return persisted;
    }

    const fetched = await this.fetchEcbRatesWithFallback(normalizedDate);
    this.cache.set(normalizedDate, fetched);
    const qualityFlag =
      normalizedDate === toIsoDate(new Date())
        ? "current_cache"
        : fetched.source === "ecb_api"
          ? "historical_exact"
          : "historical_fallback";
    await this.persistRates(fetched, qualityFlag);
    return fetched;
  }

  public getInflationTable(): InflationTable {
    return this.inflation;
  }

  private normalizeDateInput(value: string): string | null {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return value;
    }
    if (/^\d{4}$/.test(value)) {
      return `${value}-06-30`;
    }
    const parsed = parseDate(value);
    return parsed ? toIsoDate(parsed) : null;
  }

  private async fetchEcbRatesWithFallback(date: string): Promise<FxRateTable> {
    const direct = await this.fetchEcbUsdTry(date);
    if (direct) {
      return {
        base: "EUR",
        date: direct.date,
        rates: {
          EUR: 1,
          USD: direct.usdPerEur,
          TRY: direct.tryPerEur,
          GBP: fallbackRates.rates.GBP
        },
        source: "ecb_api"
      };
    }

    const usdOnly = await this.fetchEcbUsd(date);
    if (!usdOnly) {
      return fallbackRates;
    }

    const tcmbTryPerUsd = await this.fetchTcmbTryPerUsd(date);
    if (!tcmbTryPerUsd) {
      return {
        ...fallbackRates,
        date,
        rates: {
          ...fallbackRates.rates,
          USD: usdOnly.usdPerEur
        }
      };
    }

    return {
      base: "EUR",
      date,
      rates: {
        EUR: 1,
        USD: usdOnly.usdPerEur,
        TRY: usdOnly.usdPerEur * tcmbTryPerUsd,
        GBP: fallbackRates.rates.GBP
      },
      source: "tcmb_fallback"
    };
  }

  private async loadPersistedRates(date: string): Promise<FxRateTable | null> {
    if (!this.store) {
      return null;
    }

    const rows = await this.store.getRatesForDate(date, "EUR");
    if (!rows || rows.length === 0) {
      return null;
    }

    const rates: Record<string, number> = { EUR: 1 };
    for (const row of rows) {
      rates[row.quote_currency] = row.rate;
    }

    return {
      base: "EUR",
      date,
      rates: {
        EUR: rates.EUR ?? 1,
        USD: rates.USD ?? fallbackRates.rates.USD,
        TRY: rates.TRY ?? fallbackRates.rates.TRY,
        GBP: rates.GBP ?? fallbackRates.rates.GBP
      },
      source: rows[0]?.source ?? "static_fallback"
    };
  }

  private async persistRates(
    table: FxRateTable,
    qualityFlag: "historical_exact" | "historical_fallback" | "current_cache"
  ): Promise<void> {
    if (!this.store) {
      return;
    }

    const quotes: Array<keyof FxRateTable["rates"]> = ["EUR", "USD", "TRY", "GBP"];
    for (const quote of quotes) {
      const rate = table.rates[quote];
      if (!Number.isFinite(rate) || rate <= 0) {
        continue;
      }

      await this.store.upsertFxRateDaily({
        base_currency: "EUR",
        quote_currency: quote,
        date: table.date,
        rate,
        source: table.source,
        quality_flag: qualityFlag
      });
    }
  }

  private async fetchEcbUsdTry(date: string): Promise<{ usdPerEur: number; tryPerEur: number; date: string } | null> {
    const usd = await this.fetchEcbPair("USD", date);
    if (!usd) return null;
    const tr = await this.fetchEcbPair("TRY", date);
    if (!tr) return null;
    return {
      usdPerEur: usd.value,
      tryPerEur: tr.value,
      date: usd.date
    };
  }

  private async fetchEcbUsd(date: string): Promise<{ usdPerEur: number; date: string } | null> {
    const usd = await this.fetchEcbPair("USD", date);
    if (!usd) return null;
    return {
      usdPerEur: usd.value,
      date: usd.date
    };
  }

  private async fetchEcbPair(currency: "USD" | "TRY", date: string): Promise<{ date: string; value: number } | null> {
    const parsedStart = parseDate(date);
    if (!parsedStart) {
      return null;
    }

    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const target = new Date(parsedStart);
      target.setUTCDate(target.getUTCDate() - dayOffset);
      const targetDate = toIsoDate(target);
      const endpoint = `https://data-api.ecb.europa.eu/service/data/EXR/D.${currency}.EUR.SP00.A?startPeriod=${targetDate}&endPeriod=${targetDate}&format=csvdata`;
      try {
        const response = await this.fetchImpl(endpoint, {
          headers: {
            Accept: "text/csv"
          }
        });
        if (!response.ok) {
          continue;
        }
        const csv = await response.text();
        const value = csvRateValue(csv);
        if (value && Number.isFinite(value)) {
          return {
            date: targetDate,
            value
          };
        }
      } catch {
        continue;
      }
    }

    return null;
  }

  private async fetchTcmbTryPerUsd(date: string): Promise<number | null> {
    const parsedStart = parseDate(date);
    if (!parsedStart) {
      return null;
    }

    for (let dayOffset = 0; dayOffset <= 7; dayOffset += 1) {
      const target = new Date(parsedStart);
      target.setUTCDate(target.getUTCDate() - dayOffset);
      const y = target.getUTCFullYear();
      const m = String(target.getUTCMonth() + 1).padStart(2, "0");
      const d = String(target.getUTCDate()).padStart(2, "0");
      const endpoint = `https://www.tcmb.gov.tr/kurlar/${y}${m}/${d}${m}${y}.xml`;
      try {
        const response = await this.fetchImpl(endpoint);
        if (!response.ok) {
          continue;
        }
        const xml = await response.text();
        const parsedValue = extractUsdTryFromTcmbXml(xml);
        if (parsedValue && Number.isFinite(parsedValue)) {
          return parsedValue;
        }
      } catch {
        continue;
      }
    }

    return null;
  }
}
