# Interview questions: Master2 billing webhook

Paths are relative to the project root. Each question is marked junior or mid.

## Screening

**S1 (junior). What does this service do, in one request?**
`POST /api/payments/webhooks/mock` accepts a synthetic provider event and settles a payment. The route is `apps/api/src/modules/payments.routes.ts:29`; the work is `processMockPaymentWebhook` in `apps/api/src/modules/payments.service.ts:34`. On a `payment.succeeded` it marks the payment succeeded, marks the invoice paid, stamps the webhook event as processed, writes an audit row and an outbox row, and returns `{ processed: true, eventId, ignoredFailure }`.

**S2 (junior). Where does the tenant come from?**
`attachTenantContext` in `apps/api/src/shared/auth.ts:8` reads `x-org-slug` and `x-user-email`, looks up the membership joining organization and user (line 18), and 403s with `membership.denied` if there is none. The resolved context carries `organizationId`, `role` and `permissions` derived from the role (line 39). The comment at `apps/api/src/modules/payments.routes.ts:25-28` is the honest part: a real provider cannot present those headers, so production has to resolve the organization from a verified signature or from the stored event, never from a caller header.

**S3 (junior). Which boundary validates the body?**
Zod, before anything else touches the database. `webhookSchema` at `apps/api/src/modules/payments.service.ts:9-15` is `.strict()`, requires `providerEventId` trimmed to at least 4 characters, and restricts `eventType` to `payment.succeeded` or `payment.failed`. `parseMockWebhook` (line 19) converts a parse failure into `HttpError(400, "webhook.invalid", ...)` rather than leaking Zod's issue list.

**S4 (mid). Why is `.strict()` there and what does it stop?**
It rejects unknown keys. The concrete attack it blocks is a caller sending `organizationId` in the body to try to steer the write away from their own tenant; the test "rejects unknown request keys before opening a transaction" at `apps/api/src/modules/payments.service.test.ts:184` sends exactly `{ ...body, organizationId: "org-b" }` and expects a 400 with no transaction opened. It also keeps the payload hash meaningful, since an ignored extra field would otherwise change the hash without changing behaviour.

**S5 (junior). How is permission checked, and why twice?**
The route calls `assertPermission(request, "payments:manage")` (`payments.routes.ts:32`), which checks the role through `hasPermission` (`apps/api/src/shared/auth.ts:56-60`). The service then repeats the check in `requirePaymentPermission` (`payments.service.ts:28`) against `tenant.permissions`. The repetition is deliberate: the service is an exported function, and anything that calls it directly, including a future job or another module, must not be able to skip authorization by not going through the router.

**S6 (junior). Which rows does a successful webhook touch?**
Five writes: `webhookEvent.create` (line 73), `payment.update` (86), `invoice.update` (98), `webhookEvent.update` stamping `processedAt` (102), and then `writeAuditLog` (103) and `writeOutboxEvent` (111), which insert into `auditLog` and `outboxEvent`. All of them take `tx`, so all of them commit together.

**S7 (mid). What are the possible responses and their codes?**
200 `{ processed: true }`, 200 `{ duplicate: true }`, 400 `webhook.invalid`, 400 `request.invalid` for malformed JSON, 403 `permission.denied`, 404 `payment.not_found`, 404 `invoice.not_found`, 409 `webhook.identity_conflict`, 409 `invoice.transition_invalid`, 409 `webhook.claim_conflict`, and 500 `server.internal`. The mapping lives in `errorMiddleware` at `apps/api/src/shared/errors.ts:16-34`.

**S8 (junior). What is `@billing/domain` for?**
Pure logic with no Prisma import: `canTransitionInvoice` over an explicit transition table (`packages/domain/src/billing-state.ts:22-28`), money helpers, permission tables, and `hashRequestPayload` (`packages/domain/src/idempotency.ts:3`). It is the part you can test without a database, which is why 5 of the 30 recorded tests live there.

