import { describe, expect, it } from "vitest";
import { resolveWorkspaceBackendEnv } from "./backend.js";

describe("workspace backend env", () => {
  it("derives port and loopback host from the requested API base url", () => {
    const env = resolveWorkspaceBackendEnv("http://127.0.0.1:4100", {
      PATH: "/usr/bin",
      API_BASE_URL: "http://localhost:4000"
    });

    expect(env.PORT).toBe("4100");
    expect(env.HOST).toBe("127.0.0.1");
    expect(env.API_BASE_URL).toBe("http://127.0.0.1:4100");
    expect(env.PATH).toBe("/usr/bin");
  });
});
