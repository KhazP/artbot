import "./warnings.js";

const EXIT_CODES = {
  API: 3
} as const;

async function main(argv = process.argv): Promise<number> {
  const { runCli } = await import("./index.js");
  return runCli(argv);
}

main(process.argv)
  .then((code) => {
    process.exit(code);
  })
  .catch((error) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(EXIT_CODES.API);
  });
