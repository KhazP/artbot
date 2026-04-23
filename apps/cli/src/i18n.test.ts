import { describe, expect, it } from "vitest";
import { normalizeAppLocale, translate } from "./i18n.js";

describe("i18n", () => {
  it("normalizes supported locales and falls back to english", () => {
    expect(normalizeAppLocale("tr")).toBe("tr");
    expect(normalizeAppLocale("TR")).toBe("tr");
    expect(normalizeAppLocale("de")).toBe("en");
    expect(normalizeAppLocale(undefined)).toBe("en");
  });

  it("translates known keys for turkish and falls back to english messages", () => {
    expect(translate("tr", "tui.shell.readyTitle")).toBe("Operator Kokpiti");
    expect(translate("en", "tui.shell.readyTitle")).toBe("Operator Cockpit");
  });
});
