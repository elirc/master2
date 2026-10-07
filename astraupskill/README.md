# Master2: tenant-safe mock payment processing

Start here, then follow the eight chapters in order. These guides live alongside the actual application source and regression tests. The stack is an npm-workspaces monorepo: Express 5 + Zod API (`apps/api`), React/Vite web (`apps/web`), BullMQ worker (`apps/worker`), Prisma/PostgreSQL (`packages/db`) and a pure TypeScript domain package (`packages/domain`).

- [01-CODEBASE-MAP](01-CODEBASE-MAP.md)
- [02-CONCEPTS](02-CONCEPTS.md)
- [03-WORKED-CHANGE](03-WORKED-CHANGE.md)
- [04-TESTING-AND-DEBUGGING](04-TESTING-AND-DEBUGGING.md)
- [05-PRACTICE](05-PRACTICE.md)
- [06-SOLUTIONS-AND-REVIEW](06-SOLUTIONS-AND-REVIEW.md)
- [07-TRACE-LAB](07-TRACE-LAB.md)
- [VERIFICATION](VERIFICATION.md)

## Prerequisites and glossary

**Prerequisites:** TypeScript and Express middleware; Zod or any schema validator; enough Prisma for `findUnique` and `$transaction`; the fact that a provider retries a webhook. The separate `elirc/master3` course (ticketing, same template) is a natural predecessor.

| term | meaning | where in this project |
| --- | --- | --- |
| tenant context | the organization and permissions resolved before any handler runs | `attachTenantContext` in `apps/api/src/shared/auth.ts`, wired in `apps/api/src/app.ts` |
| permission guard | the capability check, repeated in the service so a direct caller cannot skip it | `requirePaymentPermission` in `apps/api/src/modules/payments.service.ts` |
| tenant scope | the organization predicate in every lookup, so a foreign id misses | `where: { id: body.paymentId, organizationId: tenant.organizationId }` in `payments.service.ts` |
| parse and normalize | unknown JSON becomes a typed, trimmed value before any decision | `webhookSchema` and `parseMockWebhook` in `payments.service.ts` |
| event identity | the provider's unique event id, which makes a retry recognisable | `providerEventId` on `tx.webhookEvent.findUnique` in `payments.service.ts` |
| payload hash | the fingerprint giving that identity a stable meaning across retries | `hashRequestPayload(body)` in `payments.service.ts` |
| identity conflict | the same id with another tenant or payload, refused as 409 | the `webhook.identity_conflict` throw in `payments.service.ts` |
| duplicate / replay | a redelivery of a processed event returning early with no new writes | the `existing.processedAt` early return in `payments.service.ts` |
| claim | stamping the event processed inside the transaction that did the work | `tx.webhookEvent.update({ ... processedAt })` in `payments.service.ts` |
| late failure | a failure arriving after success: audited, but it must not regress state | the `payment.failed.ignored` audit branch in `payments.service.ts` |
| audit and outbox intent | the who-did-what row and the notify-later row, committed with the change | `writeAuditLog` and `writeOutboxEvent` in `apps/api/src/shared/` |
| contention retry | retrying once on the serialization codes, then answering 409 | the `["P2002", "P2034"]` check and `webhook.claim_conflict` in `payments.service.ts` |

## How to use this course

This course follows one synthetic payment webhook from the HTTP boundary to database write calls and replay handling. It is written for a junior developer who knows TypeScript and basic Express, then gradually asks mid-level questions about tenant isolation, transaction ownership, retries, and evidence. Read the chapters in order, keep the project open, and run the dependency-free practice checks in [05-PRACTICE](05-PRACTICE.md) as you go (they need only Node 22.6+, no `npm install`). The examples use the real names from `apps/api/src/modules/payments.service.ts` and `payments.service.test.ts`, so you can search directly rather than translate pseudocode.

The request begins as unknown JSON. The route obtains a tenant context and requires `payments:manage`; the service repeats that guard for direct callers. Zod validates and normalizes the provider event, then a payload hash gives the event identity a stable meaning. Prisma looks up the globally unique event identity and checks its organization and payload. Payment and invoice queries include organization predicates. Only a valid, authorized target can create an event. A success updates payment and invoice together, writes audit and outbox intent, and returns a small response. A duplicate returns early, a late failure is audited but cannot regress success, and malformed input becomes a typed 400.

The eight chapters are: Codebase Map, Concepts, Worked Change, Testing and Debugging, Practice, Solutions and Review, Trace Lab, plus the Verification chapter. The first two establish vocabulary and file placement. Worked Change walks a concrete success and failure. Testing explains resettable Vitest mocks and actual Express parsing. Practice gives a scenario table plus eight runnable Goal/Check exercises; Solutions provides matched answers and a senior review of eight verified defects the course does not fix. Trace Lab makes early exits visible. Verification explains the recorded checks, their limits, and how to drive a real webhook locally.

Use the course as a review conversation. Ask which tenant owns every row, which operation must be inside the transaction, what happens when the provider retries, and which claim is unsupported by a mock. The recorded verification deliberately did not start a worker, contact a provider, push a schema, or claim external exactly-once delivery. Those boundaries make the local example safe to run and honest to evaluate.

## A repeatable learning rhythm

For each chapter, read the short explanation, open the named source file, run the smallest relevant test, and write down one invariant in your own words. Then change one fixture and predict the new response before running it. This rhythm teaches CRUD mechanics together with the judgment needed for multi-tenant systems: identify the actor, scope the row, choose the legal state transition, commit related writes together, and return an answer that a client can act on. The final verification chapter shows how to capture evidence without pretending that a mock is production infrastructure.

## Read the actual implementation

Open the [payment service](../apps/api/src/modules/payments.service.ts), [service regression tests](../apps/api/src/modules/payments.service.test.ts), [real route and middleware tests](../apps/api/src/modules/payments.routes.test.ts), and [domain transition rules](../packages/domain/src/billing-state.ts). Compare the service with the [original payment route](snapshots/apps__api__src__modules__payments.routes.ts.before.txt). The original controller contained the workflow that now has an explicit service boundary. These links stay inside this project so you can study it independently of the larger collection.
