# Master2 billing webhook interview kit

Master2 is a multi-tenant billing platform: an npm workspace with `@billing/api` (Express 5 + Prisma), `@billing/domain` (money, invoice state machine, payload hashing), `@billing/db` (schema and client) plus a worker and a Vite frontend. The astraupskill course follows one mock payment webhook from unknown JSON to committed rows. This folder turns that slice into hiring material for CRUD and payments-adjacent backend roles.

## The pitch

"I own the mock payment webhook in a multi-tenant billing API. The interesting part is not the CRUD, it is that a payment provider retries. The same `providerEventId` can arrive twice, in parallel, or with a different body, and each case has to answer differently: a same-payload redelivery returns `{ duplicate: true }` and writes nothing, a different payload or a different tenant under the same event id is a 409 identity conflict, and two concurrent deliveries end with exactly one processed and one 409 claim conflict. The whole decision runs inside one `Serializable` transaction that also claims the event, updates the payment and invoice, writes the audit row and the outbox row, so either all of it commits or none of it does. I also made sure a late `payment.failed` cannot regress a payment that already succeeded; it gets audited as `payment.failed.ignored` and changes nothing."

## Target stack

Node, TypeScript, Express 5, Prisma, PostgreSQL, Vitest. Every pattern here (idempotency key plus payload hash, transactional outbox, state machine in a pure package, serialization-failure retry) maps onto ASP.NET Core with EF Core; say "unit of work" for `$transaction` and "`IsolationLevel.Serializable`" for the Prisma option.

## Two-week plan

- Days 1-2: [01-INTERVIEW-QUESTIONS.md](01-INTERVIEW-QUESTIONS.md), screening group, with `apps/api/src/modules/payments.service.ts` open. That one file is 131 lines and it is most of the interview.
- Days 3-5: the deep-dive group. Be able to name all five refusals and their codes without looking.
- Days 6-7: [03-CODE-READING-DRILL.md](03-CODE-READING-DRILL.md), timed at 45 minutes.
- Days 8-9: [02-STORIES-AND-RESUME.md](02-STORIES-AND-RESUME.md). The strongest story is the integration test, because it is the one that proves what the mocked suite cannot.
- Days 10-12: [04-TAKE-HOME.md](04-TAKE-HOME.md).
- Day 13: [05-SYSTEM-DESIGN-FOLLOWUPS.md](05-SYSTEM-DESIGN-FOLLOWUPS.md).
- Day 14: [06-FLASHCARDS.md](06-FLASHCARDS.md).

## What the evidence actually says

The recorded run is 30 passing tests: 5 domain, 16 payment-service, 9 HTTP-route. The service suite mocks `$transaction` entirely, so it proves call order, arguments, refusal points and the bounded retry, and nothing about PostgreSQL. `apps/api/src/modules/payments.integration.test.ts` closes part of that gap and skips unless `TEST_DATABASE_URL` is set: it injects a failing trigger on `AuditLog` to prove rollback, and races two identical events to prove one processed and one 409. Every answer in this folder that touches durability says which of the two suites backs it.
