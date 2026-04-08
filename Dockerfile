FROM node:22-alpine

RUN corepack enable
WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json .
COPY apps ./apps
COPY packages ./packages
COPY data ./data
COPY docs ./docs
COPY .env.example ./.env.example
COPY README.md ./README.md

RUN pnpm install --no-frozen-lockfile
RUN pnpm build

EXPOSE 4000

CMD ["pnpm", "--filter", "@artbot/api", "start"]
