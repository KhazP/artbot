import { describe, expect, it } from "vitest";
import { getTuiTheme } from "./theme.js";
import { buildKnightRiderPulse, buildStageRows, extractQuantization, getRunningSpinnerFrame } from "./shell.js";

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

describe("buildKnightRiderPulse", () => {
  it("builds a fixed-width pulse with a single head", () => {
    const frame = buildKnightRiderPulse(0, 10);
    expect(frame).toHaveLength(10);
    expect(frame.split("█")).toHaveLength(2);
  });

  it("moves the pulse across ticks", () => {
    const first = buildKnightRiderPulse(0, 8);
    const second = buildKnightRiderPulse(1, 8);
    expect(first).not.toBe(second);
  });
});

describe("getRunningSpinnerFrame", () => {
  it("wraps across spinner frames", () => {
    expect(getRunningSpinnerFrame(0)).toBe("⠋");
    expect(getRunningSpinnerFrame(9)).toBe("⠏");
    expect(getRunningSpinnerFrame(10)).toBe("⠋");
  });
});

describe("buildStageRows", () => {
  it("animates queue stage while run is pending", () => {
    const theme = getTuiTheme("artbot");
    const rows = buildStageRows({ run: { status: "pending" } }, theme, 2);

    expect(rows[0]?.label).toBe("Queue");
    expect(rows[0]?.symbol).toBe(getRunningSpinnerFrame(2));
    expect(rows[0]?.detail).toBe("waiting");
  });
});
