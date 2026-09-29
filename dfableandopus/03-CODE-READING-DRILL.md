# Code reading drill: Master2 billing webhook

Six drills for a 45-minute screen share. Excerpts are copied from this repository unless a drill says it is mutated. Paths are relative to the project root.

## Drill 1: explain this function

`apps/api/src/modules/payments.service.ts:39-51`, the top of the webhook transaction.

```ts
for (let attempt = 0; attempt < 2; attempt += 1) {
  try {
    return await prisma.$transaction(async (tx) => {
      const existing = await tx.webhookEvent.findUnique({ where: { providerEventId: body.providerEventId } });
      if (existing) {
        if (existing.organizationId !== tenant.organizationId || hashRequestPayload(existing.payload) !== payloadHash) {
          throw new HttpError(409, "webhook.identity_conflict", "Provider event belongs to another tenant or payload.");
        }

        if (existing.processedAt) {
          return { duplicate: true as const, eventId: existing.id };
        }
      }
```

Name the three states an existing row can be in, and say why the lookup is not scoped by organization.

<details>
<summary>Answer</summary>

Three states. Foreign: the row belongs to another organization, or its stored payload hashes differently, so the same id means two different things; 409 `webhook.identity_conflict`, nothing read, nothing written. Processed: same tenant, same payload, `processedAt` set; return `{ duplicate: true }` immediately, which is what a provider retry after a successful delivery hits. Claimed but unfinished: same tenant, same payload, `processedAt` still null, meaning a previous attempt created the row and then died; execution falls through and the row is reused at line 73 via `existing ?? create`.

The lookup is deliberately global because `providerEventId` is `@unique` across the whole table (`packages/db/prisma/schema.prisma:276`). Scoping it by organization would let tenant B create a second row with the same provider id, which the unique index would refuse anyway, but with a raw P2002 instead of a typed 409. The check on the very next line is what keeps the global read safe.
</details>

## Drill 2: spot the bug

A mutated copy of the write block. One change, real consequences.

```ts
const succeeded = body.eventType === "payment.succeeded";
const alreadySucceeded = payment.status === "succeeded";
await tx.payment.update({
  where: { id: payment.id },
  data: {
    status: succeeded ? "succeeded" : "failed",
    providerRef: body.providerEventId,
    failureCode: succeeded ? null : body.failureCode ?? null,
    failureMessage: succeeded ? null : body.failureMessage ?? null
  }
});
```

<details>
<summary>Answer</summary>

The mutation removed the `if (!alreadySucceeded)` guard that wraps this block at `apps/api/src/modules/payments.service.ts:85`. `alreadySucceeded` is still computed, so the code compiles and reads plausibly.

The consequence is money moving backwards. Providers deliver out of order, so a `payment.failed` for an earlier attempt can arrive after the `payment.succeeded` that settled the invoice. With the guard gone, that late failure sets the payment to `failed` and writes a `failureCode` onto a payment that is paid. The invoice stays `paid`, because the invoice update at line 97 is inside the same removed block, so you end up with a paid invoice attached to a failed payment: a state no report knows how to explain.

The guard is also what makes the audit action `payment.failed.ignored` (line 105) meaningful, and what suppresses the outbox row (line 110). The test that fails is "does not regress a succeeded payment on a later failed notification", `apps/api/src/modules/payments.service.test.ts:107`, which asserts `payment.update` and `invoice.update` were not called at all.
</details>

## Drill 3: predict the status code

The same payment has already been settled by event `evt-1234`. A different caller, authenticated in a different organization, sends:

```
POST /api/payments/webhooks/mock
x-org-slug: other-corp
x-user-email: ops@other-corp.test
content-type: application/json

{"providerEventId":"evt-1234","eventType":"payment.succeeded","paymentId":"pay-a"}
```

<details>
<summary>Answer</summary>

409 with body `{ error: "Provider event belongs to another tenant or payload.", code: "webhook.identity_conflict" }`, assuming `ops@other-corp.test` has a membership in `other-corp` with `payments:manage`.

Order of events: `attachTenantContext` resolves the membership for that slug and email (`apps/api/src/shared/auth.ts:18`) or 403s with `membership.denied` if there is none. `assertPermission` checks the role. Zod accepts the body. Inside the transaction the event lookup finds the row, `existing.organizationId` is the first tenant's id, the comparison at line 44 fails, and the `HttpError` is thrown. The catch at line 121 rethrows `HttpError` untouched, so there is no retry, and `errorMiddleware` at `apps/api/src/shared/errors.ts:17` renders it.

Nothing is read about the payment and nothing is written. `apps/api/src/modules/payments.service.test.ts:100` is the test, and it asserts `payment.findFirst` was never called.
</details>

