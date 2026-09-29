# Flashcards: Master2 billing webhook

Cover the right column. Everything here is checkable in the repository.

| Question | Answer |
| --- | --- |
| Entry point for the webhook | `processMockPaymentWebhook` at `apps/api/src/modules/payments.service.ts:34` |
| Route that calls it | `POST /webhooks/mock` in `apps/api/src/modules/payments.routes.ts:29` |
| Permission required | `payments:manage`, checked at the route and again in `requirePaymentPermission` |
| Why the permission is checked twice | The service is exported and a direct caller must not be able to skip authorization |
| Headers that select the tenant | `x-org-slug` and `x-user-email` |
| Why that is wrong for a webhook | A real provider cannot send them; production must use a verified signature or the stored event |
| Status when no membership matches the headers | 403 `membership.denied` |
| Validator and its strictness | Zod `webhookSchema`, `.strict()`, so unknown keys are rejected |
| Minimum length of `providerEventId` | 4, after trimming |
| Two allowed event types | `payment.succeeded` and `payment.failed` |
| Status and code for a bad body | 400 `webhook.invalid` |
| Status and code for malformed JSON | 400 `request.invalid`, from the `SyntaxError` branch of `errorMiddleware` |
| Isolation level of the transaction | `Serializable` |
| How many attempts the retry loop makes | Two |
| Prisma codes treated as contention | P2002 and P2034 |
| Result after both attempts fail on contention | 409 `webhook.claim_conflict` |
| Why `HttpError` is rethrown before the contention check | Business refusals are deterministic; retrying them wastes work and mislabels the failure |
| First read inside the transaction | `tx.webhookEvent.findUnique({ where: { providerEventId } })` |
| Why that read is not tenant-scoped | `providerEventId` is globally `@unique`; the point is to detect an id another tenant owns |
| Condition producing `webhook.identity_conflict` | Stored row's `organizationId` differs, or its payload hashes differently |
| What a redelivery of a processed event returns | `{ duplicate: true, eventId }` with no further reads or writes |
| The third existing-row state | Same tenant and payload with `processedAt` null: reuse the row and finish the work |
| Function that makes payload comparison stable | `hashRequestPayload`, SHA-256 over a stable stringify (`packages/domain/src/idempotency.ts:3`) |
| Test proving key order does not matter | `packages/domain/src/domain.test.ts:46` |
| Scoped predicate on the payment read | `where: { id: body.paymentId, organizationId: tenant.organizationId }` |
| Status when the payment is in another organization | 404 `payment.not_found`, not 403 |
| Status when the invoice is missing | 404 `invoice.not_found` |
| Which invoice statuses may become `paid` | `open` and `uncollectible` |
| Which cannot | `draft`, `void`, and `paid` has no outgoing transitions at all |
| Why the transition check also tests `invoice.status !== "paid"` | `paid` has an empty transition list, so an already-paid invoice would otherwise 409 |
| Flag name for a payment that already succeeded | `alreadySucceeded`, computed at line 84 |
| Audit action for a late failure after success | `payment.failed.ignored` |
| What the late-failure path does not do | Update the payment or invoice, or write an outbox row |
| What a successful retry does to failure fields | Sets `failureCode` and `failureMessage` to null |
| What "claiming" the event means | `tx.webhookEvent.update` setting `processedAt` inside the same transaction |
| Two helpers that take `tx` as their first argument | `writeAuditLog` and `writeOutboxEvent` |
| Table the outbox row lands in | `outboxEvent`, with `organizationId`, `topic` and `payload` |
| Shape of an error response | `{ error, code }` from `errorMiddleware` |
| What an unexpected error becomes | 500 `{ error: "Internal server error.", code: "server.internal" }` |
| Recorded test totals | 30 passing: 5 domain, 16 payment service, 9 HTTP route |
| What the service suite mocks | `@billing/db` entirely, including `$transaction` and the Prisma error class |
| Four things the mocked suite cannot prove | Rollback, serialization, row locks, durability |
| Env var that enables the integration suite | `TEST_DATABASE_URL` |
| How the integration test proves rollback | A PostgreSQL trigger that raises on any `AuditLog` insert, then a snapshot comparison |
| What the race case asserts afterwards | Payment `succeeded`, invoice `paid`, exactly one event row and one outbox row |
| Known race risks outside this slice | Subscription idempotency and count-based invoice numbering |
