import { prisma, Prisma } from "@billing/db";
import { canTransitionInvoice, hashRequestPayload, type Permission } from "@billing/domain";
import { z } from "zod";
import type { TenantContext } from "../shared/types.js";
import { HttpError } from "../shared/errors.js";
import { writeAuditLog } from "../shared/audit.js";
import { writeOutboxEvent } from "../shared/outbox.js";

const webhookSchema = z.object({
  providerEventId: z.string().trim().min(4),
  eventType: z.enum(["payment.succeeded", "payment.failed"]),
  paymentId: z.string().min(1),
  failureCode: z.string().optional(),
  failureMessage: z.string().optional()
}).strict();

export type MockWebhookBody = z.infer<typeof webhookSchema>;

export function parseMockWebhook(input: unknown): MockWebhookBody {
  const result = webhookSchema.safeParse(input);
  if (!result.success) {
    throw new HttpError(400, "webhook.invalid", "The mock webhook body is invalid.");
  }

  return result.data;
}

function requirePaymentPermission(tenant: TenantContext) {
  if (!tenant.permissions.includes("payments:manage" as Permission)) {
    throw new HttpError(403, "permission.denied", "Missing permission payments:manage.");
  }
}

export async function processMockPaymentWebhook(tenant: TenantContext, input: unknown) {
  requirePaymentPermission(tenant);
  const body = parseMockWebhook(input);
  const payloadHash = hashRequestPayload(body);

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

        const payment = await tx.payment.findFirst({
          where: { id: body.paymentId, organizationId: tenant.organizationId },
          select: { id: true, organizationId: true, invoiceId: true, status: true }
        });
        if (!payment) {
          throw new HttpError(404, "payment.not_found", "Payment was not found in this organization.");
        }

        const invoice = await tx.invoice.findFirst({
          where: { id: payment.invoiceId, organizationId: tenant.organizationId },
          select: { id: true, status: true }
        });
        if (!invoice) {
          throw new HttpError(404, "invoice.not_found", "Invoice was not found in this organization.");
        }

        if (body.eventType === "payment.succeeded" && invoice.status !== "paid" && !canTransitionInvoice(invoice.status, "paid")) {
          throw new HttpError(409, "invoice.transition_invalid", "Invoice cannot transition to paid from its current state.");
        }

        const event = existing ?? await tx.webhookEvent.create({
          data: {
            organizationId: tenant.organizationId,
            provider: "mock",
            providerEventId: body.providerEventId,
            eventType: body.eventType,
            payload: body
          }
        });

        const succeeded = body.eventType === "payment.succeeded";
        const alreadySucceeded = payment.status === "succeeded";
        if (!alreadySucceeded) {
          await tx.payment.update({
            where: { id: payment.id },
            data: {
              status: succeeded ? "succeeded" : "failed",
              providerRef: body.providerEventId,
              // A successful retry clears stale failure details from an earlier attempt.
              failureCode: succeeded ? null : body.failureCode ?? null,
              failureMessage: succeeded ? null : body.failureMessage ?? null
            }
          });

          if (succeeded && invoice.status !== "paid") {
            await tx.invoice.update({ where: { id: invoice.id }, data: { status: "paid", paidAt: new Date() } });
          }
        }

        await tx.webhookEvent.update({ where: { id: event.id }, data: { processedAt: new Date() } });
        await writeAuditLog(tx, {
          organizationId: payment.organizationId,
          action: alreadySucceeded && !succeeded ? "payment.failed.ignored" : body.eventType,
          entityType: "Payment",
          entityId: payment.id,
          metadata: { invoiceId: payment.invoiceId, providerEventId: body.providerEventId }
        });
        if (!(alreadySucceeded && !succeeded)) {
          await writeOutboxEvent(tx, {
            organizationId: payment.organizationId,
            topic: body.eventType,
            payload: { paymentId: payment.id, invoiceId: payment.invoiceId }
          });
        }

        return { processed: true as const, eventId: event.id, ignoredFailure: alreadySucceeded && !succeeded };
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
    } catch (error) {
      if (error instanceof HttpError) throw error;
      const contention = error instanceof Prisma.PrismaClientKnownRequestError && ["P2002", "P2034"].includes(error.code);
      if (!contention) throw error;
      if (attempt === 1) {
        throw new HttpError(409, "webhook.claim_conflict", "The provider event is being processed concurrently.");
      }
    }
  }

  throw new HttpError(409, "webhook.claim_conflict", "The provider event is being processed concurrently.");
}
