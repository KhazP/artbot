<div align="center">

<img src="https://i.imgur.com/Nrxm4Ih.png" alt="artbot banner" width="100%" />
<br />

**Production-oriented, painting price research bot**<br/>
_Session-aware extraction · Evidence capture · Strict structured outputs_

[![Node.js](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)](https://nodejs.org/)
[![pnpm](https://img.shields.io/badge/pnpm-10.x-F69220?logo=pnpm&logoColor=white)](https://pnpm.io/)
[![npm version](https://img.shields.io/npm/v/artbot?logo=npm)](https://www.npmjs.com/package/artbot)
[![npm downloads](https://img.shields.io/npm/dm/artbot?logo=npm)](https://www.npmjs.com/package/artbot)
[![CI](https://github.com/KhazP/artbot/actions/workflows/ci.yml/badge.svg)](https://github.com/KhazP/artbot/actions/workflows/ci.yml)
[![GitHub Stars](https://img.shields.io/github/stars/KhazP/artbot?style=social)](https://github.com/KhazP/artbot)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Docker](https://img.shields.io/badge/Docker-ready-2496ED?logo=docker&logoColor=white)](#-docker)

</div>

---

## ✨ Key Characteristics

| Area                     | Details                                                                                                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| **Runtime**              | Local-first — SQLite (`node:sqlite`) + filesystem evidence                                                                                |
| **Access Statuses**      | `public_access` · `auth_required` · `licensed_access` · `blocked` · `price_hidden`                                                        |
| **Session Handling**     | Authorized profiles, cookie injection, persistent browser state, manual-login checkpoints; expired/missing sessions refresh automatically |
| **Turkey-First Sources** | `muzayedeapp-platform` · `portakal-catalog` · `clar-buy-now` · `clar-archive` · `sanatfiyat-licensed-extractor`                           |
| **Discovery**            | Bounded query variants, listing-to-lot routing, comprehensive hybrid web discovery with strict host/domain caps                           |
| **FX Normalization**     | Nominal USD + CPI-adjusted 2026 USD outputs                                                                                               |
| **Evidence**             | Screenshot + raw snapshot + parser metadata for every accepted/rejected candidate                                                         |

### Architecture Pipeline

```mermaid
graph LR
  A[Search] --> B[Select Source]
  B --> C[Extract]
  C --> D[Verify]
  D --> E[Normalize]
  E --> F[Score]
  F --> G[Report]
```

---

## 📁 Monorepo Layout

<details>
<summary><strong>View source structure</strong></summary>

```
turkish-art-price-agent/
├── apps/
│   ├── api/             # HTTP API (POST /research/artist, POST /research/work, GET /runs, GET /runs/:id)
│   ├── worker/          # Background run processor
│   └── cli/             # Command-line client
├── packages/            # Typed domain modules
│   ├── auth/            #   Authentication & session management
│   ├── adapters/        #   Source adapters
│   ├── extraction/      #   Data extraction
│   ├── normalization/   #   Price & FX normalization
│   ├── valuation/       #   Valuation logic
│   ├── reporting/       #   Report generation
│   ├── storage/         #   Persistence layer
│   └── orchestration/   #   Pipeline orchestration
├── docs/                # Architecture, ops, source matrix, eval protocol, roadmap
├── data/
│   ├── fixtures/        # Eval inputs
│   └── golden-results/  # Sample outputs
├── var/                 # Local runtime artifacts (DB, runs, logs)
└── ...
```
</details>

---

## 🚀 Quick Start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment config
cp .env.example .env

# 3. Build all workspaces
pnpm build

# 4. Start everything (API + worker + CLI)
pnpm run start:artbot

# 5. Check a run's status
pnpm --filter artbot dev -- runs show --run-id <id>

# 6. Watch a run in real time
pnpm --filter artbot dev -- runs watch --run-id <id> --interval 2

# 7. Open the interactive UI explicitly
pnpm --filter artbot dev -- tui
```

---

## 📦 Install From npm

```bash
npm install -g artbot
artbot
artbot tui
artbot setup
artbot backend status
artbot research artist --artist "Burhan Dogancay" --wait
```

> [!NOTE]
> The npm package includes a local ArtBot API and worker runtime — **no hosting required**.
> Config, auth state, logs, and local data live under `~/.artbot`.
>
> [LM Studio](https://lmstudio.ai/) works out of the box with the default local server URL `http://127.0.0.1:1234/v1`.

Bare `artbot` is help-first. Use `artbot tui` only when you explicitly want the interactive UI.

<details>
<summary><strong>Alternative manual startup</strong></summary>

```bash
pnpm --filter @artbot/api start
pnpm --filter @artbot/worker start
pnpm --filter artbot dev
```

</details>

---

## 🔐 Session-Aware CLI Flags

| Flag                                                            | Description                      |
| --------------------------------------------------------------- | -------------------------------- |
| `--auth-profile <id>`                                           | Use a named auth profile         |
| `--cookie-file <path>`                                          | Path to cookie JSON file         |
| `--manual-login`                                                | Pause for manual browser login   |
| `--allow-licensed`                                              | Enable licensed source access    |
| `--licensed-integrations "askART,..."`                          | Comma-separated licensed sources |
| `--analysis-mode comprehensive\|balanced\|fast`                 | Analysis depth                   |
| `--price-normalization legacy\|usd_dual\|usd_nominal\|usd_2026` | Price output format              |

---

## 💻 CLI v2 Commands

```bash
# Research
artbot research artist --artist "Fikret Muallâ" --wait
artbot research work --artist "Bedri Rahmi Eyüboğlu" --title "Mosaic" --wait

# Run management
artbot runs list [--status pending|running|completed|failed --limit 20]
artbot runs show --run-id <id>
artbot runs watch --run-id <id> [--interval 2]
artbot runs pin --run-id <id>
artbot runs unpin --run-id <id>

# Storage visibility and cleanup
artbot storage
artbot cleanup --dry-run
artbot cleanup --max-size-gb 4 --keep-last 50
artbot runs pin --run-id <id>  # preserve a run before cleanup
```

> [!NOTE]
> **Legacy aliases** (`research-artist`, `research-work`, `run-status`) remain available.

**Global options:**

| Option                 | Description                   |
| ---------------------- | ----------------------------- |
| `--json`               | Strict JSON on stdout         |
| `--api-base-url <url>` | API endpoint override         |
| `--api-key <key>`      | Authentication key            |
| `--verbose`            | Verbose logging               |
| `--quiet`              | Suppress non-essential output |
| `--no-tui`             | Block interactive UI launch   |

**Environment fallback:** `API_BASE_URL` (defaults to `http://localhost:4000`)

**Automation guardrail:** `ARTBOT_NO_TUI=1` disables interactive UI launch.

## 🤖 Command-First Agent Usage

For agent and automation work, prefer the repo-local CLI entrypoint plus `--json`:

```bash
pnpm --filter artbot dev -- --json doctor
pnpm --filter artbot dev -- --json backend status
pnpm --filter artbot dev -- --json auth list
pnpm --filter artbot dev -- --json auth status
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --preview-only
pnpm --filter artbot dev -- --json research artist --artist "Burhan Dogancay" --wait
pnpm --filter artbot dev -- --json runs show --run-id <id>
pnpm --filter artbot dev -- --json replay attempt --run-id <id>
pnpm --filter artbot dev -- --json runs pin --run-id <id>
pnpm --filter artbot dev -- --json runs unpin --run-id <id>
pnpm --filter artbot dev -- --json storage
pnpm --filter artbot dev -- --json cleanup --dry-run
```

Repo instruction files are committed at the root:

- `AGENTS.md`
- `CLAUDE.md`
- `GEMINI.md`

The reusable Codex skill lives at `skills/artbot-cli`.

Install it explicitly into Codex from a clone by copying or symlinking `skills/artbot-cli` into `~/.codex/skills/artbot-cli`, or use your normal GitHub-path skill installer flow. The npm package does not auto-write into `$CODEX_HOME`.

---

## 🔑 Auth Profile Configuration

Set `AUTH_PROFILES_JSON` in your environment:

```json
[
  {
    "id": "artsy-profile",
    "mode": "authorized",
    "sourcePatterns": ["artsy"],
    "cookieFile": "/secure/path/artsy-cookies.json"
  },
  {
    "id": "sanatfiyat-license",
    "mode": "licensed",
    "sourcePatterns": ["sanatfiyat"],
    "storageStatePath": "/secure/path/sanatfiyat-state.json"
  }
]
```

---

## 📂 Output Artifacts

Each run produces a structured evidence directory:

<details>
<summary><strong>View evidence structure</strong></summary>

```
var/runs/<run_id>/
├── results.json
├── report.md
└── evidence/
    ├── screenshots/       # Page captures
    ├── raw/               # Raw snapshots
    ├── traces/            # (selective mode) Playwright traces
    └── har/               # (selective mode) HAR archives
```

> [!NOTE]
> Attempt-level auth evidence fields (`pre_auth_screenshot_path`, `post_auth_screenshot_path`) are included when auth flows are used.
</details>

---

## 🤖 Model Policy

| Variable                  | Purpose                                            |
| ------------------------- | -------------------------------------------------- |
| `MODEL_CHEAP_DEFAULT`     | Default model ID                                   |
| `MODEL_CHEAP_FALLBACK`    | Fallback model ID                                  |
| `STRUCTURED_LLM_PROVIDER` | `auto` \| `gemini` \| `openai_compatible`          |
| `LLM_BASE_URL`            | Local OpenAI-compatible endpoint (e.g., LM Studio) |
| `GEMINI_API_KEY`          | Gemini API key                                     |

> [!WARNING]
> No hard-model escalation path is enabled in v1.

---

## 💰 Cost & Reliability Policy

1. **Deterministic parser path first** — always prefer structured parsing over LLM extraction.
2. **Firecrawl only when configured and useful** — not a default dependency.
3. **Browser verification only when needed** — auth/session requirements or low-confidence results.
4. **No brute force, credential stuffing, or unauthorized bypass behavior.**

---

## 🧪 Testing

```bash
pnpm test
```

Coverage includes:

- Access status transitions
- Auth/session helper behavior
- Redaction
- Normalization + deduplication
- Adapter access-mode behavior

---

## 🐳 Docker

```bash
# Build the image
docker build -t turkish-art-price-agent .

# Or use Docker Compose
docker compose up --build
```

---

## 🛠 Development

| Requirement | Version                        |
| ----------- | ------------------------------ |
| Node.js     | 22+                            |
| pnpm        | 10.x                           |
| Docker      | Recent (optional, recommended) |

```bash
pnpm install          # Install dependencies
pnpm build            # Compile all workspaces
pnpm dev              # Start dev servers (where supported)
pnpm test             # Run monorepo test suite
```

---

## 📚 Documentation

- [Docs Index](docs/README.md)
- [Changelog](CHANGELOG.md)

---

## 🤝 Community

- Contribution guide: [.github/CONTRIBUTING.md](.github/CONTRIBUTING.md)
- Support channels: [.github/SUPPORT.md](.github/SUPPORT.md)
- Security reporting: [.github/SECURITY.md](.github/SECURITY.md)

---

## 🤝 Contributing

Issues and pull requests are welcome! When opening a PR, please:

- **Keep changes focused** and reasonably small.
- **Add or update tests** when behavior changes.
- **Update documentation** (this README or `docs/*`) when you change user-visible behavior.

---

## 🛡 Security & Responsible Use

This project automates browsing and data collection. When using it, **you are responsible for**:

- Respecting each site's **terms of service** and **robots.txt** guidance.
- Using only accounts and licenses **you are authorized to use**.
- Avoiding abusive traffic patterns or attempts to bypass access controls.

> [!IMPORTANT]
> 🔒 **Found a security issue?** Please open a private issue or contact the maintainer directly — do not disclose publicly first.

---

## 📄 License

Licensed under the **Apache License, Version 2.0**.
See the [LICENSE](LICENSE) file for the full text.
