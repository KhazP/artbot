export interface FxRateTable {
  base: "EUR";
  date: string;
  rates: Record<string, number>;
}

const fallbackRates: FxRateTable = {
  base: "EUR",
  date: "2026-04-08",
  rates: {
    EUR: 1,
    USD: 1.09,
    TRY: 44.52,
    GBP: 0.86
  }
};

export class FxRateProvider {
  private readonly cache: Map<string, FxRateTable> = new Map();

  constructor() {
    this.cache.set(fallbackRates.date, fallbackRates);
  }

  public getRates(forDate?: string): FxRateTable {
    if (!forDate) {
      return fallbackRates;
    }

    if (this.cache.has(forDate)) {
      return this.cache.get(forDate) as FxRateTable;
    }

    return fallbackRates;
  }
}
