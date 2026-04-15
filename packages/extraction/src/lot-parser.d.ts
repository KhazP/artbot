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
export declare function parseGenericLotFields(content: string, baseUrl?: string): GenericParsedFields;
export declare function parseLotFields(input: {
    html: string;
    markdown: string;
}): GenericParsedFields;
//# sourceMappingURL=lot-parser.d.ts.map