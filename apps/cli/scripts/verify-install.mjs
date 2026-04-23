import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "artbot-verify-"));
const packDir = path.join(tempRoot, "pack");
const installDir = path.join(tempRoot, "install");
const cacheDir = path.join(tempRoot, "npm-cache");
const artbotHome = path.join(tempRoot, "home");
const apiPort = 4100 + Math.floor(Math.random() * 200);
const apiBaseUrl = `http://127.0.0.1:${apiPort}`;

await mkdir(packDir, { recursive: true });
await mkdir(installDir, { recursive: true });
await mkdir(cacheDir, { recursive: true });
await mkdir(artbotHome, { recursive: true });

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? packageDir,
    env: {
      ...process.env,
      ...options.env
    },
    encoding: "utf-8",
    stdio: "pipe"
  });

  if (result.status !== 0) {
    const summary = [`Command failed: ${command} ${args.join(" ")}`];
    if (result.stdout.trim().length > 0) {
      summary.push(`stdout:\n${result.stdout.trim()}`);
    }
    if (result.stderr.trim().length > 0) {
      summary.push(`stderr:\n${result.stderr.trim()}`);
    }
    throw new Error(summary.join("\n\n"));
  }

  return result.stdout.trim();
}

async function main() {
  const npmEnv = {
    npm_config_cache: cacheDir,
    PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: "1"
  };
  const cliEnv = {
    ARTBOT_HOME: artbotHome,
    INIT_CWD: "",
    ARTBOT_ROOT: "",
    RUNS_ROOT: "",
    DATABASE_PATH: ""
  };

  run("npm", ["pack", "--pack-destination", packDir], { env: npmEnv });

  const tarballs = (await readdir(packDir)).filter((entry) => entry.endsWith(".tgz"));
  if (tarballs.length !== 1) {
    throw new Error(`Expected exactly one tarball in ${packDir}, found ${tarballs.length}.`);
  }

  const tarballPath = path.join(packDir, tarballs[0]);
  run("npm", ["install", "--prefix", installDir, tarballPath], { env: npmEnv });

  const cliEntry = path.join(installDir, "node_modules", "artbot", "bin", "artbot.cjs");

  run(process.execPath, [cliEntry, "--help"], {
    cwd: tempRoot,
    env: cliEnv
  });

  run(process.execPath, [cliEntry, "trust", "allow"], {
    cwd: tempRoot,
    env: cliEnv
  });

  try {
    run(process.execPath, [cliEntry, "--api-base-url", apiBaseUrl, "backend", "start"], {
      cwd: tempRoot,
      env: cliEnv
    });

    const statusRaw = run(process.execPath, [cliEntry, "--json", "--api-base-url", apiBaseUrl, "backend", "status"], {
      cwd: tempRoot,
      env: cliEnv
    });
    const status = JSON.parse(statusRaw);
    if (!status.apiHealth?.ok) {
      throw new Error(`Local backend failed health check: ${statusRaw}`);
    }

    const runsRaw = run(process.execPath, [cliEntry, "--json", "--api-base-url", apiBaseUrl, "runs", "list"], {
      cwd: tempRoot,
      env: cliEnv
    });
    const runsPayload = JSON.parse(runsRaw);
    if (!Array.isArray(runsPayload.runs)) {
      throw new Error(`Unexpected runs payload: ${runsRaw}`);
    }
  } finally {
    try {
      run(process.execPath, [cliEntry, "--api-base-url", apiBaseUrl, "backend", "stop"], {
        cwd: tempRoot,
        env: cliEnv
      });
    } catch {
      // Best-effort cleanup for detached processes.
    }
  }
}

try {
  await main();
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}
