import { commandHint, text } from "./helpers.js";
import type { TuiCommandState, TuiComponent } from "./types.js";

export interface CommandBarProps {
  command: TuiCommandState;
}

export const CommandBar: TuiComponent<CommandBarProps> = ({ command }) =>
  text(
    command.mode === "running"
      ? "Running pipeline..."
      : command.mode === "setup"
        ? "Setup mode — run /setup to configure"
        : "Type /research <artist> or artist name. /help for all commands.",
    command.mode === "running" ? "accent" : "muted",
    "dim"
  );

CommandBar.displayName = "CommandBar";

export function buildDefaultCommandHints(): ReturnType<typeof commandHint>[] {
  return [
    commandHint("/research <artist>", "Start artist price research"),
    commandHint("/work <artist> --title <title>", "Start work-specific research"),
    commandHint("/setup", "Verify LM Studio, API, worker, and auth"),
    commandHint("/auth", "Inspect or capture browser session state"),
    commandHint("/doctor", "Run a local environment health check"),
    commandHint("/runs", "Inspect recent or active runs")
  ];
}
