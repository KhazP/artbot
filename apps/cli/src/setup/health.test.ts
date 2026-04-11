import { describe, expect, it } from "vitest";
import { normalizeLlmBaseUrl } from "./health.js";

describe("LM Studio URL normalization", () => {
  it("adds /v1 for local OpenAI-compatible URLs without a path", () => {
    expect(normalizeLlmBaseUrl("http://127.0.0.1:1234")).toBe("http://127.0.0.1:1234/v1");
    expect(normalizeLlmBaseUrl("http://localhost:1234/")).toBe("http://localhost:1234/v1");
  });

  it("preserves URLs that already include a path", () => {
    expect(normalizeLlmBaseUrl("http://127.0.0.1:1234/v1")).toBe("http://127.0.0.1:1234/v1");
  });
});
