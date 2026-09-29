# Codebase map

The request enters `apps/api/src/app.ts`, where CORS, JSON parsing, tenant context, routes, and the final error handler are assembled. `modules/payments.routes.ts` exposes `POST /api/payments/webhooks/mock`; it asks `assertPermission` for a tenant with `payments:manage` and passes `request.body` to the service. `modules/payments.service.ts` owns normalization, identity checks, scoped reads, state transitions, and transaction boundaries. `shared/audit.ts` and `shared/outbox.ts` write audit and outbox rows through the transaction client. Prisma models and enums live in `packages/db/prisma/schema.prisma`; reusable permission and hashing functions live in `packages/domain`.

Trace a success by following `body -> payloadHash -> tx.webhookEvent.findUnique -> tx.payment.findFirst -> tx.invoice.findFirst -> tx.webhookEvent.create -> tx.payment.update -> tx.invoice.update -> audit -> outbox`. The same trace stops early for a duplicate or a denied viewer. The learner should keep a notebook of which calls use `tx`; a global `prisma` call inside the callback would escape atomicity.

Exercise: mark each operation above as read, state write, or side effect. (answer: [06, chapter 01](06-SOLUTIONS-AND-REVIEW.md#chapter-01-exercise))

The map is a debugging tool. Build domain and db first so aliases resolve, then run the API tests from the repository root. Keep the worker out of this exercise because it consumes outbox work later. When copying code, preserve the `tx` parameter: calling global Prisma inside the callback would escape the atomic boundary. A reviewer should be able to point from every test assertion to one node in this map.

A useful habit is to draw arrows for data ownership. The tenant owns payment, invoice, event, audit, and outbox rows. The provider id is globally unique but never grants access to another tenant. Tests should therefore show both the input tenant and the expected organization predicate.
