# Concepts

Tenant safety means payment and invoice queries carry the organization id, even when the caller supplied a globally unique identifier. The global provider-event lookup instead verifies the returned event organization and payload before acknowledging a replay. Authorization means role permission is checked before work. Idempotency means the provider event id and normalized payload identify one meaning. Atomicity means event claim, payment/invoice state, audit, and outbox commit together. These concepts answer different questions and should not be collapsed into one “secure webhook” label.

The mock provider has two transitions. A success moves a payment to succeeded and an open invoice to paid. A failure moves a payment to failed with optional details. Once succeeded, a later failure is ignored and audited. A successful retry clears old failure fields. A duplicate processed event is acknowledged without rereading or writing business state.

Exercise: explain why an event must not be created before payment lookup. (answer: [06, chapter 02](06-SOLUTIONS-AND-REVIEW.md#chapter-02-exercise))

Typed errors make the contract useful to clients. A 400 can be corrected, a 403 needs access, a 404 identifies a missing scoped target, and a 409 can be retried or investigated. Unknown errors become sanitized 500 responses. Keep these concepts separate during review: tenant filtering does not replace permission checks, and a mock replay test does not prove provider delivery semantics.

A useful habit is to name the invariant before coding. For example: no denied or missing target creates an event; one accepted event creates at most one outbox intent; success is never regressed by failure. Each invariant maps to a focused fixture and negative assertion.

For the shared error contract, DomainError belongs to the domain package and has no dependency on Express. The API maps its validation, forbidden and conflict categories to HTTP400,403 and409. This keeps expected billing failures distinguishable from unknown infrastructure failures after the global error handler is tightened.

## The tenant header is an input the attacker controls

Every request in this API resolves its tenant from `x-org-slug` and `x-user-email` (`apps/api/src/shared/auth.ts`), which is fine for a demo where a signed-in operator calls the API. It is *not* fine for a webhook. A payment provider posting to `/webhooks/mock` cannot present those headers, and anyone who can reach the endpoint can present any of them. So the tenant scoping the service performs (`payment.findFirst({ where: { id, organizationId: tenant.organizationId } })`) is only as trustworthy as the header. In production the organization must come from something the caller cannot forge: a provider signature over the body verified with the tenant's webhook secret (which identifies the tenant), or the stored `providerEventId` written when the payment was created. The mock route carries this caveat as a comment (fix pass). Predict: with header-derived tenancy, what does a forged `x-org-slug` for another tenant plus a guessed `paymentId` achieve? (It marks another tenant's invoice paid: the scoping check passes because the attacker chose the scope.)

