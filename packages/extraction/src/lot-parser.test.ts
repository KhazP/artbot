import { describe, expect, it } from "vitest";
import { parseGenericLotFields } from "./lot-parser.js";

describe("parseGenericLotFields numeric normalization", () => {
  it("parses US thousands+decimal format", () => {
    const parsed = parseGenericLotFields("Realized: USD 1,200.50");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBeCloseTo(1200.5, 6);
    expect(parsed.currency).toBe("USD");
  });

  it("parses EU thousands+decimal format", () => {
    const parsed = parseGenericLotFields("Realized: EUR 1.200,50");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBeCloseTo(1200.5, 6);
    expect(parsed.currency).toBe("EUR");
  });

  it("parses dotted thousands format", () => {
    const parsed = parseGenericLotFields("Realized: 100.000 TL");

    expect(parsed.priceType).toBe("realized_price");
    expect(parsed.priceAmount).toBe(100000);
    expect(parsed.currency).toBe("TRY");
  });
});
