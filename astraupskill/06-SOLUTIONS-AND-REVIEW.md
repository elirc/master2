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

At event identity, an existing event is compared on both organization and payload hash. Same tenant and same payload with `processedAt` returns duplicate and does not call payment lookup. Same tenant with changed `eventType` or `paymentId` returns 409 `webhook.identity_conflict` before any business write. Another tenant with the same provider id returns the same generic conflict without revealing its row. New event creation occurs only after both targets are present. This is the exact before/after distinction reviewers need: the provider id remains globally unique while business reads remain tenant scoped.

At state, call the domain transition predicate before creating a success event. `open` and `uncollectible` can transition to paid; `draft` and `void` cannot. The invalid transition solution expects 409 `invoice.transition_invalid` and zero event, payment, invoice, audit, or outbox calls. Success clears stale failure fields with explicit nulls. A failed payment stores the provided failure code and message or null when omitted. A succeeded payment receiving a later failure is not regressed; audit records `payment.failed.ignored` and the failure outbox is skipped.

At transaction ownership, every callback operation uses `tx`, including helper calls `writeAuditLog(tx, ...)` and `writeOutboxEvent(tx, ...)`. Serializable isolation is requested. A P2002 or P2034 is retried once; a second recognized contention error becomes typed 409 `webhook.claim_conflict`. The exhausted-contention exercise must reject with that code rather than expose a raw Prisma error. An arbitrary error remains an unexpected 500. The Vitest fake can invoke the callback and count calls, but it cannot prove PostgreSQL locking, rollback, or durability; the review must say so.

At the response, check shape and status together. Normal success has `processed`, `eventId`, and `ignoredFailure`; replay has `duplicate` and `eventId`; typed failures have stable codes. The shared `errorMiddleware` handles `HttpError`, Zod errors, malformed JSON, and sanitizes unknown exceptions. Route tests create an actual Express app, use `express.json()`, bind `127.0.0.1`, send `fetch`, and close the listener in `finally`. They cover 400 malformed JSON, 403 permission, 404 missing target, 409 identity, and sanitized 500. This proves middleware wiring rather than merely unit-testing a copied function.

Use the scenario table as the final matched solution: viewer—403 and no transaction; foreign payment—404 and no writes; missing invoice—404 and no writes; valid success—state plus one audit and outbox; valid failure—failed state plus one audit and outbox; same replay—duplicate and no new side effects; changed payload—409 and no target read; invalid invoice transition—409 and no event; late failure—ignored audit only; contention twice—409. If any result differs, fix the owning layer and add the narrowest assertion. Preserve unrelated subscription idempotency and invoice numbering races as documented limits.
## Reviewer prompts and model answers

Prompt: “Why not find the payment by id and check organization afterward?” Model answer: selecting globally first can expose or accidentally update a foreign object; the organization predicate must be part of the database read. Prompt: “Why hash the body if provider id is unique?” Model answer: a reused id with a different meaning is a conflict and must not become a replay. Prompt: “Why create an event before checking the payment?” Model answer: a nonexistent target would leave an orphan event claim before its target has been accepted.

Prompt: “Why does the service check permission when the route already does?” Model answer: service functions are reusable boundaries and may be called by a job or another route. Prompt: “Why is an ignored failure audited?” Model answer: the operator needs evidence that a late notification was received and intentionally refused; the audit is not permission to emit a misleading failure message. Prompt: “Why clear failure fields on success?” Model answer: stale decline data misrepresents the current payment state.

Prompt: “What does Serializable prove in this test?” Model answer: only that the implementation requests that Prisma isolation option. The callback mock cannot prove row locking, commit ordering, rollback, or competing PostgreSQL claims. Prompt: “What does the route test add?” Model answer: it exercises JSON parser behavior, shared error middleware, real routing, socket binding, and response serialization. Prompt: “Why sanitize readiness errors?” Model answer: dependency details belong in server logs; clients need a stable not-ready contract.

A model code review also checks what was deliberately left alone. The subscription `runIdempotent` helper still performs work before its response upsert and queues outside its business transaction. Invoice numbering still uses count plus one and can race. The mock provider has no signature verification, network retry protocol, or external exactly-once guarantee. Naming these limits prevents a narrow payment repair from being advertised as a complete billing platform.

## Complete fixture and model assertions

The following excerpt combines the actual test module setup with two of its regression cases. The same assertions run in payments.service.test.ts; this excerpt is not counted as an extra test file. To practice independently, save a copy as apps/api/src/modules/payments.practice.test.ts so its relative imports resolve, then run the API suite. Keep the existing domain build step before testing. Every helper and mock used by the two cases is defined here. The first demonstrates a scoped missing relationship with zero writes, and the second proves a legitimate failure still records its intended audit and outbox.

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
