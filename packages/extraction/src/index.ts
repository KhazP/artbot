import { firecrawlScrape } from "./firecrawl-client.js";
import { fetchPage } from "./http-fetch.js";
export type { FetchResult } from "./http-fetch.js";
export * from "./lot-parser.js";

export async function fetchCheapestFirst(url: string) {
  const firecrawl = await firecrawlScrape(url);
  if (firecrawl) {
    return firecrawl;
  }
  return fetchPage(url);
}
