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
  FIRECRAWL_MAX_RETRIES: process.env.FIRECRAWL_MAX_RETRIES,
  FIRECRAWL_SOURCE_FAMILIES: process.env.FIRECRAWL_SOURCE_FAMILIES
};

describe("firecrawl client", () => {
  beforeEach(() => {
    mocks.constructor.mockClear();
    mocks.scrapeUrl.mockReset();
    process.env.FIRECRAWL_ENABLED = "false";
    process.env.FIRECRAWL_API_KEY = "test-key";
    delete process.env.FIRECRAWL_BASE_URL;
    delete process.env.FIRECRAWL_TIMEOUT_MS;
    delete process.env.FIRECRAWL_MAX_RETRIES;
    delete process.env.FIRECRAWL_SOURCE_FAMILIES;
  });

  afterEach(() => {
    process.env.FIRECRAWL_ENABLED = envSnapshot.FIRECRAWL_ENABLED;
    process.env.FIRECRAWL_API_KEY = envSnapshot.FIRECRAWL_API_KEY;
    process.env.FIRECRAWL_BASE_URL = envSnapshot.FIRECRAWL_BASE_URL;
    process.env.FIRECRAWL_TIMEOUT_MS = envSnapshot.FIRECRAWL_TIMEOUT_MS;
    process.env.FIRECRAWL_MAX_RETRIES = envSnapshot.FIRECRAWL_MAX_RETRIES;
    process.env.FIRECRAWL_SOURCE_FAMILIES = envSnapshot.FIRECRAWL_SOURCE_FAMILIES;
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

    const result = await firecrawlScrape("https://example.com/lot/1", {
      sourceAccessStatus: "public_access"
    });
    expect(mocks.constructor).toHaveBeenCalledWith({ apiKey: "test-key" });
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      parserUsed: "firecrawl",
      status: 200
    });
  });

  it("passes a custom self-hosted API URL when configured", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    process.env.FIRECRAWL_BASE_URL = "https://firecrawl.internal";
    mocks.scrapeUrl.mockResolvedValue({
      html: "<html></html>",
      markdown: ""
    });

    await firecrawlScrape("https://example.com/lot/2", {
      sourceAccessStatus: "public_access"
    });

    expect(mocks.constructor).toHaveBeenCalledWith({
      apiKey: "test-key",
      apiUrl: "https://firecrawl.internal"
    });
  });

  it("retries up to FIRECRAWL_MAX_RETRIES before giving up", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    process.env.FIRECRAWL_MAX_RETRIES = "2";
    mocks.scrapeUrl.mockRejectedValue(new Error("boom"));

    const result = await firecrawlScrape("https://example.com/lot/3", {
      sourceAccessStatus: "public_access"
    });

    expect(result).toBeNull();
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(3);
  });

  it("skips auth-required pages even when enabled", async () => {
    process.env.FIRECRAWL_ENABLED = "true";

    const result = await firecrawlScrape("https://example.com/lot/4", {
      sourceAccessStatus: "auth_required"
    });

    expect(result).toBeNull();
    expect(mocks.constructor).not.toHaveBeenCalled();
  });

  it("honors the source-family allowlist when configured", async () => {
    process.env.FIRECRAWL_ENABLED = "true";
    process.env.FIRECRAWL_SOURCE_FAMILIES = "artam,public-db";
    mocks.scrapeUrl.mockResolvedValue({
      html: "<html></html>",
      markdown: ""
    });

    const denied = await firecrawlScrape("https://example.com/lot/5", {
      sourceAccessStatus: "public_access",
      sourceFamily: "private-gallery"
    });
    const allowed = await firecrawlScrape("https://example.com/lot/6", {
      sourceAccessStatus: "public_access",
      sourceFamily: "Artam"
    });

    expect(denied).toBeNull();
    expect(allowed?.parserUsed).toBe("firecrawl");
    expect(mocks.scrapeUrl).toHaveBeenCalledTimes(1);
  });
});
