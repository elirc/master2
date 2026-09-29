# Worked change

Start with a body `{ providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" }` and an owner in `org-a`. The service parses and hashes it, checks for an existing event, then selects payment and invoice with `organizationId: "org-a"`. It creates the event with provider `mock`, updates payment to succeeded with null failure fields, marks the invoice paid, audits the action, queues an outbox intent, and returns the event id.

For a late failure, payment status is already succeeded. The event is still recorded and processed, but the payment and invoice are untouched. Audit action is `payment.failed.ignored`; no failure outbox is emitted. For a same-payload replay, the service returns `{ duplicate: true, eventId }` before payment lookup.

Exercise: modify the success fixture to include stale failure fields on the payment. (answer: [06, chapter 03](06-SOLUTIONS-AND-REVIEW.md#chapter-03-exercise))

This change is intentionally local. It adds no network SDK, signature secret, migration, or worker startup. Mocked Prisma runs with dummy configuration while Serializable remains the production transaction request. That makes the example safe to repeat and honest about evidence: local state transitions are tested, while database durability and real concurrency require an separate disposable PostgreSQL test database.

Compare before and after deliberately. Before repair, a global payment id could cross tenants and an existing event could be replayed with a different meaning. After repair, identity and target reads are scoped, and conflict responses do not reveal foreign rows. The tests make those differences concrete.
## Full worked example: success, failure, and replay

Start with the fixture used in the service test:

```ts
const owner: TenantContext = {
  organizationId: "org-a", organizationSlug: "acme", userId: "user-a",
  userEmail: "a@example.com", role: "owner", permissions: ["payments:manage"]
};
const body = {
  providerEventId: "evt-1234", eventType: "payment.succeeded" as const,
  paymentId: "pay-a"
};
```

The route receives JSON and calls `processMockPaymentWebhook(assertPermission(request, "payments:manage"), request.body)`. First, `assertPermission` returns the organization context or throws 403. The service then invokes `parseMockWebhook`; because `evt-1234` is long enough and the event type is one of the two enum values, the normalized object is accepted. `hashRequestPayload(body)` is calculated before the transaction so a later event with the same provider id but a changed payment id cannot silently acquire the old meaning.

Inside `$transaction`, the event lookup uses the globally unique `providerEventId`. A matching row from another organization or a row whose payload hash differs produces `HttpError(409, "webhook.identity_conflict", ...)`. There is no response containing the foreign event. For a new event, payment lookup is `{ id: "pay-a", organizationId: "org-a" }`; invoice lookup similarly carries `org-a`. A null payment produces 404 and zero writes. A null invoice produces 404 and also zero writes. This order prevents a durable event tombstone for an invalid target.

Assume payment status is `failed` with old failure fields and invoice status is `open`. The service creates the event, then updates payment with `status: "succeeded"`, `providerRef: "evt-1234"`, `failureCode: null`, and `failureMessage: null`. Clearing those fields is part of recovery: showing an old decline reason beside a paid payment would mislead an operator. Since the domain permits `open -> paid`, invoice update sets `status: "paid"` and `paidAt: new Date()`. Audit receives the organization, action `payment.succeeded`, entity `Payment`, and metadata containing invoice and provider ids. Outbox receives topic `payment.succeeded` and the two local ids. The response is `{ processed: true, eventId, ignoredFailure: false }`.

Now send a legitimate failure:

```ts
const failure = {
  providerEventId: "evt-fail", eventType: "payment.failed" as const,
  paymentId: "pay-a", failureCode: "card_declined",
  failureMessage: "The issuer declined the authorization"
};
```

Against a processing payment, this writes failed state and the supplied details, records an audit action, and emits a failure outbox intent. Against an already succeeded payment, `alreadySucceeded && !succeeded` is true. The event is still processed and audit action becomes `payment.failed.ignored`, but payment and invoice updates are skipped and no failure outbox is emitted. This is a monotonic safety rule: an informational late notification cannot undo a financial success.

Finally replay the original success with an existing event `{ id: "event-a", organizationId: "org-a", processedAt: new Date(), payload: body }`. The same normalized hash and tenant match return `{ duplicate: true, eventId: "event-a" }` before payment lookup. Audit and outbox counts remain unchanged. Change only `paymentId` or `eventType`, and the same provider id becomes a 409 conflict. The before/after behavior is the repair: loose global targeting and ambiguous replay become scoped, typed, reviewable decisions.
## How to explain this to a teammate

Start with the business sentence: “A tenant can replay its accepted synthetic payment event without repeating its recorded side effects.” Break that sentence into testable pieces. “Tenant” means a membership context and organization predicates. “Own” means permission and no foreign row disclosure. “Process” means legal payment and invoice transitions. “Exactly once within the local contract” means provider identity, one transaction, replay short circuit, and one outbox intent. This decomposition helps a junior developer see why the code has several checks instead of one large controller branch.

When pairing, ask the learner to point at the first write in the source and explain why all earlier operations are reads or guards. Then ask what happens if that write succeeds while invoice update fails. The answer should mention transaction rollback in PostgreSQL and the limitation that our fake only records calls. Finally ask them to alter a success body into a changed replay and predict 409 before running the test. These conversations turn a working patch into transferable understanding.