## Deep dive

**D1 (mid). Walk the three things that can be true about a webhook event you have already seen.**
Inside the transaction, `tx.webhookEvent.findUnique({ where: { providerEventId } })` (line 42) is the first read. If a row exists, three branches follow. Different organization, or a payload whose hash differs from this request's hash: 409 `webhook.identity_conflict` (line 45). Same tenant and payload and `processedAt` already set: return `{ duplicate: true, eventId }` with no further reads or writes (line 49). Same tenant and payload but `processedAt` still null: fall through and finish the work, reusing the existing row via `existing ?? create` at line 73. That third branch is the crash-recovery path, and it is the one candidates usually miss.

**D2 (mid). Why hash the payload instead of comparing the objects?**
`hashRequestPayload` is a SHA-256 over a stable stringification (`packages/domain/src/idempotency.ts:3-4`), so key order does not matter; `packages/domain/src/domain.test.ts:46` asserts `{ b: 2, a: 1 }` and `{ a: 1, b: 2 }` hash the same. That gives the event identity a stable meaning: the same id with the same meaning is a retry, the same id with a different meaning is a provider or attacker bug. Line 44 hashes the stored `existing.payload` on every check rather than storing the hash, which is simpler but pays the hash cost each time and depends on the stored JSON round-tripping identically.

**D3 (mid). Why `Serializable`, and what does the retry loop exist for?**
The transaction is opened with `{ isolationLevel: Prisma.TransactionIsolationLevel.Serializable }` (line 119), because the decision reads a row and then writes based on it, which read-committed does not protect. Serializable turns the race into a failure instead of a corruption, so you need somewhere to catch it: the loop at line 39 runs at most twice, and the catch at line 120 rethrows `HttpError` untouched, treats only P2002 and P2034 as contention (line 122), and on the second failure throws 409 `webhook.claim_conflict`. The test at `payments.service.test.ts:160` drives both codes and asserts `transaction` was called exactly twice.

**D4 (mid). Why must `HttpError` be rethrown before the contention check?**
Because a business refusal thrown inside the callback would otherwise be swallowed and retried. A 404 `payment.not_found` is not going to become a 200 on a second attempt; retrying it doubles the work and, worse, could turn a deterministic refusal into a confusing 409 `claim_conflict`. Line 121 is one line and it is load-bearing.

**D5 (mid). What is the late-failure rule and why does it exist?**
Providers can deliver `payment.failed` after `payment.succeeded`, out of order. `alreadySucceeded` at line 84 captures the current payment status; if the payment already succeeded and this event is a failure, the update block at line 85 is skipped entirely, the audit action becomes `payment.failed.ignored` (line 105), and the outbox write is suppressed by the condition at line 110. So the event is recorded and claimed, money state does not move backwards, and no downstream consumer is told about a failure that did not happen. The test is `payments.service.test.ts:107`.

**D6 (mid). What breaks if you delete line 110, the outbox condition?**
The `if (!(alreadySucceeded && !succeeded))` guard is what stops the ignored late failure from emitting an outbox row. Remove it and every ignored failure publishes `topic: "payment.failed"` for a payment that is sitting in `succeeded`. Downstream that is a dunning email to a customer who paid, which is the kind of bug that reaches support rather than a log. `payments.service.test.ts:118` asserts `outboxEvent.create` was not called for that path.

**D7 (mid). The invoice transition check reads oddly. Explain it.**
Line 69: `body.eventType === "payment.succeeded" && invoice.status !== "paid" && !canTransitionInvoice(invoice.status, "paid")`. The `!== "paid"` clause exists because `paid` has an empty transition list in `packages/domain/src/billing-state.ts:25`, so an already-paid invoice would fail `canTransitionInvoice` and turn a harmless replay-ish delivery into a 409. So: already paid is fine and skipped, `open` and `uncollectible` may become paid (lines 24 and 27), and `draft` or `void` is a 409 `invoice.transition_invalid` before any write. The `it.each(["draft", "void"])` case at `payments.service.test.ts:167` and the uncollectible case at line 175 pin both sides.

