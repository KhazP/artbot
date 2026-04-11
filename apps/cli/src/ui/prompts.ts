import * as clack from "@clack/prompts";
import picocolors from "picocolors";

export type ResearchType = "quick" | "full" | "both";

export async function promptSearchQuery(): Promise<string | null> {
  const value = await clack.text({
    message: "What would you like to research?",
    placeholder: "Enter an artist name or artwork title...",
    validate(input) {
      if (input.trim().length < 2) return "Please enter at least 2 characters.";
    },
  });

  if (clack.isCancel(value)) return null;
  return value.trim();
}

export async function promptResearchType(): Promise<ResearchType | null> {
  const value = await clack.select({
    message: "What type of research?",
    options: [
      {
        value: "quick" as const,
        label: `${picocolors.cyan("Quick AI Summary")}`,
        hint: "instant, uses local AI",
      },
      {
        value: "full" as const,
        label: `${picocolors.yellow("Full Price Research")}`,
        hint: "queues a background job via API",
      },
      {
        value: "both" as const,
        label: `${picocolors.magenta("Both")}`,
        hint: "AI summary now + price research queued",
      },
    ],
  });

  if (clack.isCancel(value)) return null;
  return value;
}

export async function promptLaunchPipeline(): Promise<boolean> {
  const value = await clack.confirm({
    message: "Launch full price research pipeline?",
  });

  if (clack.isCancel(value)) return false;
  return value;
}

export async function promptContinueOrExit(): Promise<"continue" | "exit"> {
  const value = await clack.select({
    message: "What next?",
    options: [
      { value: "continue" as const, label: "Research another artist" },
      { value: "exit" as const, label: "Exit" },
    ],
  });

  if (clack.isCancel(value)) return "exit";
  return value;
}
