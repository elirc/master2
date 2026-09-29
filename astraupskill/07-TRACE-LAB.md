# Trace lab

Use a success fixture and narrate each line while reading the source. At the route, tenant permission is established. At the service, Zod returns normalized data and hashing fixes event identity. The transaction reads an existing event, then scoped payment and invoice. New event creation occurs only after both targets exist. State updates and side effects use one transaction client. The response is returned only after processing timestamp, audit, and outbox calls complete.

Repeat with a replay: the trace ends at `processedAt` and returns duplicate. Repeat with an org-b collision: it ends at identity conflict. Repeat with a succeeded payment plus failure event: it reaches event update and audit, then skips state and outbox. Drawing these traces makes early exits and side-effect boundaries concrete.

Exercise: trace a contention retry. Solution: transaction attempt one rejects with recognized Prisma code, attempt two runs the callback; if it rejects again the final typed 409 is returned. A mock can show control flow, while only real PostgreSQL can validate serialization.

Circle the first divergence from success: permission, parser, scoped read, identity, or state guard. That circle identifies the owning layer and the calls that must remain absent. This prevents broad controller patches that weaken unrelated routes. Repeat the trace after each change and explain why the response and side-effect counts now match the scenario table.

Finally, compare traces for success and replay side by side. Success reaches state and side-effect calls; replay stops at the processed event. The shorter replay path is the reason duplicate deliveries are cheap and do not multiply downstream work.

## The early exits you are narrating

All four traces run through `apps/api/src/modules/payments.service.ts:40`. Read the order: identity conflict first, then the replay return, then the tenant-scoped payment and invoice lookups — each one a place a trace can end before any write.

```ts
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

        const payment = await tx.payment.findFirst({
          where: { id: body.paymentId, organizationId: tenant.organizationId },
          select: { id: true, organizationId: true, invoiceId: true, status: true }
        });
        if (!payment) {
          throw new HttpError(404, "payment.not_found", "Payment was not found in this organization.");
        }
```

