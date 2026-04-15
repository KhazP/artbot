import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const scrapeUrl = vi.fn();
  const constructor = vi.fn().mockImplementation(() => ({ scrapeUrl }));
  return { scrapeUrl, constructor };
});

vi.mock("@mendable/firecrawl-js", () => ({
  default: mocks.constructor
}));

import { firecrawlScrape } from "./firecrawl-client.js";

const envSnapshot = {
  FIRECRAWL_ENABLED: process.env.FIRECRAWL_ENABLED,
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY
};

describe("firecrawl client", () => {
  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.scrapeUrl.mockReset();
    process.env.FIRECRAWL_ENABLED = "false";
    process.env.FIRECRAWL_API_KEY = "test-key";
  });

  afterEach(() => {
    process.env.FIRECRAWL_ENABLED = envSnapshot.FIRECRAWL_ENABLED;
    process.env.FIRECRAWL_API_KEY = envSnapshot.FIRECRAWL_API_KEY;
  });

  it("does not initialize Firecrawl when FIRECRAWL_ENABLED is false", async () => {
    const result = await firecrawlScrape("https://example.com/lot/1");

    expect(result).toBeNull();
    expect(mocks.constructor).not.toHaveBeenCalled();
    expect(mocks.scrapeUrl).not.toHaveBeenCalled();
  });

  it("uses Firecrawl only when explicitly enabled", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    mocks.scrapeUrl.mockResolvedValue({
      html: "<html><body>ok</body></html>",
      markdown: "ok"
    });

    const result = await firecrawlScrape("https://example.com/lot/1");
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      parserUsed: "firecrawl",
      status: 200
    });
  });
});
