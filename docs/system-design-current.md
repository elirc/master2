# Current System Design

## Repo Structure

- `apps/api`: Express modular monolith API.
- `apps/web`: React/Vite operational frontend.
- `apps/worker`: BullMQ background worker.
- `packages/domain`: shared billing, money, RBAC, state, and idempotency rules.
- `packages/db`: Prisma schema, client export, and seed data.
- `docs`: architecture, backlog, feature plans, journals, walkthroughs, and migration discipline.

## Major Module Connections

The frontend calls the API. The API enforces tenant context and permissions, writes database records, records audit logs, and emits outbox events. The API also queues worker jobs. The worker consumes billing jobs, writes invoices/payments, updates outbox records, and reports a heartbeat.

## Key Workflows

- Create customer: frontend action, API authorization, tenant-owned customer row, audit log.
- Create subscription: idempotent API command, transactional subscription write, audit log, outbox event, invoice job.
- Generate invoice: subscription plus plan price, coupon, tax, invoice lines, audit log, outbox event.
- Attempt payment: queued worker job, mock provider result, invoice state update, audit log, outbox event.
- Inspect operations: dashboard, audit log, health readiness, worker heartbeat.

## System Design Decisions

- Modular monolith first, because billing workflows need consistency and are easier to learn in-process.
- Integer cents for money.
- Backend RBAC as the source of truth.
- Explicit workflow states.
- Audit logs and outbox events from the beginning.
- Mock provider before real Stripe integration to make workflow behavior inspectable.

## Tradeoffs

- Development header auth is temporary.
- API tests are not yet deep enough for production confidence.
- The worker and API duplicate some invoice-generation shape; a future service extraction can reduce that.
- `db push` remains useful for local learning, while migration discipline is documented for durable changes.

## Improvements

Follow `docs/backlog.md` in order. The next highest-value product features are authentication sessions, tenant isolation guardrail tests, deeper RBAC, membership administration, and stronger billing state machines.
