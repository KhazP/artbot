const SQLITE_WARNING_FILTER_FLAG = "__ARTBOT_SQLITE_WARNING_FILTER_INSTALLED__";

function shouldSuppressSqliteExperimentalWarning(warning: unknown, args: unknown[]): boolean {
  const warningName =
    typeof warning === "object" && warning && "name" in warning && typeof (warning as { name?: unknown }).name === "string"
      ? (warning as { name: string }).name
      : typeof args[0] === "string"
        ? args[0]
        : "";
  const warningMessage =
    typeof warning === "string"
      ? warning
      : typeof warning === "object" && warning && "message" in warning && typeof (warning as { message?: unknown }).message === "string"
        ? (warning as { message: string }).message
        : "";

  return warningName === "ExperimentalWarning" && /node:sqlite|SQLite is an experimental feature/i.test(warningMessage);
}

export function installSqliteWarningFilter(): void {
  const markerProcess = process as NodeJS.Process & Record<string, unknown>;
  if (markerProcess[SQLITE_WARNING_FILTER_FLAG]) return;

  const originalEmitWarning = process.emitWarning.bind(process);
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (shouldSuppressSqliteExperimentalWarning(warning, args)) {
      return;
    }
    (originalEmitWarning as (...innerArgs: unknown[]) => void)(warning, ...args);
  }) as typeof process.emitWarning;
  markerProcess[SQLITE_WARNING_FILTER_FLAG] = true;
}

installSqliteWarningFilter();
