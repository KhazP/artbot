import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  DEFAULT_TUI_PREFERENCES,
  loadTuiPreferences,
  normalizeTuiPreferences,
  resolveTuiPreferencesPath,
  saveTuiPreferences
} from "./preferences.js";

const artbotHomeSnapshot = process.env.ARTBOT_HOME;

afterEach(() => {
  process.env.ARTBOT_HOME = artbotHomeSnapshot;
});

describe("tui preferences", () => {
  it("falls back to defaults when no file exists", () => {
    process.env.ARTBOT_HOME = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-tui-home-"));

    expect(loadTuiPreferences()).toEqual(DEFAULT_TUI_PREFERENCES);
  });

  it("normalizes invalid fields back to safe defaults", () => {
    expect(
      normalizeTuiPreferences({
        theme: "unknown",
        density: "dense",
        showSecondaryPane: "yes",
        diffLayout: "grid"
      })
    ).toEqual(DEFAULT_TUI_PREFERENCES);
  });

  it("saves and reloads the persisted json file", () => {
    const homeDir = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-tui-home-"));
    process.env.ARTBOT_HOME = homeDir;

    const filePath = saveTuiPreferences({
      language: "tr",
      theme: "matrix",
      density: "compact",
      showSecondaryPane: false,
      diffLayout: "stacked",
      experimental: DEFAULT_TUI_PREFERENCES.experimental
    });

    expect(filePath).toBe(resolveTuiPreferencesPath());
    expect(fs.existsSync(filePath)).toBe(true);
    expect(loadTuiPreferences()).toEqual({
      language: "tr",
      theme: "matrix",
      density: "compact",
      showSecondaryPane: false,
      diffLayout: "stacked",
      experimental: DEFAULT_TUI_PREFERENCES.experimental
    });
  });
});
