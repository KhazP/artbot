import { describe, expect, it } from "vitest";
import { getTuiTheme } from "./theme.js";
import { buildStageRows, extractQuantization } from "./shell.js";

describe("extractQuantization", () => {
  it("extracts q-style quantization from model names", () => {
    expect(extractQuantization("mistral-v0.3-q4_K_M")).toBe("q4_K_M");
    expect(extractQuantization("gguf/llama-3.1-q8_0")).toBe("q8_0");
  });

  it("returns unknown when quantization is not present", () => {
    expect(extractQuantization("llama3.2:latest")).toBe("unknown");
    expect(extractQuantization(undefined)).toBe("unknown");
  });
});

describe("buildStageRows", () => {
  it("shows stable queue status while run is pending", () => {
    const theme = getTuiTheme("artbot");
    const rows = buildStageRows({ run: { status: "pending" } }, theme);

    expect(rows[0]?.label).toBe("Queue");
    expect(rows[0]?.symbol).toBe("…");
    expect(rows[0]?.detail).toBe("waiting");
  });
});
