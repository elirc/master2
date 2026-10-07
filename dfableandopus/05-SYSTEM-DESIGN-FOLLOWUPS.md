# System design follow-ups: Master2 billing

Every answer starts from what `apps/api/src/modules/payments.service.ts` does today. Paths are relative to the project root.

## The path as it exists

```
 provider (mock)                       operator headers: x-org-slug, x-user-email
        |                                        |
        v                                        v
  POST /api/payments/webhooks/mock ----> attachTenantContext  (shared/auth.ts:8)
        |                                   membership? no -> 403 membership.denied
        v
  assertPermission("payments:manage")   -> 403 permission.denied
        v
  parseMockWebhook (zod .strict)        -> 400 webhook.invalid
        v
  +-- prisma.$transaction, Serializable, attempt 1 of 2 --------------------+
  |  webhookEvent.findUnique(providerEventId)                               |
  |     other tenant / other payload -> 409 webhook.identity_conflict       |
  |     processedAt set              -> return { duplicate: true }          |
  |  payment.findFirst(id + orgId)   -> 404 payment.not_found               |
  |  invoice.findFirst(id + orgId)   -> 404 invoice.not_found               |
  |  canTransitionInvoice(...,'paid')-> 409 invoice.transition_invalid      |
  |  webhookEvent.create   (or reuse the unprocessed existing row)          |
  |  payment.update + invoice.update   [skipped if already succeeded]       |
  |  webhookEvent.update  processedAt  <- the claim                         |
  |  writeAuditLog(tx)                                                      |
  |  writeOutboxEvent(tx)              [skipped for an ignored late failure]|
  +-------------------------- commit or rollback --------------------------+
        |                    P2002 / P2034 -> one retry -> 409 claim_conflict
        v
  { processed: true, eventId, ignoredFailure }
```

## 1. Two providers, then ten. How does event identity scale?

`WebhookEvent.providerEventId` is `@unique` globally (`packages/db/prisma/schema.prisma:276`) while `provider` is a plain string set to `"mock"` at `payments.service.ts:76`. That works for one provider and breaks the day a second one issues an id the first already used: the create fails P2002, the retry finds a row belonging to another tenant, and a perfectly valid event becomes a permanent 409 `identity_conflict`.

The fix is to make identity composite: `@@unique([provider, providerEventId])` and a lookup on both fields. The trade-off is that the single-column unique index is what makes the current global lookup cheap and unambiguous; a composite key means every call site must remember the provider, and forgetting it is a silent cross-provider collision. I would pair the constraint change with making `provider` an enum so a typo cannot create a private namespace.

## 2. Concurrent writers: is `Serializable` plus one retry the right policy?

Today the isolation level is set explicitly (`payments.service.ts:119`) and only P2002 and P2034 are retried, once, before a typed 409 (lines 122-126). The integration test proves the outcome: two identical events produce one `processed`, one duplicate-or-409, one event row and one outbox row (`apps/api/src/modules/payments.integration.test.ts:66-79`).

At scale the pressure is different. Serializable failures rise with contention, and unrelated webhooks for different payments can abort each other when they touch overlapping index ranges. Two moves help. Narrow the transaction: the reads that only validate, such as fetching the payment and invoice, could happen outside it with the decisions rechecked inside, which shortens the window at the cost of one extra read. Or drop to read-committed and lean on the unique index plus a `SELECT ... FOR UPDATE` on the payment row, which gives a cheaper common case and a more explicit locking story. The reason to keep Serializable today is honesty: the invariant is written once, in one place, and the database enforces it rather than a lock the next developer forgets to take.

## 3. Background jobs: the outbox has no consumer story here

`writeOutboxEvent` inserts into `outboxEvent` on the transaction client (`apps/api/src/shared/outbox.ts:11`), so publication intent commits with the state change and nothing is published for a rolled-back webhook. That is the whole guarantee the API provides. The worker workspace exists and the verification chapter says plainly that no worker job was run.

A production consumer needs a claim of its own: `SELECT ... FOR UPDATE SKIP LOCKED` over a batch ordered by `createdAt`, a `publishedAt` stamp written in the same transaction as the publish acknowledgement, and a dead-letter state after N attempts. Delivery is at-least-once, so the consumer of the topic has to deduplicate, and the natural key is the outbox row id. The trade-off against publishing inline from the handler is latency: a poll interval of delay in exchange for never emitting an event for a transaction that did not commit.

## 4. Pagination: the events list at a million rows

