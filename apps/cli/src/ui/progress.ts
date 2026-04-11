import ora from "ora";
import picocolors from "picocolors";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface ResearchPhase {
  text: string;
  duration?: number;
  spinner?: "dots" | "arc" | "bouncingBar" | "dots2";
}

export async function showPhase(text: string, durationMs: number, spinnerType: "dots" | "arc" | "bouncingBar" = "dots"): Promise<void> {
  const spinner = ora({ text, spinner: spinnerType }).start();
  await sleep(durationMs);
  spinner.stop();
}

export async function showConnecting(query: string): Promise<void> {
  const spinner = ora({ text: picocolors.dim("Connecting to AI..."), spinner: "dots" }).start();
  await sleep(600);
  spinner.text = `Researching ${picocolors.cyan(picocolors.bold(query))}...`;
  spinner.spinner = "arc";
  await sleep(400);
  spinner.stop();
}

export function createStreamSpinner(query: string): { start: () => void; stop: () => void } {
  const spinner = ora({
    text: `Generating summary for ${picocolors.cyan(query)}...`,
    spinner: "bouncingBar",
  });
  return {
    start: () => { spinner.start(); },
    stop: () => { spinner.stop(); },
  };
}

export async function showPipelineProgress(
  apiBaseUrl: string,
  runId: string,
  apiKey: string | undefined,
  intervalMs: number,
): Promise<{ status: string; details: unknown }> {
  const stages = [
    { key: "queued", label: "Job queued", done: true },
    { key: "scanning", label: "Scanning sources", done: false },
    { key: "analyzing", label: "Analyzing results", done: false },
    { key: "reporting", label: "Generating report", done: false },
  ];

  const spinner = ora({ text: renderStages(stages, 1), spinner: "dots" }).start();

  while (true) {
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (apiKey) headers["x-api-key"] = apiKey;

    const response = await fetch(`${apiBaseUrl}/runs/${runId}`, { headers });
    if (!response.ok) {
      spinner.fail(`Failed to fetch run status (${response.status})`);
      return { status: "failed", details: null };
    }

    const details = (await response.json()) as { run: { status: string } };
    const status = details.run.status;

    if (status === "running") {
      stages[1].done = true;
      spinner.text = renderStages(stages, 2);
    }

    if (status === "completed") {
      stages[1].done = true;
      stages[2].done = true;
      stages[3].done = true;
      spinner.succeed(renderStages(stages, 4));
      return { status, details };
    }

    if (status === "failed") {
      spinner.fail(`Run ${runId} failed`);
      return { status, details };
    }

    await sleep(intervalMs);
  }
}

function renderStages(stages: Array<{ label: string; done: boolean }>, activeIndex: number): string {
  return stages
    .map((stage, i) => {
      if (stage.done) return `${picocolors.green("✔")} ${stage.label}`;
      if (i === activeIndex) return `${picocolors.yellow("◐")} ${stage.label}...`;
      return `${picocolors.dim("○")} ${stage.label}`;
    })
    .join("  ");
}
