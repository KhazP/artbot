import FirecrawlApp from "@mendable/firecrawl-js";
import type { FetchResult } from "./http-fetch.js";

function firecrawlEnabledByEnv(): boolean {
  return process.env.FIRECRAWL_ENABLED?.trim().toLowerCase() === "true";
}

export async function firecrawlScrape(url: string): Promise<FetchResult | null> {
  if (!firecrawlEnabledByEnv()) {
    return null;
  }

  const apiKey = process.env.FIRECRAWL_API_KEY;
  if (!apiKey) {
    return null;
  }

  const app = new FirecrawlApp({ apiKey });

  try {
    const response = await app.scrapeUrl(url, {
      formats: ["markdown", "html"],
      onlyMainContent: false
    });

    const html = (response as { html?: string }).html ?? "";
    const markdown = (response as { markdown?: string }).markdown ?? "";

    return {
      url,
      html,
      markdown,
      status: 200,
      parserUsed: "firecrawl"
    };
  } catch {
    return null;
  }
}
