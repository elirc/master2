# Feature 003: Health Checks And Runtime Configuration

Backlog ID: `BIL-003`

## Goal

Give the API and worker clearer startup and operational behavior.

## Impacted Areas Of The Codebase

- `apps/api/src/config.ts`
- `apps/api/src/app.ts`
- `apps/worker/src/index.ts`
- `packages/db/prisma/schema.prisma`

## Implementation Approach

Validate runtime environment variables with Zod, add `/health/live` and `/health/ready`, and let the worker write a heartbeat row that the API can report.

## Design Considerations

Liveness means the process can answer. Readiness means important dependencies are reachable. These are different checks because a process can be alive but unable to safely serve traffic.

## Build Journal

Added config validation for API and worker startup, database readiness checks, and a `WorkerHeartbeat` model. The worker periodically upserts its heartbeat and the API reports whether that heartbeat is fresh.

A junior developer should notice that this feature crosses process boundaries without inventing a new service. The tradeoff is that readiness is still simple: Redis queue health is implied by worker behavior rather than measured directly.
