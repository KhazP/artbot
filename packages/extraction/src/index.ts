import { firecrawlScrape } from "./firecrawl-client.js";
import { fetchPage } from "./http-fetch.js";
import type { SessionContext } from "./http-fetch.js";
export type { FetchResult, SessionContext } from "./http-fetch.js";
export {
  CurlProvider,
  NodeFetchProvider,
  TransportError,
  TransportErrorKind,
  isTransportError
} from "./http-fetch.js";
export * from "./lot-parser.js";
export * from "./gemini-structured.js";

export async function fetchCheapestFirst(url: string, sessionContext?: SessionContext) {
  const firecrawl = await firecrawlScrape(url);
  if (firecrawl) {
    return firecrawl;
  }
  return fetchPage(url, sessionContext);
}