## Drill 4: predict the output

The invoice is `draft`. The payment is `processing`. A valid `payment.succeeded` arrives with a fresh `providerEventId`. What comes back, and which rows exist afterwards?

<details>
<summary>Answer</summary>

409 `invoice.transition_invalid`, "Invoice cannot transition to paid from its current state." No rows change, including no `webhookEvent` row, because the transition check at `apps/api/src/modules/payments.service.ts:69` runs before the event is created at line 73 and the whole thing rolls back anyway.

Why draft fails: `invoiceTransitions.draft` is `["open", "void"]` in `packages/domain/src/billing-state.ts:23`, so `paid` is not reachable. An invoice has to be opened before it can be paid. `uncollectible` is different, it lists `["paid", "void"]` at line 27, so a recovered write-off does settle; `payments.service.test.ts:175` covers that.

The subtle clause is `invoice.status !== "paid"` in the same condition. `paid` has an empty transition list (line 25), so without that clause an already-paid invoice would fail the transition check and a harmless re-delivery would become a 409 instead of proceeding to the duplicate or late-failure paths.
</details>

## Drill 5: review this diff

A teammate wants to simplify the error handling.

```diff
     } catch (error) {
-      if (error instanceof HttpError) throw error;
-      const contention = error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
-      if (!contention) throw error;
-      if (attempt === 1) {
-        throw new HttpError(409, "webhook.claim_conflict", "The provider event is being processed concurrently.");
-      }
+      if (attempt === 1) {
+        throw new HttpError(409, "webhook.claim_conflict", "The provider event is being processed concurrently.");
+      }
     }
```

<details>
<summary>Answer</summary>

Three defects, in order of severity.

1. Business refusals are now retried and then mislabelled. A 404 `payment.not_found` or a 409 `invoice.transition_invalid` thrown inside the callback is deterministic; running it again cannot change the answer, and on the second pass the client receives 409 `webhook.claim_conflict`, which is a lie about why the request failed and tells the provider to retry something that will never succeed. The rethrow at `apps/api/src/modules/payments.service.ts:121` exists exactly to prevent this.
2. Genuine infrastructure errors are swallowed and retried. A connection failure, a constraint violation that is not P2002, a bug in the handler: all now produce a 409 instead of a 500, so the error never reaches the `server.internal` branch of `errorMiddleware` (`apps/api/src/shared/errors.ts:34`) and never looks like an incident.
3. Every error costs two transactions. The retry is no longer conditional on contention, so every failing request does its work twice, which is the opposite of what you want when the API is already unhealthy.

The test that catches it is `it.each(["P2002", "P2034"])` at `payments.service.test.ts:160`, but only for the contention path; the deterministic-refusal tests such as line 134 catch the first defect because they expect `invoice.not_found` and would receive `claim_conflict`.
</details>

## Drill 6: explain this function

`apps/api/src/shared/auth.ts:8-40`, condensed.

```ts
const organizationSlug = String(request.header("x-org-slug") ?? "acme");
const userEmail = String(request.header("x-user-email") ?? config.defaultUserEmail);
const membership = await prisma.membership.findFirst({
  where: { organization: { slug: organizationSlug }, user: { email: userEmail } },
  include: { organization: true, user: true }
});
if (!membership) {
  throw new HttpError(403, "membership.denied", "No membership was found for the selected organization and user.");
}
request.tenant = { organizationId: membership.organizationId, ..., role: membership.role, permissions: permissionsForRole(membership.role) };
```

What is right about this, what is wrong, and what would you say in a review?

<details>
<summary>Answer</summary>

Right: the headers are treated as a selection, not as proof. The membership query joins organization by slug and user by email and requires a row to exist, so a caller naming an organization they do not belong to gets a 403 rather than a context. Permissions are derived from the stored role through `permissionsForRole`, not taken from the request, so nothing about the caller's capabilities is client-supplied. Health checks short-circuit before any of it (line 10).

Wrong: there is no authentication at all. The email header is an assertion of identity that nothing verifies, so anyone who knows a member's address can act as them. There are also two defaults, `"acme"` and `config.defaultUserEmail`, which mean a request with no headers still resolves to a real tenant. That is convenient for a demo and it is the sort of default that survives into a deployment.

In review: this is acceptable as a local demo shim and must not be the production path. That is precisely why the webhook route carries the comment at `apps/api/src/modules/payments.routes.ts:25-28` saying the organization must come from a verified provider signature or from the stored `providerEventId`. The route fixture at `apps/api/src/modules/payments.routes.test.ts:9` mocks `assertPermission` entirely, so nothing in the test suite exercises this function; the verification chapter lists that as a known gap rather than pretending otherwise.
</details>
