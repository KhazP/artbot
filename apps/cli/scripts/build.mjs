import { readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "../..");
const packageJson = JSON.parse(await readFile(path.join(packageDir, "package.json"), "utf-8"));

const workspaceAliases = {
  "@artbot/browser-report": path.resolve(repoRoot, "packages/browser-report/src/index.ts"),
  "@artbot/auth-manager": path.resolve(repoRoot, "packages/auth-manager/src/index.ts"),
  "@artbot/browser-core": path.resolve(repoRoot, "packages/browser-core/src/index.ts"),
  "@artbot/extraction": path.resolve(repoRoot, "packages/extraction/src/index.ts"),
  "@artbot/normalization": path.resolve(repoRoot, "packages/normalization/src/index.ts"),
  "@artbot/observability": path.resolve(repoRoot, "packages/observability/src/index.ts"),
  "@artbot/orchestrator": path.resolve(repoRoot, "packages/orchestrator/src/index.ts"),
  "@artbot/report-generation": path.resolve(repoRoot, "packages/report-generation/src/index.ts"),
  "@artbot/shared-types": path.resolve(repoRoot, "packages/shared-types/src/index.ts"),
  "@artbot/source-adapters": path.resolve(repoRoot, "packages/source-adapters/src/index.ts"),
  "@artbot/source-registry": path.resolve(repoRoot, "packages/source-registry/src/index.ts"),
  "@artbot/storage": path.resolve(repoRoot, "packages/storage/src/index.ts"),
  "@artbot/valuation": path.resolve(repoRoot, "packages/valuation/src/index.ts")
};

await rm(path.join(packageDir, "dist"), { recursive: true, force: true });

await build({
  absWorkingDir: packageDir,
  alias: workspaceAliases,
  bundle: true,
  chunkNames: "chunks/[name]-[hash]",
  define: {
    __ARTBOT_VERSION__: JSON.stringify(packageJson.version)
  },
  entryPoints: {
    index: "src/index.ts",
    "runtime/api": "../../apps/api/src/server.ts",
    "runtime/worker": "../../apps/worker/src/index.ts"
  },
  format: "esm",
  logLevel: "info",
  outdir: "dist",
  packages: "external",
  platform: "node",
  sourcemap: true,
  splitting: true,
  target: "node18"
});

const distDir = path.join(packageDir, "dist");
const bannedBuildStrings = [
  "LM Studio base URL",
  "LM Studio URL is required.",
  "Verify LM Studio, API, worker, and auth",
  "Guided local onboarding for LM Studio"
];

async function collectFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath)));
      continue;
    }
    if (entry.isFile() && (fullPath.endsWith(".js") || fullPath.endsWith(".map"))) {
      files.push(fullPath);
    }
  }
  return files;
}

const distFiles = await collectFiles(distDir);
const violations = [];
for (const file of distFiles) {
  const content = await readFile(file, "utf-8");
  for (const bannedText of bannedBuildStrings) {
    if (content.includes(bannedText)) {
      violations.push(`${path.relative(packageDir, file)} => ${bannedText}`);
    }
  }
}

if (violations.length > 0) {
  throw new Error(`Built CLI still contains stale onboarding copy:\n${violations.join("\n")}`);
}
