import { describe, expect, it, vi } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import { BrowserClient } from "./browser-client.js";

describe("BrowserClient retry policy", () => {
  it("stops retrying after maxAttempts", async () => {
    const client = new BrowserClient(new AuthManager([]));
    const task = vi.fn(async () => {
      throw new Error("transient failure");
    });

    await expect(client.withRetries(task, 3, 1)).rejects.toThrow("transient failure");
    expect(task).toHaveBeenCalledTimes(3);
  });
});
