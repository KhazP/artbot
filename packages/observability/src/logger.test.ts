import { describe, expect, it, vi } from "vitest";
import { logger } from "./logger.js";

describe("logger redaction", () => {
  it("redacts sensitive keys", () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    logger.info("test", {
      apiKey: "very-secret-key",
      token: "mytokenvalue",
      nested: {
        password: "abc123",
        ok: "visible"
      }
    });

    const payload = JSON.parse(String(spy.mock.calls[0][0])) as Record<string, unknown>;
    expect(payload.apiKey).toBe("***redacted***");
    expect(payload.token).toBe("***redacted***");
    expect((payload.nested as Record<string, unknown>).password).toBe("***redacted***");
    expect((payload.nested as Record<string, unknown>).ok).toBe("visible");

    spy.mockRestore();
  });
});
