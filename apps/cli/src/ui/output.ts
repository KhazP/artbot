import boxen from "boxen";
import picocolors from "picocolors";

const CHAR_DELAY = 8;
const HEADER_DELAY = 24;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function typewrite(
  text: string,
  writer: (chunk: string) => void,
  options?: { fast?: boolean },
): Promise<void> {
  if (options?.fast) {
    writer(text);
    return;
  }

  let inHeader = false;
  for (const char of text) {
    writer(char);
    if (char === "#") {
      inHeader = true;
    } else if (char === "\n") {
      inHeader = false;
    }
    const delay = inHeader ? HEADER_DELAY : CHAR_DELAY;
    if (char !== " " && char !== "\n") {
      await sleep(delay);
    }
  }
}

export function renderSection(title: string, content: string): string {
  const header = picocolors.cyan(picocolors.bold(title));
  return boxen(`${header}\n\n${content}`, {
    padding: { top: 0, bottom: 0, left: 1, right: 1 },
    borderStyle: "round",
    borderColor: "cyan",
    dimBorder: true,
  });
}

function parseSections(text: string): Array<{ title: string; body: string }> {
  const sections: Array<{ title: string; body: string }> = [];
  const lines = text.split("\n");
  let currentTitle = "";
  let currentBody: string[] = [];

  for (const line of lines) {
    const headerMatch = line.match(/^##\s+(.+)/);
    if (headerMatch) {
      if (currentTitle) {
        sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
      }
      currentTitle = headerMatch[1];
      currentBody = [];
    } else {
      currentBody.push(line);
    }
  }

  if (currentTitle) {
    sections.push({ title: currentTitle, body: currentBody.join("\n").trim() });
  }

  if (sections.length === 0 && text.trim()) {
    sections.push({ title: "Research Results", body: text.trim() });
  }

  return sections;
}

export async function streamToDisplay(
  generator: AsyncGenerator<string>,
  writer: (chunk: string) => void,
): Promise<string> {
  let fullText = "";

  for await (const chunk of generator) {
    fullText += chunk;
    writer(chunk);
  }

  return fullText;
}

export function renderFormattedResult(text: string): string {
  const sections = parseSections(text);
  return sections.map((s) => renderSection(s.title, s.body)).join("\n");
}

export function renderDisclaimer(): string {
  return picocolors.dim("  AI-generated summary. Verify facts before use.\n");
}
