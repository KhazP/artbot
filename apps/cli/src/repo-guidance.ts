import fs from "node:fs";
import path from "node:path";
import { detectWorkspaceRoot } from "./setup/env.js";

export interface RepoGuidanceEntry {
  kind: "agent_doc" | "skill";
  name: string;
  path: string;
}

export interface RepoGuidanceReport {
  workspaceRoot: string | null;
  entries: RepoGuidanceEntry[];
}

export function detectRepoGuidance(cwd = process.cwd()): RepoGuidanceReport {
  const workspaceRoot = detectWorkspaceRoot(cwd);
  const root = workspaceRoot ?? path.resolve(cwd);
  const candidates: Array<Omit<RepoGuidanceEntry, "path"> & { relativePath: string }> = [
    { kind: "agent_doc", name: "AGENTS.md", relativePath: "AGENTS.md" },
    { kind: "agent_doc", name: "CLAUDE.md", relativePath: "CLAUDE.md" },
    { kind: "agent_doc", name: "GEMINI.md", relativePath: "GEMINI.md" },
    { kind: "skill", name: "artbot-cli", relativePath: "skills/artbot-cli/SKILL.md" },
    { kind: "skill", name: "artbot-cli-openai", relativePath: "skills/artbot-cli/agents/openai.yaml" }
  ];

  return {
    workspaceRoot,
    entries: candidates
      .map((candidate) => {
        const absolutePath = path.resolve(root, candidate.relativePath);
        if (!fs.existsSync(absolutePath)) {
          return null;
        }
        return {
          kind: candidate.kind,
          name: candidate.name,
          path: absolutePath
        } satisfies RepoGuidanceEntry;
      })
      .filter((entry): entry is RepoGuidanceEntry => Boolean(entry))
  };
}
