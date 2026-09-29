# Take-home: handle a `payment.refunded` event

Budget 3 to 4 hours, in this repository. No new dependencies. You do not need a database: the existing mocked service suite is the target, and the integration file is optional.

## The brief

The provider has started sending a third event type. Extend the mock webhook to handle `payment.refunded` end to end.

A refund event carries the usual `providerEventId` and `paymentId`, plus `amount` in integer cents. Handle it in `processMockPaymentWebhook` (`apps/api/src/modules/payments.service.ts:34`) with the same guarantees the existing event types have.

Required behaviour:

1. Extend `webhookSchema` (`payments.service.ts:9-15`) so `eventType` accepts `payment.refunded` and a refund requires a positive integer `amount`. The schema stays `.strict()`; an unknown key is still a 400 `webhook.invalid` before any transaction opens.
2. A refund is legal only when the payment is `succeeded`. Any other payment status is 409 with a new code `payment.not_refundable`, thrown before any write.
3. The refunded amount may not exceed the payment's `amount` column. Over-refunding is 409 `refund.amount_invalid`.
4. On success, inside the same transaction as everything else: set the payment status to `failed` is **not** acceptable. Add a `refundedAmount` integer column to `model Payment` in `packages/db/prisma/schema.prisma` and accumulate into it instead, leaving `status` as `succeeded`. Write the migration file; do not run it.
5. The invoice moves to `void` only when the accumulated refund equals the payment amount, and only if `canTransitionInvoice` allows it from the invoice's current status (`packages/domain/src/billing-state.ts:42`). A disallowed transition is 409 `invoice.transition_invalid`, consistent with the existing path.
6. Audit action is the event type on the normal path. The outbox topic is `payment.refunded` with a payload carrying `paymentId`, `invoiceId` and the refunded amount.
7. Idempotency is unchanged and must keep working: a redelivered refund with the same `providerEventId` and payload returns `{ duplicate: true, eventId }` and accumulates nothing. A same id with a different amount is 409 `webhook.identity_conflict`.

## Acceptance criteria

- A first `payment.refunded` for the full amount returns `{ processed: true }`, updates `payment.refundedAmount`, voids the invoice, writes one audit row and one outbox row, all inside one `$transaction` called with `{ isolationLevel: "Serializable" }`.
- A partial refund leaves the invoice untouched and writes the outbox row.
- A second, identical refund returns a duplicate result and calls neither `payment.update` nor `outboxEvent.create`.
- A refund against a `processing` or `failed` payment is 409 `payment.not_refundable` with no writes at all.
- An amount exceeding the payment total is 409 `refund.amount_invalid` with no writes.
- Contention behaviour is untouched: P2002 and P2034 still retry exactly once and then answer 409 `webhook.claim_conflict`.
- Every existing test still passes, unchanged.

## Where the code goes

- Service: `apps/api/src/modules/payments.service.ts`.
- Tests: add cases to `apps/api/src/modules/payments.service.test.ts`, reusing the hoisted `tx` mock (line 8), the `owner` context (line 29) and the `payment()` and `invoice()` factories (lines 36-37). Use the existing `expectNoWrites()` helper (line 121) for every refusal case.
- Schema and migration: `packages/db/prisma/schema.prisma`, `model Payment` at line 251.
- Optional: a case in `apps/api/src/modules/payments.integration.test.ts`, which skips unless `TEST_DATABASE_URL` is set.

## How to run it

```
npm run typecheck --workspace @billing/domain
npm test --workspace @billing/api
npm run typecheck --workspace @billing/api
```

`test` in `apps/api/package.json` is `vitest run --passWithNoTests`. The baseline is 16 passing service tests and 9 route tests; the integration file skips without `TEST_DATABASE_URL`. If you want the whole tree, `npm run verify` from the root is typecheck, then tests, then build, and it builds `@billing/domain` and `@billing/db` first because the API imports their compiled entry points.

## What to submit

A branch, plus a `NOTES.md` of at most one page: which refusals you placed before the event `create` and why, how you kept the duplicate check honest once the payload gained a variable amount, whether you would have modelled refunds as a separate `Refund` table instead of a column, and what your tests do not prove.

## Grading rubric

| Criterion | Strong | Weak |
| --- | --- | --- |
| Refusal placement | `payment.not_refundable` and `refund.amount_invalid` thrown before `webhookEvent.create` at line 73, with tests asserting `expectNoWrites()` | Refusals after the event row is created, so a failed refund leaves a claimed event behind |
| Idempotency | Duplicate refund returns early with no accumulation; a changed amount under the same id is a 409 identity conflict, and the test proves it | Accumulates on every delivery, so a provider retry doubles the refund |
| Transaction integrity | All writes on `tx`; isolation level unchanged; retry loop and `HttpError` rethrow untouched | Any write on the global `prisma` client, or the retry loop restructured so business errors get retried |
| Validation | Schema still `.strict()`; amount is a positive integer; refund-only fields rejected on the other event types | Amount typed as `number` with no integer or sign check, or `.strict()` dropped to make the union easier |
| State machine use | `canTransitionInvoice` consulted rather than a hand-written status list, with the already-`void` case handled the way the existing code handles already-`paid` | Sets `invoice.status = "void"` directly, bypassing `packages/domain/src/billing-state.ts` |
| Test quality | Cases for full refund, partial refund, duplicate, wrong status, over-amount; each refusal asserts no writes | One happy path; refusals present but untested for side effects |
| Migration and modelling | Additive nullable-or-defaulted column plus a migration file, and the notes argue the column-versus-table trade-off | Schema edited with no migration, or an existing column repurposed |

## Reviewer's notes

Looked at first: where your refusals sit relative to line 73. This codebase has a consistent rule that nothing is created until every reason to refuse has been checked, which is why the existing tests call `expectNoWrites()` rather than just checking a status. A refund that 409s but leaves a `webhookEvent` row behind is the failure that keeps the provider retrying forever, because the next delivery finds an unprocessed row and tries again.

Second: idempotency under a variable field. Existing event types have effectively fixed payloads, so the hash comparison at line 44 doubles as a sanity check. A refund amount makes the payload genuinely variable, and the interesting question is what a same-id-different-amount delivery means. The correct answer here is 409, since the id identifies one refund, and the rubric rewards stating that rather than guessing.

Third: whether accumulation is idempotent by construction or only by the duplicate check. If the only thing stopping a double refund is the early return at line 48, say so in your notes. A stronger design records each refund as a row keyed by `providerEventId` and derives the total, which is the sort of answer the `Refund`-table question is fishing for.

Fourth: the error codes. This API returns `{ error, code }` from `errorMiddleware` (`apps/api/src/shared/errors.ts:16-34`) and clients branch on `code`. New codes are part of the contract, so they should be specific, stable and mentioned in your notes.

Not required: the integration test. If you add one, remember it must skip without `TEST_DATABASE_URL`, and that the existing file cleans up every table it touched in `afterAll`.
