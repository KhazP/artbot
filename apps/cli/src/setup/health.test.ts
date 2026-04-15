import { afterEach, describe, expect, it, vi } from "vitest";
import { checkSearxngHealth, normalizeLlmBaseUrl } from "./health.js";

const originalFetch = global.fetch;

afterEach(() => {
  global.fetch = originalFetch;
});

describe("LM Studio URL normalization", () => {
  it("adds /v1 for local OpenAI-compatible URLs without a path", () => {
    expect(normalizeLlmBaseUrl("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeLlmBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234/v1");
  });

  it("preserves URLs that already include a path", () => {
    expect(normalizeLlmBaseUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
  });

  it("checks searxng endpoint health", async () => {
    global.fetch = vi.fn(async () => new Response(JSON.stringify({ results: [] }), { status: 200 })) as typeof fetch;
    const health = await checkSearxngHealth("http://127.0.0.1:8080");

    expect(health.ok).toBe(true);
    expect(health.baseUrl).toBe("http://127.0.0.1:8080");
  });
});
