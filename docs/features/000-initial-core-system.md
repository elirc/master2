# Feature 000: Initial Core System

## Goal

Create the first production-shaped version of the SaaS billing platform: tenant-aware users, plans, customers, subscriptions, invoices, mock payments, audit logs, worker jobs, and a frontend dashboard.

## Impacted Areas Of The Codebase

- `packages/domain`: money helpers, permissions, billing state transitions, invoice calculation.
- `packages/db`: Prisma schema and seed data.
- `apps/api`: HTTP routes, authorization middleware, billing workflows, audit/outbox writes.
- `apps/worker`: background invoice and payment processing.
- `apps/web`: admin dashboard and customer portal screens.
- `docs`: architecture plan, journal, walkthroughs, and backlog.

## Implementation Approach

1. Scaffold npm workspaces with shared TypeScript configuration.
2. Define Prisma models around tenant ownership and billing workflows.
3. Implement domain helpers first so API and worker code share business rules.
4. Build API modules around identity, catalog, billing, payments, and platform operations.
5. Build worker job handlers for invoice finalization and mock payment attempts.
6. Build frontend screens that exercise real API flows.
7. Add tests around the highest-risk domain logic.

## Design Considerations

- Tenant isolation must be enforced in backend queries, not just UI filters.
- Money must be integer-based and never use floating-point arithmetic.
- Subscription and invoice state transitions should be explicit.
- Webhook/idempotency paths should be shaped early because retrofitting them is painful.
- The UI should look like an operational admin tool: compact, scannable, and workflow-oriented.

## Build Journal

Implemented the initial modular monolith:

- Npm workspaces with `apps/api`, `apps/web`, `apps/worker`, `packages/domain`, and `packages/db`.
- Prisma schema for tenants, users, memberships, teams, plans, prices, entitlements, customers, subscriptions, invoices, payments, webhooks, idempotency keys, audit logs, outbox events, preferences, and worker heartbeats.
- Express API modules for identity, catalog, billing, payments, and platform inspection.
- BullMQ worker for invoice generation, payment attempts, outbox processing, and heartbeat reporting.
- React frontend with operational screens for dashboard, customers, subscriptions, catalog, customer portal, and audit trail.
- Domain tests for money handling, invoice calculation, permissions, workflow transitions, and idempotency hashing.

The most important lesson is that business workflows cross layers. Creating a subscription touches authorization, tenant scoping, database writes, audit logs, outbox events, worker jobs, and frontend refresh behavior. A mid-level engineer learns to trace that whole path instead of only reading the route handler.

Tradeoffs:

- Authentication is development-header based for now; real sessions are a planned backlog feature.
- The payment provider is deterministic and mocked so state transitions are easy to inspect.
- API integration tests and Playwright E2E tests are intentionally left for later backlog work after the core flow is stable.
