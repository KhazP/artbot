#!/usr/bin/env node

const originalEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...args) => {
  const warningName =
    typeof warning === "object" && warning && typeof warning.name === "string"
      ? warning.name
      : typeof args[0] === "string"
        ? args[0]
        : "";
  const warningMessage =
    typeof warning === "string"
      ? warning
      : typeof warning === "object" && warning && typeof warning.message === "string"
        ? warning.message
        : "";

  if (warningName === "ExperimentalWarning" && /node:sqlite|SQLite is an experimental feature/i.test(warningMessage)) {
    return;
  }

  originalEmitWarning(warning, ...args);
};

(async () => {
  try {
    const { runCli } = await import("../dist/index.js");
    process.exitCode = await runCli(process.argv);
  } catch (error) {
    console.error(error);
    process.exitCode = 1;
  }
})();
