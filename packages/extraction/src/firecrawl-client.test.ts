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
  FIRECRAWL_API_KEY: process.env.FIRECRAWL_API_KEY,
  FIRECRAWL_BASE_URL: process.env.FIRECRAWL_BASE_URL,
  FIRECRAWL_TIMEOUT_MS: process.env.FIRECRAWL_TIMEOUT_MS,
  FIRECRAWL_MAX_RETRIES: process.env.FIRECRAWL_MAX_RETRIES
};

describe("firecrawl client", () => {
  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.scrapeUrl.mockReset();
    process.env.FIRECRAWL_ENABLED = "false";
    process.env.FIRECRAWL_API_KEY = "test-key";
    process.env.FIRECRAWL_BASE_URL = "";
    process.env.FIRECRAWL_TIMEOUT_MS = "15000";
    process.env.FIRECRAWL_MAX_RETRIES = "0";
  });

  afterEach(() => {
    process.env.FIRECRAWL_ENABLED = envSnapshot.FIRECRAWL_ENABLED;
    process.env.FIRECRAWL_API_KEY = envSnapshot.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_BASE_URL = envSnapshot.FIRECRAWL_BASE_URL;
    process.env.FIRECRAWL_TIMEOUT_MS = envSnapshot.FIRECRAWL_TIMEOUT_MS;
    process.env.FIRECRAWL_MAX_RETRIES = envSnapshot.FIRECRAWL_MAX_RETRIES;
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

  it("passes self-hosted base url when configured", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    process.env.FIRECRAWL_BASE_URL = "http://localhost:3002";
    mocks.scrapeUrl.mockResolvedValue({
      html: "<html><body>ok</body></html>",
      markdown: "ok"
    });

    await firecrawlScrape("https://example.com/lot/2");
    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiUrl: "http://localhost:3002"
    });
  });

  it("retries scrape failures up to FIRECRAWL_MAX_RETRIES", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    process.env.FIRECRAWL_MAX_RETRIES = "2";
    mocks.scrapeUrl
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValue({
        html: "<html><body>ok</body></html>",
        markdown: "ok"
      });

    const result = await firecrawlScrape("https://example.com/lot/3");
    expect(result).not.toBeNull();
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(3);
  });
});
