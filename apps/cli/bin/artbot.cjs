#!/usr/bin/env node

(async () => {
  try {
    const { runCli } = await import("../dist/index.js");
    process.exitCode = await runCli(process.argv);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
