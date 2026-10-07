# Solutions and review

A strong solution keeps `requirePaymentPermission` and `parseMockWebhook` before the retry loop, compares both organization and payload hash for existing events, and scopes payment and invoice reads. It uses only `tx` in the callback, requests Serializable isolation, and maps final P2002/P2034 contention to typed 409. Success writes null failure fields, while ignored late failures write audit only.

Review the diff against the original snapshots and ask: can a tenant learn another event id? Can an unknown payment create an event? Can a duplicate create two outbox messages? Can a failed notification regress success? Can malformed JSON leak a parser stack? Each answer should be proven by a focused assertion or documented as outside the mock's capability.

Exercise solution: for changed payload on an existing event, expect `webhook.identity_conflict`, no payment lookup, and no create. For a missing invoice, expect `invoice.not_found` and no event/audit/outbox. These are complete matched pairs: fixture, invocation, error, and side-effect assertions.

Review compatibility too: `/events` remains tenant filtered and unrelated billing routes retain their contracts. Known HttpErrors and parser failures are explicit; unknown failures are sanitized. Known domain validation errors map to 400, forbidden operations to 403, and illegal transitions to 409 through DomainError; unexpected infrastructure errors remain sanitized500.

When reviewing a solution, ask whether the mock faithfully represents the query. Returning a foreign row and then asserting the service rejects it can hide a missing predicate. Return null for a scoped miss, and separately assert the predicate passed to Prisma. This distinction is central to tenant-safe testing.
## Solutions to the chapter exercises

### Chapter 01 exercise

*Exercise: mark each operation above as read, state write, or side effect.*

reads are identity/payment/invoice; state writes are event create/update, payment, invoice; side effects are audit and outbox. All belong in one callback after permission and body validation.

### Chapter 02 exercise

*Exercise: explain why an event must not be created before payment lookup.*

an unknown payment would leave an orphan event row before its target is accepted, creating ambiguous retry state. The service therefore returns typed 404 and performs zero writes. This is a local synthetic contract; signatures and external delivery are outside scope.

### Chapter 03 exercise

*Exercise: modify the success fixture to include stale failure fields on the payment.*

assert `payment.update` contains `failureCode: null` and `failureMessage: null`. Then assert invoice status paid and one outbox call. This matched test demonstrates the behavior change directly.

### Chapter 04 exercise

*Exercise: inject a P2034 twice.*

the first error retries; the second becomes `HttpError` 409 `webhook.claim_conflict`. A fake transaction callback does not prove concurrent PostgreSQL claims or rollback. Record that limitation in evidence.

## Complete review walkthrough

Review the implementation in layers. At the request boundary, `webhookSchema` is a strict Zod object. `providerEventId` is trimmed and requires four characters; `eventType` is an enum; `paymentId` is nonempty; and unknown keys are rejected. The matched test should call the service with `{ ...body, extra: "x" }`, expect `status: 400` and code `webhook.invalid`, and assert `$transaction` was never called. A truncated JSON stream is a different boundary: Express raises a parser `SyntaxError` with status 400, and the shared application middleware returns `{ error: "Malformed JSON request body.", code: "request.invalid" }`.

At authorization, `requirePaymentPermission` checks the context before hashing and before opening a transaction. The viewer fixture has role `viewer` and permissions `billing:read`; the expected result is 403 and zero transaction calls. Keeping the service guard matters because a future queue consumer or test may call the service without the route. The route's `assertPermission` remains useful for HTTP context, but it is not the only defense.

At tenant scope, inspect every predicate rather than trusting ids. Payment read is `findFirst({ where: { id: body.paymentId, organizationId: tenant.organizationId }, select: ... })`; invoice read uses the payment invoice id and the same organization. The foreign-target exercise must make `payment.findFirst` return null, because a correctly scoped database would hide the org-b row. The solution expects 404 `payment.not_found`, no event create, no payment or invoice update, no audit, and no outbox. A missing invoice follows the same side-effect rule. A test that returns a foreign row and then expects rejection is weaker because it may conceal a missing predicate.

At event identity, an existing event is compared on both organization and payload hash. Same tenant and same payload with `processedAt` returns duplicate and does not call payment lookup. Same tenant with changed `eventType` or `paymentId` returns 409 `webhook.identity_conflict` before any business write. Another tenant with the same provider id returns the same generic conflict without revealing its row, although the 409 itself still tells the caller the id exists somewhere (finding F3). New event creation occurs only after both targets are present. This is the exact before/after distinction reviewers need: the provider id remains globally unique while business reads remain tenant scoped.

