# Contributing to ArtBot

Thank you for your interest in contributing! This guide covers everything you need to get started.

## Ways to Contribute

- **Bug reports** — open an issue using the Bug Report template
- **Feature requests** — open an issue using the Feature Request template
- **Pull requests** — fixes, improvements, new source adapters
- **Documentation** — improve README, `docs/`, or inline comments

## Getting Started

### Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 22+ |
| pnpm | 10.x |
| Docker | Recent (optional) |

### Setup

```bash
# 1. Fork and clone the repo
git clone https://github.com/<your-username>/artbot.git
cd artbot

# 2. Install dependencies
pnpm install

# 3. Copy env config
cp .env.example .env

# 4. Build all workspaces
pnpm build

# 5. Run tests
pnpm test
```

## Pull Request Guidelines

- **Keep changes focused** — one logical change per PR.
- **Add or update tests** when behaviour changes.
- **Update documentation** (README or `docs/*`) for user-visible changes.
- **Pass all tests** — `pnpm test` must be green before requesting review.
- **Use conventional commits** — e.g. `fix: ...`, `feat: ...`, `docs: ...`, `chore: ...`

## Code Style

The project uses TypeScript with strict settings. Run the type checker with:

```bash
pnpm build
```

## Reporting Bugs

Please use the **Bug Report** issue template. Include:
- Steps to reproduce
- Expected vs actual behaviour
- Node.js and pnpm versions
- Relevant log output

## Requesting Features

Please use the **Feature Request** issue template. Describe:
- The problem you're trying to solve
- Your proposed solution
- Any alternatives you considered

## Security Issues

Do **not** open a public issue for security vulnerabilities. Please follow the process in [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
