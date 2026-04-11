# Contributing to ArtBot

Thanks for contributing. This repository is released publicly, but it is maintained with a small-core workflow: clear issues, focused pull requests, and reproducible changes are the standard.

## Ways to Contribute

- Bug reports via the Bug Report issue template
- Feature requests via the Feature Request issue template
- Pull requests for fixes, docs, source adapters, and operational improvements
- Questions and broader ideas in GitHub Discussions once enabled

## Before You Open Anything

- Use **issues** for concrete bugs and scoped feature work.
- Use **discussions** for setup questions, design exploration, and usage help.
- Use **private reporting only** for security issues. See [SECURITY.md](SECURITY.md).

## Local Setup

### Prerequisites

| Requirement | Version           |
| ----------- | ----------------- |
| Node.js     | 22+               |
| pnpm        | 10.x              |
| Docker      | Recent (optional) |

### Setup

```bash
# 1. Fork and clone the repo
git clone https://github.com/KhazP/CCGAgent.git
cd CCGAgent

# 2. Install dependencies
pnpm install

# 3. Copy env config
cp .env.example .env

# 4. Build all workspaces
pnpm build

# 5. Validate locally
pnpm typecheck
pnpm test
```

## Development Workflow

- Branch from `main`.
- Keep each pull request to one logical change.
- Add or update tests when behavior changes.
- Update `README.md`, [`docs/`](/Users/alpyalay/Documents/GitHub/CCGAgent/docs), or package docs for user-visible changes.
- Do not commit secrets, local auth state, run artifacts, or generated logs.

## Pull Request Guidelines

- Keep changes focused.
- Link the issue or discussion when one exists.
- Use clear commit messages such as `fix:`, `feat:`, `docs:`, or `chore:`.
- Explain user impact, test coverage, and any follow-up work in the PR body.

## Local Quality Gates

Run these before requesting review:

```bash
pnpm typecheck
pnpm test
pnpm build
```

## Reporting Bugs

Use the **Bug Report** issue template and include:

- A minimal reproduction
- Expected versus actual behavior
- Node.js and pnpm versions
- Relevant logs, screenshots, or traces

## Requesting Features

Use the **Feature Request** issue template for scoped proposals. If the request is still exploratory, start it as a discussion first.

## Security Issues

Do **not** open a public issue for vulnerabilities. Follow [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the [Apache License 2.0](LICENSE).
