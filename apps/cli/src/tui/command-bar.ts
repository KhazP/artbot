import { translate, type AppLocale } from "../i18n.js";
import { commandHint, text } from "./helpers.js";
import type { TuiCommandState, TuiComponent } from "./types.js";

export interface CommandBarProps {
  command: TuiCommandState;
  locale?: AppLocale;
}

export const CommandBar: TuiComponent<CommandBarProps> = ({ command, locale = "en" }) =>
  text(
    command.mode === "running"
      ? translate(locale, "tui.command.running")
      : command.mode === "setup"
        ? translate(locale, "tui.command.setup")
        : translate(locale, "tui.command.idle"),
    command.mode === "running" ? "accent" : "muted",
    "dim"
  );

CommandBar.displayName = "CommandBar";

export function buildDefaultCommandHints(locale: AppLocale = "en"): ReturnType<typeof commandHint>[] {
  return [
    commandHint("/research <artist>", translate(locale, "tui.commandHint.research")),
    commandHint("/work <artist> --title <title>", translate(locale, "tui.commandHint.work")),
    commandHint("/setup", translate(locale, "tui.commandHint.setup")),
    commandHint("/auth", translate(locale, "tui.commandHint.auth")),
    commandHint("/doctor", translate(locale, "tui.commandHint.doctor")),
    commandHint("/runs", translate(locale, "tui.commandHint.runs"))
  ];
}
