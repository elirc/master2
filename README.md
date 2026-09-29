# Enterprise Billing Platform

A learning-oriented multi-tenant SaaS billing and subscription platform. The project is intentionally shaped like a realistic modular monolith: API, frontend, database package, background worker, shared domain rules, tests, and architecture documentation.

## Quick Start

```bash
npm install
cp .env.example .env
docker compose up -d
npm run db:generate
npm run db:push
npm run db:seed
npm run dev:api
npm run dev:web
```

## Workspace Layout

- `apps/api`: Express API and backend modules.
- `apps/web`: React admin dashboard and customer portal.
- `apps/worker`: BullMQ background worker.
- `packages/domain`: Shared domain rules and tests.
- `packages/db`: Prisma schema, Prisma client, and seed data.
- `docs`: Architecture, feature plans, build journals, walkthroughs, and backlog.

Start with [docs/architecture-planning.md](docs/architecture-planning.md), then read [docs/architecture-journal.md](docs/architecture-journal.md).


## Focused payment-processing course

Start with [astraupskill](astraupskill/README.md) for the tenant-scoped webhook repair, worked tests, exercises and verification limits.
