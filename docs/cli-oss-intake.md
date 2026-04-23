# ArtBot OSS CLI Intake Matrix

Selective ports only. ArtBot keeps its own `commander` + `ink` surface and local-first runtime. This matrix is for borrowing patterns, not importing whole external CLIs into the product.

## Scoring

- `License`: whether ArtBot can safely borrow code or patterns.
- `Dependency weight`: `low`, `medium`, or `high` if ArtBot copied runtime code.
- `Portability`: how directly the idea maps onto the current TypeScript CLI.
- `ArtBot fit`: how useful the pattern is for operator, agent, or local-first workflows.
- `Decision`: `direct port`, `behavior port`, or `reject`.

## Matrix

| Project | License | Useful pattern | Dependency weight | Portability | ArtBot fit | Decision | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [google-gemini/gemini-cli](https://github.com/google-gemini/gemini-cli) | Apache-2.0 | session resume, trust posture, terminal-first agent flows, MCP-aware operator ergonomics | medium | high | high | behavior port | Good source for session/trust UX. Do not inherit cloud-first assumptions or vendor-specific model flows. |
| [vercel-labs/skills](https://github.com/vercel-labs/skills) | MIT | explicit project-vs-global install flows, agent-targeted skill install docs, local path install UX | low | high | high | behavior port | Strong fit for ArtBot repo skills. Do not ship a generic skill package manager inside ArtBot. |
| [cli/cli](https://github.com/cli/cli) | MIT | scoped help, stable command naming, clear machine-readable output expectations | medium | high | high | behavior port | Good model for subcommand help and automation-safe CLI contracts. |
| [charmbracelet/crush](https://github.com/charmbracelet/crush) | FSL-1.1-MIT | multi-session terminal workflows, project context continuity | high | medium | medium | behavior port | Useful session ideas, but not a code-vendoring target because the stack and license shape do not match ArtBot. |
| [charmbracelet/gum](https://github.com/charmbracelet/gum) | MIT | explicit small utilities for prompts, tables, and confirmation UX | low | medium | medium | direct port for ideas only | Treat as inspiration for focused interactions, not a runtime dependency inside ArtBot. |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | Apache-2.0 | large-repo session continuity, terminal-first automation, codebase memory patterns | high | low | medium | behavior port | Useful for agent workflow ideas. Not a direct UI/component source for ArtBot’s operator CLI. |

## What ArtBot Should Reuse

- Machine-output contracts: predictable `json` and `stream-json` modes, no stdout preamble.
- Resume affordances: explicit local `sessions list|resume|prune`.
- Trust gating: explicit `trust status|allow|deny` before local-service or browser-affecting actions.
- Skill distribution: documented copy/symlink install flows from clone path, plus agent-target notes.
- Help quality: clear subcommand descriptions and next-step hints.

## What ArtBot Should Not Import

- Generic upstream package managers or marketplace flows.
- Cloud-vendor telemetry or account assumptions.
- Non-Node runtime stacks just to borrow UI widgets.
- Hidden side effects during npm install for agent-skill setup.
