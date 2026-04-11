import figlet from "figlet";
import gradient from "gradient-string";
import boxen from "boxen";
import picocolors from "picocolors";

const ART_GRADIENT = gradient(["#06b6d4", "#8b5cf6", "#ec4899"]);

export function renderHeader(): string {
  const cols = process.stdout.columns ?? 80;

  let banner: string;
  if (cols >= 70) {
    banner = figlet.textSync("ARTBOT", { font: "ANSI Shadow", horizontalLayout: "fitted" });
  } else if (cols >= 50) {
    banner = figlet.textSync("ARTBOT", { font: "Standard" });
  } else {
    banner = "  A R T B O T";
  }

  const coloredBanner = ART_GRADIENT(banner);
  const tagline = picocolors.dim("  Turkish Art Price Research Agent  v0.2.0");

  const content = `${coloredBanner}\n${tagline}`;

  return boxen(content, {
    padding: { top: 1, bottom: 1, left: 2, right: 2 },
    borderStyle: "round",
    borderColor: "cyan",
  });
}
