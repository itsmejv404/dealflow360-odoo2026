# AGENTS.md — DealFlow360

Guidance for coding agents working in this repo. Read `milestones.md` (24-phase plan) and `workflow.md` (product spec) before building features.

## Stack & shape

- **Monorepo** via npm workspaces: `apps/*`, `packages/*`. Root `package.json` is private and only orchestrates.
- **api** (`apps/api`, `@dealflow/api`): Node 24 + Express 4 + TypeScript (ESM, `"type": "module"`). Modular monolith.
- **workspace** (`apps/workspace`, `@dealflow/workspace`): Vue 3 + Vite + vue-router + **shadcn-vue** (Tailwind v4, reka-ui). Internal app.
- **portal** (`apps/portal`): second Vue app — **does not exist yet**; scaffold it in Phase 13.
- Postgres 16 (Prisma), Redis 7 (ioredis; BullMQ later), MinIO (AWS SDK v3, path-style), Mailhog, Nginx.
- Everything runs in Docker with hot reload (`tsx watch`, `vite --host`). Repo is bind-mounted at `/repo`; root `node_modules` is a named volume shared by containers.
- **No init containers on purpose**: `npm install`, `prisma generate`, MinIO bucket creation, and `migrate deploy` are manual steps — see `SETUP.md`. Compose only starts long-running services.

## Commands (host)

- Boot: `docker compose up -d` · Stop: `docker compose down` · Reset: `docker compose down -v` (then redo SETUP.md)
- First-time/reset setup: follow `SETUP.md` (`npm run setup:install`, `setup:generate`, `setup:bucket`, `migrate:deploy`)
- Prisma (inside api container): `npm run migrate -- --name <name>` · apply: `npm run migrate:deploy` · status: `npm run migrate:status`
- Typecheck all: `docker compose exec api npm run typecheck` (root script runs it for every workspace)

## API module conventions

Module-per-domain under `apps/api/src/modules/<domain>/`:

```
<domain>.routes.ts      # Router, wires HTTP verbs to controller
<domain>.controller.ts  # request/response only, no business logic
<domain>.service.ts     # business logic + data access
```

- Register each module's router in `src/app.ts` (the module registry), mounted under `/api/<domain>`.
- Shared infra lives in `src/lib/` (`prisma.ts`, `redis.ts`, `minio.ts`, `logger.ts`) — import singletons, never re-instantiate clients.
- Cross-cutting middleware (errors now; tenant context + auth later) in `src/shared/`.
- Env is parsed once with zod in `src/config/env.ts`; never read `process.env` directly elsewhere.
- ESM imports of local files must include the `.js` extension (e.g. `import { env } from '../config/env.js'`).

## Workspace UI conventions

- UI components come from **shadcn-vue** (style `new-york`, neutral base color, CSS variables). Never hand-roll primitives — add them via the CLI inside the container:
  `docker compose exec -w /repo/apps/workspace workspace npx shadcn-vue@latest add <component>`
- Generated components live in `src/components/ui/<name>/`; import via the `@` alias (`import { Button } from '@/components/ui/button'`).
- Tailwind v4 (CSS-first config, `@tailwindcss/vite`). Theme tokens are CSS variables in `src/assets/index.css`; `@theme inline` maps them, so `--color-*` vars intentionally don't appear in compiled output.
- Path alias `@` → `src` is configured in both `vite.config.ts` and `tsconfig.json`.
- Class merging helper: `cn()` from `@/lib/utils` (clsx + tailwind-merge).
- Icons: `lucide-vue-next`.

## Migrations

- Prisma migrations in `apps/api/prisma/migrations/`, applied **manually** with `npm run migrate:deploy` (see SETUP.md) — nothing auto-migrates at boot.
- The `000000000000_init` baseline proves tooling only; real schema starts Phase 2.

## Multi-tenancy rules (from Phase 2 onward — non-negotiable)

1. Every business table: `organization_id NOT NULL` + index; tenant-local FKs.
2. No handler queries without tenant-context middleware; super-admin endpoints under `/platform` with their own guard.
3. JWTs: internal `{ org_id, role }`; customer `{ org_id, quotation_ids }`; super admin has neither, works only on `/platform`.
4. Redis keys prefixed `org:{id}:`; BullMQ payloads always include `org_id`.
5. Socket.IO: one room per org.
6. MinIO: per-org prefix `org-{id}/...`; signed URLs only after a tenant check.
7. Workers resolve org config from the payload's `org_id` — never globals.
8. Each feature phase ships at least one cross-tenant isolation check.

## Phase discipline

- Each phase must end demoable (see `milestones.md` for the demo per phase). Don't pull Phase N+1 scope into Phase N.
- Port conflicts on this machine: another project ("movie" stack) may hold 5432/9000/9001 — coordinate before stopping foreign containers.