At state, call the domain transition predicate before creating a success event. `open` and `uncollectible` can transition to paid; `draft` and `void` cannot. The invalid transition solution expects 409 `invoice.transition_invalid` and zero event, payment, invoice, audit, or outbox calls. Success clears stale failure fields with explicit nulls. A failed payment stores the provided failure code and message or null when omitted. A succeeded payment receiving a later failure is not regressed; audit records `payment.failed.ignored` and the failure outbox is skipped.

At transaction ownership, every callback operation uses `tx`, including helper calls `writeAuditLog(tx, ...)` and `writeOutboxEvent(tx, ...)`. Serializable isolation is requested. A P2002 or P2034 is retried once; a second recognized contention error becomes typed 409 `webhook.claim_conflict`. The exhausted-contention exercise must reject with that code rather than expose a raw Prisma error. An arbitrary error remains an unexpected 500. The Vitest fake can invoke the callback and count calls, but it cannot prove PostgreSQL locking, rollback, or durability; the review must say so.

At the response, check shape and status together. Normal success has `processed`, `eventId`, and `ignoredFailure`; replay has `duplicate` and `eventId`; typed failures have stable codes. The shared `errorMiddleware` handles `HttpError`, Zod errors, malformed JSON, and sanitizes unknown exceptions. Route tests create an actual Express app, use `express.json()`, bind `127.0.0.1`, send `fetch`, and close the listener in `finally`. They cover 400 malformed JSON, 403 permission, 404 missing target, 409 identity, and sanitized 500. This proves middleware wiring rather than merely unit-testing a copied function.

Use the scenario table as the final matched solution: viewer—403 and no transaction; foreign payment—404 and no writes; missing invoice—404 and no writes; valid success—state plus one audit and outbox; valid failure—failed state plus one audit and outbox; same replay—duplicate and no new side effects; changed payload—409 and no target read; invalid invoice transition—409 and no event; late failure—ignored audit only; contention twice—409. If any result differs, fix the owning layer and add the narrowest assertion. Preserve unrelated subscription idempotency and invoice numbering races as documented limits.
## Reviewer prompts and model answers

Prompt: “Why not find the payment by id and check organization afterward?” Model answer: selecting globally first can expose or accidentally update a foreign object; the organization predicate must be part of the database read. Prompt: “Why hash the body if provider id is unique?” Model answer: a reused id with a different meaning is a conflict and must not become a replay. Prompt: “Why create an event before checking the payment?” Model answer: a nonexistent target would leave an orphan event claim before its target has been accepted.

Prompt: “Why does the service check permission when the route already does?” Model answer: service functions are reusable boundaries and may be called by a job or another route. Prompt: “Why is an ignored failure audited?” Model answer: the operator needs evidence that a late notification was received and intentionally refused; the audit is not permission to emit a misleading failure message. Prompt: “Why clear failure fields on success?” Model answer: stale decline data misrepresents the current payment state.

Prompt: “What does Serializable prove in this test?” Model answer: only that the implementation requests that Prisma isolation option. The callback mock cannot prove row locking, commit ordering, rollback, or competing PostgreSQL claims. Prompt: “What does the route test add?” Model answer: it exercises JSON parser behavior, shared error middleware, real routing, socket binding, and response serialization. Prompt: “Why sanitize readiness errors?” Model answer: dependency details belong in server logs; clients need a stable not-ready contract.

A model code review also checks what was deliberately left alone. The subscription `runIdempotent` helper still performs work before its response upsert and queues outside its business transaction. Invoice numbering still uses count plus one and can race; the `@@unique([organizationId, number])` constraint turns the loser into an unmapped P2002 and therefore a 500 rather than a duplicate number (finding F5). The mock provider has no signature verification, network retry protocol, or external exactly-once guarantee. Naming these limits prevents a narrow payment repair from being advertised as a complete billing platform.

## Complete fixture and model assertions

The following excerpt combines the actual test module setup with two of its regression cases. The same assertions run in payments.service.test.ts; this excerpt is not counted as an extra test file. To practice independently, save a copy as apps/api/src/modules/payments.practice.test.ts so its relative imports resolve, run the API suite, and delete the copy afterwards so the recorded counts stay 16 and 9. Keep the existing domain build step before testing. Every helper and mock used by the two cases is defined here. The first demonstrates a scoped missing relationship with zero writes, and the second proves a legitimate failure still records its intended audit and outbox.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../shared/types.js";

