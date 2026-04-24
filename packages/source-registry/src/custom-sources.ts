import fs from "node:fs";
import path from "node:path";
import type { SourceLegalPosture, SourcePageType, VenueType } from "@artbot/shared-types";
import { GenericSourceAdapter, type SourceAdapter } from "@artbot/source-adapters";
import { resolveFamilyPackByHost } from "./source-families.js";

export const CUSTOM_SOURCES_FILE = "artbot.sources.json";

export type CustomSourceAccess = "public" | "auth" | "licensed";

export interface CustomSourceDefinition {
  id: string;
  name: string;
  url: string;
  searchTemplate?: string;
  access: CustomSourceAccess;
  legalPosture?: SourceLegalPosture;
  sourceClass?: VenueType;
  country?: string | null;
  city?: string | null;
  sourcePageType?: SourcePageType;
  crawlHints?: string[];
  authProfileId?: string;
  enabled?: boolean;
}

export interface CustomSourcesFile {
  version: 1;
  sources: CustomSourceDefinition[];
}

export interface CustomSourceValidationResult {
  ok: boolean;
  path: string;
  sources: CustomSourceDefinition[];
  errors: string[];
}

const VENUE_TYPES: VenueType[] = ["auction_house", "gallery", "dealer", "marketplace", "database", "other"];
const SOURCE_PAGE_TYPES: SourcePageType[] = ["lot", "artist_page", "price_db", "listing", "article", "other"];
const ACCESS_VALUES: CustomSourceAccess[] = ["public", "auth", "licensed"];
const LEGAL_POSTURES: SourceLegalPosture[] = [
  "public_permitted",
  "public_contract_sensitive",
  "auth_required",
  "licensed_only",
  "operator_assisted_only"
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeId(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

export function sourceIdFromName(name: string): string {
  const id = normalizeId(name);
  return id.length > 0 ? id : "custom-source";
}

function normalizeUrl(value: unknown, field: string, errors: string[]): string | null {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be a non-empty URL.`);
    return null;
  }
  try {
    const parsed = new URL(value.trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      errors.push(`${field} must use http or https.`);
      return null;
    }
    parsed.hash = "";
    return parsed.toString();
  } catch {
    errors.push(`${field} must be a valid URL.`);
    return null;
  }
}

function normalizeSearchTemplate(value: unknown, index: number, errors: string[]): string | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const normalized = normalizeUrl(value, `sources[${index}].searchTemplate`, errors);
  if (!normalized) {
    return undefined;
  }
  if (!normalized.includes("{query}")) {
    errors.push(`sources[${index}].searchTemplate must include {query}.`);
    return undefined;
  }
  return normalized;
}

function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.map((entry) => (typeof entry === "string" ? entry.trim() : "")).filter(Boolean);
}

function legalPostureForAccess(access: CustomSourceAccess): SourceLegalPosture {
  if (access === "licensed") return "licensed_only";
  if (access === "auth") return "auth_required";
  return "public_permitted";
}

function parseCustomSource(value: unknown, index: number, seenIds: Set<string>, errors: string[]): CustomSourceDefinition | null {
  if (!isRecord(value)) {
    errors.push(`sources[${index}] must be an object.`);
    return null;
  }

  const name = typeof value.name === "string" ? value.name.trim() : "";
  if (!name) {
    errors.push(`sources[${index}].name must be a non-empty string.`);
  }

  const id = normalizeId(typeof value.id === "string" && value.id.trim() ? value.id : sourceIdFromName(name));
  if (!id) {
    errors.push(`sources[${index}].id must resolve to a non-empty id.`);
  } else if (seenIds.has(id)) {
    errors.push(`sources[${index}].id duplicates "${id}".`);
  }
  seenIds.add(id);

  const url = normalizeUrl(value.url, `sources[${index}].url`, errors);
  const searchTemplate = normalizeSearchTemplate(value.searchTemplate, index, errors);

  const access = typeof value.access === "string" && ACCESS_VALUES.includes(value.access as CustomSourceAccess)
    ? (value.access as CustomSourceAccess)
    : null;
  if (!access) {
    errors.push(`sources[${index}].access must be public, auth, or licensed.`);
  }

  let sourceClass: VenueType = "other";
  if (value.sourceClass !== undefined) {
    if (typeof value.sourceClass === "string" && VENUE_TYPES.includes(value.sourceClass as VenueType)) {
      sourceClass = value.sourceClass as VenueType;
    } else {
      errors.push(`sources[${index}].sourceClass must be one of ${VENUE_TYPES.join(", ")}.`);
    }
  }

  let sourcePageType: SourcePageType = "listing";
  if (value.sourcePageType !== undefined) {
    if (typeof value.sourcePageType === "string" && SOURCE_PAGE_TYPES.includes(value.sourcePageType as SourcePageType)) {
      sourcePageType = value.sourcePageType as SourcePageType;
    } else {
      errors.push(`sources[${index}].sourcePageType must be one of ${SOURCE_PAGE_TYPES.join(", ")}.`);
    }
  }

  let legalPosture = access ? legalPostureForAccess(access) : undefined;
  if (value.legalPosture !== undefined) {
    if (typeof value.legalPosture === "string" && LEGAL_POSTURES.includes(value.legalPosture as SourceLegalPosture)) {
      legalPosture = value.legalPosture as SourceLegalPosture;
    } else {
      errors.push(`sources[${index}].legalPosture must be one of ${LEGAL_POSTURES.join(", ")}.`);
    }
  }

  if (!name || !id || !url || !access || !legalPosture) {
    return null;
  }

  return {
    id,
    name,
    url,
    ...(searchTemplate ? { searchTemplate } : {}),
    access,
    legalPosture,
    sourceClass,
    country: typeof value.country === "string" && value.country.trim() ? value.country.trim() : null,
    city: typeof value.city === "string" && value.city.trim() ? value.city.trim() : null,
    sourcePageType,
    crawlHints: parseStringArray(value.crawlHints) ?? [],
    authProfileId: typeof value.authProfileId === "string" && value.authProfileId.trim() ? value.authProfileId.trim() : undefined,
    enabled: value.enabled === undefined ? true : value.enabled !== false
  };
}

export function validateCustomSourcesPayload(payload: unknown, configPath = CUSTOM_SOURCES_FILE): CustomSourceValidationResult {
  const errors: string[] = [];
  const rawSources = Array.isArray(payload)
    ? payload
    : isRecord(payload) && Array.isArray(payload.sources)
      ? payload.sources
      : null;

  if (!rawSources) {
    return {
      ok: false,
      path: configPath,
      sources: [],
      errors: ["Custom sources file must be an array or an object with a sources array."]
    };
  }

  const seenIds = new Set<string>();
  const sources = rawSources
    .map((entry, index) => parseCustomSource(entry, index, seenIds, errors))
    .filter((entry): entry is CustomSourceDefinition => Boolean(entry));

  return {
    ok: errors.length === 0,
    path: configPath,
    sources,
    errors
  };
}

export function resolveCustomSourcesPath(cwd = process.cwd(), env: NodeJS.ProcessEnv = process.env): string {
  if (env.ARTBOT_SOURCES_PATH?.trim()) {
    return path.resolve(cwd, env.ARTBOT_SOURCES_PATH.trim());
  }
  if (env.ARTBOT_HOME?.trim()) {
    return path.resolve(env.ARTBOT_HOME.trim(), CUSTOM_SOURCES_FILE);
  }
  const initCwd = env.INIT_CWD?.trim();
  if (initCwd) {
    return path.resolve(initCwd, CUSTOM_SOURCES_FILE);
  }
  return path.resolve(cwd, CUSTOM_SOURCES_FILE);
}

export function loadCustomSources(configPath = resolveCustomSourcesPath()): CustomSourceValidationResult {
  if (!fs.existsSync(configPath)) {
    return {
      ok: true,
      path: configPath,
      sources: [],
      errors: []
    };
  }

  try {
    const payload = JSON.parse(fs.readFileSync(configPath, "utf-8")) as unknown;
    return validateCustomSourcesPayload(payload, configPath);
  } catch (error) {
    return {
      ok: false,
      path: configPath,
      sources: [],
      errors: [error instanceof Error ? error.message : String(error)]
    };
  }
}

function searchPathFromTemplate(template: string | undefined): string | null {
  if (!template) {
    return null;
  }
  const parsed = new URL(template);
  const markerIndex = parsed.toString().indexOf("{query}");
  if (markerIndex === -1) {
    return null;
  }
  const originLength = parsed.origin.length;
  return parsed.toString().slice(originLength, markerIndex);
}

function sourceFamilyForDefinition(definition: CustomSourceDefinition): string {
  const host = new URL(definition.url).hostname;
  return resolveFamilyPackByHost(host)?.id ?? `custom-${definition.id}`;
}

export function buildCustomSourceAdapters(sources: CustomSourceDefinition[]): SourceAdapter[] {
  return sources
    .filter((source) => source.enabled !== false)
    .map((source) => {
      const baseUrl = new URL(source.url).origin;
      const searchPath = searchPathFromTemplate(source.searchTemplate);
      const requiresAuth = source.access === "auth";
      const requiresLicense = source.access === "licensed";
      const supportedAccessModes = requiresLicense
        ? ["licensed" as const]
        : requiresAuth
          ? ["anonymous" as const, "authorized" as const, "licensed" as const]
          : ["anonymous" as const, "authorized" as const, "licensed" as const];

      return Object.assign(new GenericSourceAdapter({
        id: `custom-source-${source.id}`,
        sourceName: source.name,
        venueName: source.name,
        venueType: source.sourceClass ?? "other",
        sourcePageType: source.sourcePageType ?? "listing",
        tier: 4,
        country: source.country ?? null,
        city: source.city ?? null,
        baseUrl,
        searchPath,
        requiresAuth,
        requiresLicense,
        supportedAccessModes,
        crawlStrategies: searchPath ? ["search", "listing_to_lot"] : ["listing_to_lot", "rendered_dom"],
        capabilities: {
          version: "1",
          source_family: sourceFamilyForDefinition(source),
          access_modes: supportedAccessModes,
          browser_support: requiresAuth || requiresLicense ? "required" : "optional",
          sale_modes: ["realized", "estimate", "asking", "unknown"],
          evidence_requirements: requiresAuth || requiresLicense
            ? ["raw_snapshot", "screenshot", "manual_auth_possible"]
            : ["raw_snapshot", "screenshot"],
          structured_data_likelihood: source.sourcePageType === "lot" || source.sourcePageType === "price_db" ? "medium" : "low",
          preferred_discovery: searchPath ? "search" : "web_discovery"
        }
      }), {
        customAuthProfileId: source.authProfileId,
        customLegalPosture: source.legalPosture
      });
    });
}

export function readCustomSourcesFile(configPath = resolveCustomSourcesPath()): CustomSourcesFile {
  const loaded = loadCustomSources(configPath);
  if (!loaded.ok) {
    throw new Error(`Invalid custom sources file: ${loaded.errors.join("; ")}`);
  }
  return {
    version: 1,
    sources: loaded.sources
  };
}

export function writeCustomSourcesFile(file: CustomSourcesFile, configPath = resolveCustomSourcesPath()): void {
  const validation = validateCustomSourcesPayload(file, configPath);
  if (!validation.ok) {
    throw new Error(`Invalid custom sources file: ${validation.errors.join("; ")}`);
  }
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(
    configPath,
    `${JSON.stringify({ version: 1, sources: validation.sources }, null, 2)}\n`,
    "utf-8"
  );
}
