import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthManager } from "@artbot/auth-manager";
import { researchQuerySchema } from "@artbot/shared-types";
import {
  buildCustomSourceAdapters,
  loadCustomSources,
  validateCustomSourcesPayload,
  writeCustomSourcesFile
} from "./custom-sources.js";
import { buildSourcePlanItems, planSources } from "./routing.js";

const cleanupPaths: string[] = [];

afterEach(() => {
  for (const target of cleanupPaths.splice(0)) {
    fs.rmSync(target, { recursive: true, force: true });
  }
});

const baseQuery = researchQuerySchema.parse({
  artist: "Artist",
  scope: "turkey_plus_international" as const,
  turkeyFirst: true,
  analysisMode: "balanced" as const,
  priceNormalization: "usd_dual" as const,
  manualLoginCheckpoint: false,
  allowLicensed: false,
  licensedIntegrations: [],
  crawlMode: "backfill" as const,
  sourceClasses: ["auction_house", "gallery", "dealer", "marketplace", "database", "other"]
});

describe("custom sources", () => {
  it("validates public, auth, and licensed source definitions", () => {
    const result = validateCustomSourcesPayload({
      version: 1,
      sources: [
        {
          name: "Public Archive",
          url: "https://public.example",
          searchTemplate: "https://public.example/search?q={query}",
          access: "public"
        },
        {
          id: "member-db",
          name: "Member DB",
          url: "https://member.example",
          access: "auth",
          authProfileId: "member-auth"
        },
        {
          name: "Licensed DB",
          url: "https://licensed.example",
          access: "licensed",
          legalPosture: "licensed_only"
        }
      ]
    });

    expect(result.ok).toBe(true);
    expect(result.sources.map((source) => source.access)).toEqual(["public", "auth", "licensed"]);
    expect(result.sources[1]?.authProfileId).toBe("member-auth");
  });

  it("rejects bad URLs, duplicate ids, and search templates without query placeholder", () => {
    const result = validateCustomSourcesPayload({
      sources: [
        {
          id: "dup",
          name: "Broken",
          url: "notaurl",
          searchTemplate: "https://example.com/search",
          access: "public"
        },
        {
          id: "dup",
          name: "Duplicate",
          url: "https://example.com",
          access: "public"
        }
      ]
    });

    expect(result.ok).toBe(false);
    expect(result.errors.join(" ")).toContain("url must be a valid URL");
    expect(result.errors.join(" ")).toContain("searchTemplate must include {query}");
    expect(result.errors.join(" ")).toContain("duplicates");
  });

  it("loads sources from disk and turns them into generic adapters", async () => {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "artbot-custom-sources-"));
    cleanupPaths.push(tempRoot);
    const configPath = path.join(tempRoot, "artbot.sources.json");
    writeCustomSourcesFile(
      {
        version: 1,
        sources: [
          {
            id: "example",
            name: "Example Archive",
            url: "https://example.com",
            searchTemplate: "https://example.com/search?q={query}",
            access: "public",
            sourceClass: "database"
          }
        ]
      },
      configPath
    );

    const loaded = loadCustomSources(configPath);
    expect(loaded.ok).toBe(true);
    const adapters = buildCustomSourceAdapters(loaded.sources);
    expect(adapters).toHaveLength(1);
    expect(adapters[0]?.sourceName).toBe("Example Archive");

    const planned = await planSources(baseQuery, adapters, new AuthManager([]));
    const sourcePlan = buildSourcePlanItems(planned, 24, "balanced");
    expect(sourcePlan.some((item) => item.adapter_id === "custom-source-example")).toBe(true);
  });

  it("marks auth sources without matching profiles and uses configured profile when available", async () => {
    const adapters = buildCustomSourceAdapters([
      {
        id: "member-db",
        name: "Member DB",
        url: "https://member.example",
        searchTemplate: "https://member.example/search?q={query}",
        access: "auth",
        sourceClass: "database",
        authProfileId: "member-auth"
      }
    ]);

    const noProfile = await planSources(baseQuery, adapters, new AuthManager([]));
    expect(noProfile[0]?.accessContext.sourceAccessStatus).toBe("auth_required");
    expect(noProfile[0]?.accessContext.profileId).toBeUndefined();

    const withProfile = await planSources(
      baseQuery,
      adapters,
      new AuthManager([
        {
          id: "member-auth",
          mode: "authorized",
          sourcePatterns: ["member.example"]
        }
      ])
    );
    expect(withProfile[0]?.accessContext.mode).toBe("authorized");
    expect(withProfile[0]?.accessContext.profileId).toBe("member-auth");
  });
});