**D8 (mid). Why does the successful path clear `failureCode` and `failureMessage`?**
Lines 92-93 set them to null when `succeeded` is true. Without that, a payment that failed with `declined` and then succeeded on retry keeps a stale failure reason attached to a successful payment, which is wrong on every invoice PDF and support screen that reads it. The regression is `payments.service.test.ts:66`, "clears stale failure fields when a failed payment later succeeds".

**D9 (mid). The event lookup is a global `findUnique` on `providerEventId`. Is that a tenancy leak?**
`WebhookEvent.providerEventId` is `@unique` globally in `packages/db/prisma/schema.prisma:276`, so the read is deliberately not tenant-scoped: the point is to detect an id that another tenant already owns. The protection is that the very next line refuses the request when `existing.organizationId !== tenant.organizationId` (line 44), before any payment is read. What leaks is one bit, that the id is taken, which is exactly what a globally unique provider id has to leak. Everything else, payment and invoice, is read with an `organizationId` predicate (lines 54 and 62), and `payments.service.test.ts:63` asserts that `where` object literally.

**D10 (mid). What does the mocked service suite not prove, and what did you do about it?**
It replaces `$transaction` with a function that just runs the callback (`payments.service.test.ts:15`), so there is no database and nothing to roll back or serialize. `apps/api/src/modules/payments.integration.test.ts` is the answer: it skips unless `TEST_DATABASE_URL` is set (line 10), creates a real organization, invoice and payment, then installs a PostgreSQL trigger that raises on any `AuditLog` insert (lines 57-58) and asserts the whole webhook rolls back, leaving payment, invoice, event, outbox and audit counts unchanged. The second case races two identical events and expects one processed and one duplicate-or-409, with exactly one event row and one outbox row.

## Behavioral (STAR)

**B1 (mid). Tell me about a time you proved something instead of asserting it.**
Situation: the webhook service's tests mocked `$transaction`, and the course material was describing all-or-nothing behaviour that the tests could not demonstrate. Task: either stop claiming it or prove it. Action: I wrote `payments.integration.test.ts`, which runs only when `TEST_DATABASE_URL` is set so the default suite stays fast and portable, pushes the schema to a disposable PostgreSQL 18, and injects a failing trigger on `AuditLog` so the failure lands mid-transaction after the payment and invoice writes. Then I raced two identical provider event ids in parallel. Result: with the database present, both cases passed: the injected failure left payment, invoice, event, outbox and audit exactly as before, and the race produced one processed result and one 409 duplicate with a single event row and a single outbox row. `npm run typecheck --workspace @billing/api` exited 0.

**B2 (mid). Tell me about a security issue you documented rather than fixed.**
Situation: the mock webhook route resolves the tenant from `x-org-slug` and `x-user-email` headers. Task: decide what to do, given that the route exists to be driven by a signed-in operator in local runs. Action: fixing it properly means signature verification and a provider account mapping, which is a different piece of work and would have made the local demo unrunnable. So I wrote the constraint down where someone would hit it: a four-line comment at `apps/api/src/modules/payments.routes.ts:25-28` saying production must resolve the organization from a verified signature or the stored `providerEventId`, never from caller-supplied headers, plus a paragraph in the concepts chapter. Result: the limit is stated at the exact line that would be copied into a real integration, which is worth more than the same sentence in a document nobody opens.

**B3 (junior). Tell me about making a codebase easier to learn.**
Situation: the course chapters had exercises inline with their answers immediately below, so a reader could not attempt anything without seeing the solution. Task: separate prompts from answers without losing the link. Action: I left the prompt in each of chapters 01 through 04 with a link forward, and built a "Solutions to the chapter exercises" section in 06 with one anchor per chapter, then checked that every prompt link resolves to an anchor that exists. Result: the chapters read as practice rather than as reading, and the verification chapter gained a runnable section that takes the reader from `docker compose up` through a payment to a webhook and its replay (corrected 2026-10-06: the seed creates no payment, so that section now creates one through the invoice and worker endpoints), with the expected output of both calls written down.

