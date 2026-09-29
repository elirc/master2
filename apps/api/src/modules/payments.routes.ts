import { prisma } from "@billing/db";
import { Router } from "express";
import { asyncHandler } from "../shared/async-handler.js";
import { assertPermission } from "../shared/auth.js";
import { processMockPaymentWebhook } from "./payments.service.js";

export const paymentsRouter = Router();

paymentsRouter.get(
  "/events",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "payments:manage");
    const events = await prisma.webhookEvent.findMany({
      where: {
        organizationId: tenant.organizationId
      },
      orderBy: { createdAt: "desc" },
      take: 25
    });

    response.json({ events });
  })
);

// Caveat: a real payment provider cannot present x-org-slug / x-user-email. This mock route resolves
// the tenant from those headers only because it is exercised by a signed-in operator in local runs.
// Production must resolve the organization from a verified provider signature or from the stored
// providerEventId, never from caller-supplied headers (see astraupskill/02-CONCEPTS.md).
paymentsRouter.post(
  "/webhooks/mock",
  asyncHandler(async (request, response) => {
    const result = await processMockPaymentWebhook(assertPermission(request, "payments:manage"), request.body);
    response.json(result);
  })
);