`GET /api/payments/events` (`apps/api/src/modules/payments.routes.ts:9-22`) filters on `organizationId`, orders by `createdAt: "desc"` and takes 25. It is bounded, which is more than most first drafts manage, but there is no way to reach page two and no index named for this access path.

Cursor pagination fits the existing order: accept an opaque cursor of `(createdAt, id)` and add `@@index([organizationId, createdAt])` to `WebhookEvent`. A cursor beats offset here because events arrive constantly, so an offset page two silently skips rows that were inserted since page one. The cost is that a cursor cannot jump to page 40, which for an operational event log nobody wants anyway. The second change is to stop returning the whole `payload` JSON in a list view; return id, type, `processedAt` and provider, and let a detail endpoint fetch the payload.

## 5. Auth: replacing the header shim

`attachTenantContext` reads `x-org-slug` and `x-user-email`, defaults both, and looks up a membership (`apps/api/src/shared/auth.ts:15-31`). Nothing authenticates the caller. For operator endpoints the replacement is ordinary: a session or bearer token identifying the user, the organization still selected by header but checked against memberships exactly as it is now, so `permissionsForRole` and every `organizationId` predicate downstream are unchanged.

The webhook route is a different problem and the comment at `apps/api/src/modules/payments.routes.ts:25-28` names it. A provider authenticates with a signature over the raw body and a timestamp, so the route needs the raw bytes (which means mounting a raw body parser for that path before `express.json()`), constant-time comparison, and a replay window on the timestamp. The tenant then comes from the provider account the signature belongs to, not from any header. Trade-off: signature verification makes the local walkthrough in the verification chapter impossible without a key, so the demo path needs an explicit development-only bypass that is loud rather than default.

## 6. Observability: what is missing and what is already there

There is an audit row per processed event with the `providerEventId` in its metadata (`payments.service.ts:103-109`), and every refusal is a typed code rather than a string. That is a good base: the codes `webhook.identity_conflict`, `webhook.claim_conflict`, `invoice.transition_invalid`, `payment.not_found` are exactly the four counters worth graphing, and each means something different operationally. Rising `identity_conflict` means a provider or an attacker is reusing ids. Rising `claim_conflict` means contention, so the retry bound needs revisiting. Rising `transition_invalid` means invoices are not being opened before settlement, which is an upstream bug.

What is absent: no request id, no structured logging, and `errorMiddleware` returns `{ error: "Internal server error.", code: "server.internal" }` for anything unexpected (`apps/api/src/shared/errors.ts:34`) without logging what it swallowed. That last one is the first thing I would change, because it is currently possible for a real defect to be completely invisible. Trade-off: logging the raw error needs care not to write payment payloads into logs.

## 7. Money: what the current model gets right and what it does not

Amounts are integer cents (`Payment.amount` is `Int`, `packages/db/prisma/schema.prisma:259`) with formatting in the domain package, so there is no float arithmetic anywhere near a balance. Currency is a per-row string, which is enough to store but not enough to stop a payment in one currency settling an invoice in another; nothing in `payments.service.ts` compares them. At any real scale that check belongs beside the invoice transition check at line 69.

The bigger gap the verification chapter already names is count-based invoice numbering, which races: two concurrent invoice creations can derive the same number. A sequence per organization, or a unique constraint plus retry, is the fix. It sits outside this slice but it is the first thing an interviewer who has done billing will ask about.

## 8. Porting the slice to ASP.NET Core

Close to mechanical. `prisma.$transaction(..., { isolationLevel: Serializable })` becomes `await using var tx = await db.Database.BeginTransactionAsync(IsolationLevel.Serializable)` with a single `SaveChangesAsync`; the P2002 and P2034 branch becomes a check on `DbUpdateException` with a `PostgresException.SqlState` of `23505` or `40001`; `HttpError` becomes an exception type mapped by middleware to a `ProblemDetails` carrying the same `code` strings, so clients do not notice the port; Zod becomes a validated record with data annotations or FluentValidation, and `.strict()` becomes explicit rejection of unbound members.

Two things need thought. The pure domain package translates directly to a class library with no EF reference, and should, because `canTransitionInvoice` over a static transition table is the same code in any language. And the mocked `$transaction` test style has no clean equivalent: in .NET the honest version is `WebApplicationFactory` plus a real PostgreSQL container, which is the shape `payments.integration.test.ts` already has, and which is the only part of this suite that proves rollback and serialization at all.