**B4 (mid). Tell me about a decision you would defend but flag.**
The payload hash is recomputed from the stored JSON on every check (line 44) rather than stored as a column. I would defend it: there is no migration, no chance of a hash and a payload disagreeing, and at webhook volume the cost is nothing. I would flag it because it silently assumes the JSON column round-trips byte-identically through Prisma and PostgreSQL. If that assumption breaks, every retry becomes a 409 identity conflict, which is a loud failure but a confusing one. A stored `payloadHash` column with a unique index on `(providerEventId)` would be the version I ship if the traffic justified it.

**B5 (junior). How do you decide what belongs in a verification document?**
What a reader would otherwise assume. For this project that list is explicit: the mocked transaction proves calls and arguments, not rollback, serialization, row locks or durability; the route fixture mocks the service and permissions, so full membership wiring is untested; the synthetic provider route has no signature verification; and subscription idempotency and count-based invoice numbering keep pre-existing race risks. Writing that down cost a paragraph and stops someone calling the project production-ready.

## Follow-ups an interviewer asks next

**F1. "You said two concurrent deliveries end with one processed and one refused. Which mechanism does it, exactly?"**
Two layers. The unique index on `WebhookEvent.providerEventId` means the second `create` fails with P2002. `Serializable` means even without the index the read-then-write pair would fail with P2034. Both codes land in the same contention branch (line 122), get one retry, and on the retry the loser now finds the row and answers either `duplicate` or, if the winner has not committed yet, another contention failure that becomes 409 `webhook.claim_conflict`. The database does the work; the application only chooses how to report it.

**F2. "Is one retry enough?"**
For two racing deliveries of the same event, yes, because after the winner commits the loser's retry takes the duplicate branch and returns 200. For general serialization failures under load, no: one retry is a policy choice that trades tail latency for a slightly higher 409 rate. I would keep the bound (unbounded retries under contention is how you build a thundering herd) but make it configurable and add a metric on `webhook.claim_conflict` so the number is chosen from data rather than taste.

**F3. "A 409 goes back to the provider. What does the provider do with it?"**
Retries it, usually with backoff, which is exactly what we want for `claim_conflict` since the next attempt will find the committed event and get a 200 duplicate. `identity_conflict` is different: retrying will never succeed, because the id is permanently bound to another tenant or payload. Those two should not share a status class in a real integration; `identity_conflict` deserves a page for a human, not a retry.

**F4. "You return 404 for a payment in another organization. Why not 403?"**
Because the scoped `findFirst` at line 53 cannot distinguish "no such payment" from "not yours", and answering 403 would confirm the id exists to someone who should not know. The cost is that a genuine support case, a real payment with a mis-set org header, looks identical to a typo. The audit row is where you recover that, which is why the audit write carries `providerEventId` in its metadata (line 108).

**F5. "Where does the outbox row go?"**
`writeOutboxEvent` (`apps/api/src/shared/outbox.ts`) inserts an `outboxEvent` row with a topic and payload on the transaction client, so publication intent commits with the state change and nothing is sent for a transaction that rolls back. The honest half: delivery is somebody else's job in the worker workspace, delivery is at-least-once by construction, and consumers therefore have to deduplicate. The integration test asserts exactly one outbox row survives a race, which is the property that makes that deduplication tractable.

**F6. "What would you change first if this took real traffic?"**
Signature verification on the route, because header-derived tenancy is the one thing in this file that is wrong rather than merely limited. Second, a metric and alert on `webhook.identity_conflict`, since a rising count means a provider or an attacker is reusing event ids and nothing today would tell you.
