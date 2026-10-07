# Codebase map

The request enters `apps/api/src/app.ts`, where CORS (line 15), JSON parsing (16), tenant context (17), the five routers (53-57) and the final error handler (59) are assembled. `modules/payments.routes.ts` exposes `POST /api/payments/webhooks/mock` (lines 29-35); it asks `assertPermission` for a tenant with `payments:manage` and passes `request.body` to the service. `modules/payments.service.ts` owns normalization, identity checks, scoped reads, state transitions, and transaction boundaries. `shared/audit.ts` and `shared/outbox.ts` write audit and outbox rows through whatever client they are handed, so the service passes `tx`. Prisma models and enums live in `packages/db/prisma/schema.prisma`; reusable permission and hashing functions live in `packages/domain`.

## Where each step lives

| step | file:line | what to notice |
| --- | --- | --- |
| tenant resolution | `apps/api/src/shared/auth.ts:15-31` | slug and email come from headers, and both have defaults (`"acme"`, `config.defaultUserEmail`) |
| route permission | `apps/api/src/shared/auth.ts:56-63` | checks `hasPermission(tenant.role, ...)` |
| service permission | `apps/api/src/modules/payments.service.ts:28-32` | checks `tenant.permissions.includes(...)`: a different source than the route, equal only because `auth.ts:39` derives one from the other |
| parse | `payments.service.ts:9-26` | `.strict()` rejects unknown keys; only `providerEventId` is trimmed |
| hash | `payments.service.ts:37` and `packages/domain/src/idempotency.ts:3-21` | SHA-256 over a key-sorted stringify |
| transaction + retry loop | `payments.service.ts:39-130` | two attempts, Serializable, typed 409 after the second contention |
| identity / replay | `payments.service.ts:42-51` | global `providerEventId` lookup, then org + hash comparison |
| scoped reads | `payments.service.ts:53-67` | `organizationId` in both `where` clauses |
| transition guard | `payments.service.ts:69-71` | uses `canTransitionInvoice` from `packages/domain/src/billing-state.ts:42` |
| writes | `payments.service.ts:73-116` | event create, payment update, invoice update, event `processedAt`, audit, outbox |
| error mapping | `apps/api/src/shared/errors.ts:16-35` | HttpError, DomainError, ZodError, JSON SyntaxError, else sanitized 500 |
| unique event id | `packages/db/prisma/schema.prisma:276` | `providerEventId String @unique`, global across tenants |

Trace a success by following `body -> payloadHash -> tx.webhookEvent.findUnique -> tx.payment.findFirst -> tx.invoice.findFirst -> tx.webhookEvent.create -> tx.payment.update -> tx.invoice.update -> tx.webhookEvent.update -> audit -> outbox`. The same trace stops early for a duplicate or a denied viewer. Keep a note of which calls use `tx`; a global `prisma` call inside the callback would escape atomicity (practice check P4 proves there is none).

Exercise: mark each operation above as read, state write, or side effect. (answer: [06, chapter 01](06-SOLUTIONS-AND-REVIEW.md#chapter-01-exercise))

## The other half of the payment story

Payments are not created by the webhook. The only `tx.payment.create` outside tests is the worker's `attemptPayment` (`apps/worker/src/jobs.ts:107-166`), queued by `POST /api/billing/invoices/:invoiceId/pay` (`apps/api/src/modules/billing.routes.ts:233-251`). It decides success with `invoice.total % 7 !== 0` (`jobs.ts:120`) and creates the payment already `succeeded` or `failed`, never `processing`. Keep that in mind: the webhook tests use a `processing` fixture, but in the running app the webhook almost always meets a payment the worker has already settled (see finding F2 in chapter 06).

A useful habit is to draw arrows for data ownership. The tenant owns payment, invoice, event, audit, and outbox rows. The provider id is globally unique but never grants access to another tenant. Tests should therefore show both the input tenant and the expected organization predicate.
