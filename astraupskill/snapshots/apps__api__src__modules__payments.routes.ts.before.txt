import { prisma } from "@billing/db";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../shared/async-handler.js";
import { assertPermission, requireTenant } from "../shared/auth.js";
import { writeAuditLog } from "../shared/audit.js";
import { writeOutboxEvent } from "../shared/outbox.js";

export const paymentsRouter = Router();

paymentsRouter.get(
  "/events",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "payments:manage");
    const events = await prisma.webhookEvent.findMany({
      where: {
        OR: [{ organizationId: tenant.organizationId }, { organizationId: null }]
      },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    response.json({ events });
  })
);

paymentsRouter.post(
  "/webhooks/mock",
  asyncHandler(async (request, response) => {
    const tenant = requireTenant(request);
    const body = webhookSchema.parse(request.body);

    const event = await prisma.webhookEvent.upsert({
      where: { providerEventId: body.providerEventId },
      update: {},
      create: {
        organizationId: tenant.organizationId,
        provider: "mock",
        providerEventId: body.providerEventId,
        eventType: body.eventType,
        payload: body
      }
    });

    if (event.processedAt) {
      response.json({ duplicate: true, event });
      return;
    }

    await prisma.$transaction(async (tx) => {
      const payment = await tx.payment.update({
        where: { id: body.paymentId },
        data: {
          status: body.eventType === "payment.succeeded" ? "succeeded" : "failed",
          providerRef: body.providerEventId,
          failureCode: body.failureCode,
          failureMessage: body.failureMessage
        }
      });

      if (body.eventType === "payment.succeeded") {
        await tx.invoice.update({
          where: { id: payment.invoiceId },
          data: {
            status: "paid",
            paidAt: new Date()
          }
        });
      }

      await tx.webhookEvent.update({
        where: { id: event.id },
        data: { processedAt: new Date() }
      });

      await writeAuditLog(tx, {
        organizationId: payment.organizationId,
        action: body.eventType,
        entityType: "Payment",
        entityId: payment.id,
        metadata: { invoiceId: payment.invoiceId, providerEventId: body.providerEventId }
      });

      await writeOutboxEvent(tx, {
        organizationId: payment.organizationId,
        topic: body.eventType,
        payload: { paymentId: payment.id, invoiceId: payment.invoiceId }
      });
    });

    response.json({ processed: true, eventId: event.id });
  })
);

const webhookSchema = z.object({
  providerEventId: z.string().min(4),
  eventType: z.enum(["payment.succeeded", "payment.failed"]),
  paymentId: z.string().min(1),
  failureCode: z.string().optional(),
  failureMessage: z.string().optional()
});
