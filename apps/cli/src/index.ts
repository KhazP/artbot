import "dotenv/config";
import { Command } from "commander";
import { researchQuerySchema } from "@artbot/shared-types";

const apiBaseUrl = process.env.API_BASE_URL ?? "http://localhost:4000";
const apiKey = process.env.ARTBOT_API_KEY;

interface CommonOptions {
  turkeyFirst?: boolean;
  scope?: "turkey_only" | "turkey_plus_international";
  year?: string;
  medium?: string;
  title?: string;
  dateFrom?: string;
  dateTo?: string;
  imagePath?: string;
  authProfile?: string;
  cookieFile?: string;
  manualLogin?: boolean;
  allowLicensed?: boolean;
  licensedIntegrations?: string;
  heightCm?: string;
  widthCm?: string;
  depthCm?: string;
}

function toNumber(value?: string): number | undefined {
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function buildQuery(artist: string, options: CommonOptions) {
  const query = {
    artist,
    title: options.title,
    year: options.year,
    medium: options.medium,
    dimensions:
      options.heightCm || options.widthCm || options.depthCm
        ? {
            heightCm: toNumber(options.heightCm),
            widthCm: toNumber(options.widthCm),
            depthCm: toNumber(options.depthCm)
          }
        : undefined,
    imagePath: options.imagePath,
    dateRange:
      options.dateFrom || options.dateTo
        ? {
            from: options.dateFrom,
            to: options.dateTo
          }
        : undefined,
    scope: options.scope ?? "turkey_plus_international",
    turkeyFirst: options.turkeyFirst ?? true,
    authProfileId: options.authProfile,
    cookieFile: options.cookieFile,
    manualLoginCheckpoint: options.manualLogin ?? false,
    allowLicensed: options.allowLicensed ?? false,
    licensedIntegrations: options.licensedIntegrations
      ? options.licensedIntegrations.split(",").map((entry) => entry.trim())
      : []
  };

  return researchQuerySchema.parse(query);
}

async function post(path: string, payload: unknown) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apiKey ? { "x-api-key": apiKey } : {})
    },
    body: JSON.stringify(payload)
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

async function get(path: string) {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {
      ...(apiKey ? { "x-api-key": apiKey } : {})
    }
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : {};

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${JSON.stringify(data)}`);
  }

  return data;
}

const program = new Command();
program.name("artbot").description("Turkish art price research agent CLI").version("0.1.0");

const addCommonFlags = (command: Command) =>
  command
    .requiredOption("--artist <name>", "Artist name")
    .option("--title <title>", "Work title")
    .option("--year <year>", "Year")
    .option("--medium <medium>", "Medium")
    .option("--height-cm <number>", "Height in cm")
    .option("--width-cm <number>", "Width in cm")
    .option("--depth-cm <number>", "Depth in cm")
    .option("--scope <scope>", "turkey_only or turkey_plus_international")
    .option("--turkey-first", "Prioritize Turkish sources", true)
    .option("--date-from <date>", "YYYY-MM-DD")
    .option("--date-to <date>", "YYYY-MM-DD")
    .option("--image-path <path>", "Path to local image")
    .option("--auth-profile <id>", "Auth profile id")
    .option("--cookie-file <path>", "Cookie JSON file")
    .option("--manual-login", "Enable manual login checkpoint", false)
    .option("--allow-licensed", "Allow licensed integrations", false)
    .option("--licensed-integrations <list>", "Comma-separated source names");

addCommonFlags(program.command("research-artist").description("Research artist prices"))
  .action(async (options: CommonOptions & { artist: string }) => {
    const query = buildQuery(options.artist, options);
    const response = await post("/research/artist", { query });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
  });

addCommonFlags(program.command("research-work").description("Research specific work prices"))
  .requiredOption("--title <title>", "Work title")
  .action(async (options: CommonOptions & { artist: string }) => {
    const query = buildQuery(options.artist, options);
    const response = await post("/research/work", { query });
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
  });

program
  .command("run-status")
  .requiredOption("--run-id <id>", "Run identifier")
  .action(async (options: { runId: string }) => {
    const response = await get(`/runs/${options.runId}`);
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(response, null, 2));
  });

program.parseAsync(process.argv).catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