const { prisma, transaction, tx, KnownRequestError } = vi.hoisted(() => {
  class KnownRequestError extends Error {
    constructor(public code: string) { super("Synthetic Prisma contention"); }
  }
  const tx = {
    webhookEvent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn(), update: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    outboxEvent: { create: vi.fn() }
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { prisma: { $transaction: transaction }, transaction, tx, KnownRequestError };
});

vi.mock("@billing/db", () => ({
  prisma,
  Prisma: {
    TransactionIsolationLevel: { Serializable: "Serializable" },
    PrismaClientKnownRequestError: KnownRequestError
  }
}));

const { processMockPaymentWebhook } = await import("./payments.service.js");

const owner: TenantContext = {
  organizationId: "org-a", organizationSlug: "acme", userId: "user-a", userEmail: "a@example.com",
  role: "owner", permissions: ["payments:manage"]
};
const viewer: TenantContext = { ...owner, role: "viewer", permissions: ["billing:read"] };
const body = { providerEventId: "evt-1234", eventType: "payment.succeeded" as const, paymentId: "pay-a" };

function payment(status = "processing") { return { id: "pay-a", organizationId: "org-a", invoiceId: "inv-a", status }; }
function invoice(status = "open") { return { id: "inv-a", status }; }

describe("Payment practice cases", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const method of Object.values(tx.webhookEvent)) void method.mockReset();
    for (const method of Object.values(tx.payment)) void method.mockReset();
    for (const method of Object.values(tx.invoice)) void method.mockReset();
    void tx.auditLog.create.mockReset();
    void tx.outboxEvent.create.mockReset();
    transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  });

  function expectNoWrites() {
    expect(tx.webhookEvent.create).not.toHaveBeenCalled();
    expect(tx.webhookEvent.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  }

  it("rejects a missing scoped invoice before claiming the event", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(null);
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 404, code: "invoice.not_found" });
    expect(tx.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv-a", organizationId: "org-a" } }));
    expectNoWrites();
  });

  it("records a legitimate failure without marking its invoice paid", async () => {
    const failure = { ...body, eventType: "payment.failed", failureCode: "declined", failureMessage: "Synthetic decline" };
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(invoice());
    tx.webhookEvent.create.mockResolvedValue({ id: "failed-event" });
    await expect(processMockPaymentWebhook(owner, failure)).resolves.toMatchObject({ processed: true, ignoredFailure: false });
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", failureCode: "declined", failureMessage: "Synthetic decline" }) }));
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ topic: "payment.failed" }) }));
    expect(tx.webhookEvent.update).toHaveBeenCalledTimes(1);
  });
});
```

Change only one fixture per experiment. For a void invoice, return invoice("void") and use the success body; expect invoice.transition_invalid and expectNoWrites. For an event collision, return an existing org-a event whose payload names pay-other and assert no payment lookup. These variants are also implemented in the main regression file. Mocked absence and exact predicate assertions work together: neither alone proves both tenant scope and failure side effects.

## Practice answers

**P1.** `stableStringify` sorts object keys (`packages/domain/src/idempotency.ts:17-18`), so reordering is the same meaning and replays; a different `paymentId` changes the string, the hash differs, and `payments.service.ts:44` throws `webhook.identity_conflict`. Leading whitespace also changes the raw hash, but the service hashes the *parsed* body and Zod has already trimmed `providerEventId` (line 10), so `" evt-1234"` replays as `"evt-1234"`.

**P2.** Only `open` and `uncollectible` may become `paid`. A `paid` invoice is not a legal source either, but `invoice.status !== "paid"` short-circuits the guard, so a success for an already-paid invoice is processed (with no invoice update, line 97) instead of refused.

**P3.** Permission (403) → parse (400) → open transaction → event identity (409, or the duplicate return) → scoped payment (404) → scoped invoice (404) → transition guard (409) → first write, `tx.webhookEvent.create`. Everything before the create is a read or a refusal, which is why a refused request leaves no event row behind.

**P4.** Zero `prisma.` references inside the callback. The audit and outbox helpers are typed to accept either client (`shared/audit.ts:4`, `shared/outbox.ts:4`), so passing the global client there would still compile; only review (or this check) catches it.

**P5.** (a) Late failure: no payment or invoice update, audit `payment.failed.ignored`, no outbox. (b) New success: no payment or invoice update, audit `payment.succeeded`, **and another `payment.succeeded` outbox row**. See F2.

**P6.** `organizationSlug` falls back to `"acme"` and `userEmail` to `owner@acme.test`; the seed upserts that user (`seed.ts:15-22`) with role `owner` (`seed.ts:24-37`). A header-less request is the Acme owner with every permission. See F1.

**P7.** 12 + 2×2 = 16 service, 3 + 2×3 = 9 route, 5 domain: 30. The count leaves out the two `payments.integration.test.ts` cases, which skip unless `TEST_DATABASE_URL` is set and were not in the recorded run.

**P8.** The webhook refuses `draft` and `void` with 409; the worker checks only `status === "paid"` (`apps/worker/src/jobs.ts:116`) and will pay, and mark paid, a `void` invoice. See F6.

## Senior review: verified defects the course does not fix

Each finding was checked against the source on 2026-10-06. None is fixed in this repository; treat them as review practice, not as completed work.

**F1. A request with no headers is the tenant owner.** `apps/api/src/shared/auth.ts:15-16` defaults `x-org-slug` to `"acme"` and `x-user-email` to `config.defaultUserEmail`, which `apps/api/src/config.ts:6` defaults to `owner@acme.test`, the seeded owner (`packages/db/prisma/seed.ts:15-37`). Any caller who can reach the API without sending headers gets owner permissions, including `POST /api/payments/webhooks/mock`. Fix direction: no defaults outside an explicit development flag, real authentication (session or signed token) before the membership lookup, and for the webhook a verified provider signature.

**F2. A second success emits a duplicate `payment.succeeded`.** For a payment already `succeeded`, a `payment.succeeded` with a *new* provider event id skips the updates (`payments.service.ts:85`) but still writes an audit row (`:103-109`) and, because the guard at `:110` only suppresses `alreadySucceeded && !succeeded`, another outbox event (`:111-115`). This is the common case in the running app: the worker creates payments already `succeeded` or `failed` (`apps/worker/src/jobs.ts:120-128`) and marks the invoice paid, so any provider success that follows double-notifies downstream. No test covers it (see the break-it table in chapter 04). Fix: treat `alreadySucceeded && succeeded` as an acknowledged no-op (record the event, skip the outbox) and add the missing case.

**F3. A global event id is a cross-tenant oracle and can be squatted.** `providerEventId` is `@unique` across all tenants (`packages/db/prisma/schema.prisma:276`) and the lookup at `payments.service.ts:42` is unscoped. Tenant B sending tenant A's event id gets `409 webhook.identity_conflict`, while an unused id with an unknown payment gets `404 payment.not_found`: the status code reveals that the id exists. Because the mock lets the caller choose the id, tenant B can also post `evt-X` against one of its own payments first, after which tenant A's genuine `evt-X` is refused with 409 every time. Fix: make identity `(provider, providerEventId)` and derive the tenant from the verified event, not from the caller.

**F4. `runIdempotent` is check-then-act.** `apps/api/src/shared/idempotent.ts:16-35` reads the key, runs the work, then upserts (`:36-52`). Two concurrent requests with the same `idempotency-key` both miss, both run (two subscriptions and two queued invoice jobs, `billing.routes.ts:183`), and the second upsert's `update: { response }` overwrites the first response. Fix: insert the key first in a pending state (the unique constraint is the lock), then run and record.

**F5. Expected misses become 500s.** `errorMiddleware` has no Prisma mapping (`errors.ts:16-35`), so `findFirstOrThrow` on a foreign or missing invoice in `POST /api/billing/invoices/:invoiceId/pay` (`billing.routes.ts:237-242`) answers `500 server.internal`, not 404. `GET /api/billing/invoices?status=bogus` passes the string through `status as never` (`billing.routes.ts:204`), Prisma rejects the enum value, and the client again sees 500. The invoice-number race (`billing.routes.ts:295-301`, `jobs.ts:59-65`) loses on `@@unique([organizationId, number])` with P2002, also a 500.

**F6. The worker bypasses the invoice state machine.** `attemptPayment` checks only `invoice.status === "paid"` (`apps/worker/src/jobs.ts:116`) and otherwise creates a payment and sets `status: "paid"` (`:136-143`), so a `void` or `draft` invoice can be paid, which the webhook path refuses at `payments.service.ts:69-71`. Two writers, two rule sets. Fix: call `canTransitionInvoice` (or one shared service) on both paths.

**F7. Validation gaps in the webhook schema.** `payments.service.ts:9-15`: only `providerEventId` is trimmed, so `" pay-a"` is a 404 while `" evt-1234"` is normalized; no field has a maximum length, so `failureMessage` can be megabytes and is stored on the payment and in the event payload; and a `payment.failed` without `failureCode` overwrites an earlier code with `null` (`:92-93`).

**F8. The outbox processor has no claim.** `apps/worker/src/outbox-processor.ts:4-20` selects `pending` rows, then updates each to `processing` by id without a `status: "pending"` predicate. Two worker processes can select the same batch and both deliver it. Delivery is at-least-once at best: consumers must be idempotent on the outbox id, or the claim must become a conditional update (or `FOR UPDATE SKIP LOCKED`).
