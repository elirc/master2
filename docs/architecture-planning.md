# Architecture Planning: Multi-Tenant Billing Platform

## Product Goal

Build a realistic modular monolith for SaaS billing: organizations can manage plans, customers subscribe to plans, invoices are generated, payments are simulated, and the system records audit trails and background work.

This project is intentionally shaped like an enterprise codebase. The first version is more than a toy MVP, but it still avoids distributed-system complexity that would distract from learning core backend engineering.

## Initial Scope

- Organizations, users, memberships, and role-based permissions.
- Product catalog with plans, prices, coupons, and tax rates.
- Customers, subscriptions, trials, invoices, invoice lines, and payments.
- Mock payment provider with webhook ingestion.
- Idempotency keys for risky write operations.
- Audit logs for important business actions.
- Domain events persisted through an outbox table.
- Background worker for invoice finalization and payment simulation.
- Admin dashboard and customer portal screens.
- Tests for money math, subscription state transitions, and authorization helpers.

## Architecture Style

The app is a modular monolith:

- One deployable API process owns HTTP, authorization, transactions, and domain workflows.
- One worker process consumes background jobs and outbox events.
- The database is PostgreSQL through Prisma.
- Redis and BullMQ provide background job queues.
- The frontend is a React app that talks to the API.

This teaches realistic boundaries without prematurely splitting services. The modules are still designed so that a future team could split them later if scale or ownership demanded it.

## Repository Shape

- `apps/api`: Express API, module routers, request validation, auth middleware, and transaction orchestration.
- `apps/worker`: BullMQ workers for background billing jobs and outbox processing.
- `apps/web`: React dashboard/customer portal.
- `packages/domain`: Shared domain rules, money helpers, state machines, and permission helpers.
- `packages/db`: Prisma schema, migrations, seed data, and Prisma client export.
- `docs`: Architecture, feature plans, build journals, walkthroughs, and final system design.

## Domain Boundaries

### Identity And Tenancy

Owns organizations, users, memberships, teams, roles, and tenant isolation. Backend tenant checks are the source of truth. The frontend may hide controls for UX, but cannot authorize actions.

### Catalog

Owns plans, prices, coupons, tax rates, and entitlements metadata. Billing workflows read catalog records but do not duplicate plan logic.

### Billing

Owns subscriptions, invoice generation, invoice state transitions, payment attempts, refunds, credits, and dunning-related hooks.

### Payments

Owns provider abstraction, mock provider implementation, webhooks, idempotency, retries, and event normalization.

### Platform

Owns audit logs, outbox events, notifications, health checks, observability, and admin tools.

## Key Workflows

### Create Subscription

1. API validates the authenticated user has tenant billing permission.
2. Billing service loads plan and customer in the same organization.
3. Subscription starts as `trialing` or `active` based on plan and request input.
4. An audit log entry is written.
5. A billing event is written to the outbox.
6. A worker job is queued to generate the first invoice when needed.

### Generate Invoice

1. Worker loads due subscriptions.
2. Billing service calculates line items using integer cents.
3. Taxes, coupons, and totals are computed through shared domain helpers.
4. Invoice is created as `draft`, finalized, then queued for payment.
5. Payment simulation creates a payment attempt and emits a webhook-like event.

### Webhook Ingestion

1. API receives a provider event with an idempotency key.
2. Event is stored before business effects are applied.
3. Duplicate events return the original outcome.
4. Payment state updates are applied transactionally.
5. Audit and outbox entries record the result.

## Data Modeling Rules

- Store money as integer cents and currency code.
- Every tenant-owned row includes `organizationId`.
- Use explicit state enums rather than boolean combinations for workflows.
- Use append-only audit logs.
- Use idempotency records for externally retried commands.
- Use outbox rows for cross-process follow-up work.

## API Style

- JSON REST endpoints for the first version.
- Zod schemas validate request bodies.
- DTOs are shaped for API clients rather than exposing raw database records.
- Pagination, filtering, and sorting are added where list endpoints can grow.

## Testing Strategy

- Domain package: fast unit tests for money, permissions, and state machines.
- API: focused integration-style tests around risky workflows.
- Frontend: smoke tests and later Playwright flows for key screens.
- Worker: unit tests for job handlers plus integration checks once Docker services are available.

## Tradeoffs

- Express is chosen over a heavier framework so module boundaries stay visible to a learner.
- The payment provider starts as a mock to make state transitions inspectable.
- Real PostgreSQL/Redis are supported through Docker, while local tests can focus on pure domain logic.
- The initial UI is operational rather than marketing-focused because enterprise tools reward dense, scannable workflows.

## Learning Outcomes

A junior developer should learn how to:

- Read a modular monolith by module boundary, not by file chronology.
- Trace a business workflow across API, domain logic, database writes, worker jobs, and UI screens.
- Spot where transactional safety, idempotency, authorization, and auditability matter.
- Understand why production systems keep business rules out of random route handlers.
