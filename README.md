# Ploy for gyms

AI website builder for gyms and fitness studios. A lightweight, fitness-specific take on [Ploy](https://ploy.ai/).

## Architecture

- `apps/api` — Fastify 5 backend with Kysely, BullMQ, and Zod/OpenAPI.
- `apps/workspace` — Vite + React + Tailwind workspace SPA.
- `apps/renderer` — Astro 5 static site renderer with React islands.
- `packages/shared-types` — Zod contracts shared across apps.
- `packages/ai-specs` — Component AI generation specs.

## Quick start

```bash
# 1. Install dependencies
pnpm install

# 2. Copy environment file
cp .env.sample .env

# 3. Start local infrastructure
docker compose up -d

# 4. Start all apps in dev mode
pnpm dev
```

- API: http://localhost:3000
- Workspace SPA: http://localhost:5173
- Renderer preview: http://localhost:4321
- API docs: http://localhost:3000/docs

## Development commands

```bash
pnpm dev          # start all apps via turbo
pnpm build        # build all apps
pnpm lint         # lint all apps
pnpm test         # run tests
pnpm migrate      # run database migrations
```
