# Stories and resume material: Master2 billing

## Story 1: proving all-or-nothing instead of asserting it

**Situation.** The mock payment webhook in `apps/api/src/modules/payments.service.ts` commits five writes in one transaction: the webhook event, the payment, the invoice, an audit row and an outbox row. The only tests were service tests that replace `$transaction` with a function running the callback against mock delegates (`apps/api/src/modules/payments.service.test.ts:15`). They proved call order and refusal points, and nothing at all about the database.

**Task.** Get real evidence for the two claims that mattered most: a mid-transaction failure leaves nothing behind, and two identical provider events cannot both process.

**Action.** I wrote `apps/api/src/modules/payments.integration.test.ts` guarded by `describe.skipIf(!url)` on `TEST_DATABASE_URL` (line 10), so the ordinary suite stays fast and needs no infrastructure. It creates a real organization, customer, open invoice and processing payment, then installs a PostgreSQL trigger that raises on any insert into `AuditLog` (lines 57-58). That places the failure after the payment and invoice updates, which is the only position where rollback is interesting. The second case fires two identical events through `Promise.allSettled` (line 68).

**Result.** Against a disposable PostgreSQL 18 with the schema pushed, both cases passed. The injected failure left the snapshot of payment status, invoice status, event count, outbox count and audit count identical to before (line 61). The race produced exactly one `processed` result and exactly one duplicate-or-409, with `events` at 1 and `outbox` at 1 (lines 71-79). `npm run typecheck --workspace @billing/api` exited 0.

## Story 2: the header that cannot survive production

**Situation.** Tenancy in this API is resolved by `attachTenantContext` from `x-org-slug` and `x-user-email` (`apps/api/src/shared/auth.ts:15-16`). For an operator-driven local demo that is fine. For the webhook route it is not, because a payment provider cannot send either header, so the design implies something that can never work.

**Task.** Decide between fixing it and recording it, given that signature verification plus provider account mapping is a separate piece of work and would make the local walkthrough unrunnable.

**Action.** I recorded it at the point of contact rather than in a document: a comment directly above the route (`apps/api/src/modules/payments.routes.ts:25-28`) stating that production must resolve the organization from a verified provider signature or from the stored `providerEventId`, never from caller-supplied headers, with a pointer to the concepts chapter that explains why. The same constraint went into the verification chapter's limits list alongside the untested membership wiring.

**Result.** Anyone copying this route into a real integration reads the constraint before they copy it. The course and the code now say the same thing, and the project's own verification page refuses to describe it as production-ready.

## Story 3: separating practice from answers

**Situation.** The course chapters carried exercises with their solutions printed immediately underneath, so there was no way to attempt anything.

**Task.** Make the exercises attemptable without breaking the link between prompt and answer.

**Action.** I kept the prompt in each of chapters 01 through 04 and moved every solution into a "Solutions to the chapter exercises" section in chapter 06 with one anchor per chapter, then checked each forward link resolves to an anchor that exists. In the verification chapter I added a runnable section: compose up, generate, push, seed, start the API on the default port 4000, then a curl that returns `{ processed: true, eventId }` and the identical curl again that returns `{ duplicate: true, eventId }` with no new rows.

**Result.** The replay behaviour is something a reader observes in their own terminal rather than something the text asserts, and the exercises are exercises.

## Resume bullets

- Built an idempotent payment webhook handler in a multi-tenant Express and Prisma billing API, using a globally unique provider event id plus a SHA-256 payload hash to distinguish a retry (200 duplicate) from an identity conflict (409) with no writes on either path.
- Ran the settlement decision inside a single `Serializable` Prisma transaction covering five writes (event claim, payment, invoice, audit, outbox), with a bounded single retry on Prisma codes P2002 and P2034 that degrades to a typed 409 rather than an unbounded retry loop.
- Wrote a PostgreSQL integration suite that proves rollback by injecting a raising trigger on the audit table mid-transaction, and proves single-processing by racing two identical events; both assertions verified against a disposable PostgreSQL 18 instance.
- Prevented out-of-order provider deliveries from regressing settled money by auditing a late `payment.failed` as `payment.failed.ignored` and suppressing its outbox publication, so no downstream consumer is notified of a failure on a succeeded payment.
- Documented the security boundary of a header-derived tenant context at the route itself, and recorded in the project's verification page the four things the mocked suite cannot establish: rollback, serialization, row locks and durability.

## 60-second spoken summary

Master2 is a multi-tenant billing platform in a Node workspace: an Express and Prisma API, a pure domain package holding money helpers and the invoice state machine, a worker and a Vite frontend. My slice is the payment webhook. The whole design comes from one fact about payment providers, which is that they retry. So the same event id can arrive twice, or twice at once, or a second time with a different body, and each of those needs a different answer. Inside one serializable transaction the handler looks up the event by the provider's id, refuses with a 409 if that id belongs to another tenant or another payload, returns a duplicate result if it has already been processed, and otherwise does the work: mark the payment succeeded, mark the invoice paid if the state machine allows the transition, stamp the event as claimed, write the audit row and the outbox row. All five writes commit together or not at all. Two details I would call out unprompted. A late failure after a success is audited but never published and never moves the payment backwards. And the tests that mock Prisma prove decisions, not durability, which is why I wrote a separate integration test that injects a failing trigger to prove the rollback and races two identical events to prove exactly one processes.

## What I would do next

- Replace header-derived tenancy on the webhook route with provider signature verification, and resolve the organization from the signature or the stored event. This is the one item on the list that is a defect rather than a limit.
- Store the payload hash as a column instead of recomputing it from the stored JSON on every check (`payments.service.ts:44`), so a JSON round-trip difference cannot turn every retry into a 409.
- Split `webhook.identity_conflict` away from `webhook.claim_conflict` at the status level, since one should be retried by the provider and the other never should.
- Address the two race risks the verification chapter already names but this slice does not touch: subscription idempotency and count-based invoice numbering.
- Add a metric on each typed error code, starting with `identity_conflict`, because a rising count there means a provider or an attacker is reusing event ids and nothing today would surface it.
