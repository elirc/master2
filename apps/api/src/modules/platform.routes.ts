import { prisma } from "@billing/db";
import { Router } from "express";
import { asyncHandler } from "../shared/async-handler.js";
import { assertPermission, requireTenant } from "../shared/auth.js";

export const platformRouter = Router();

platformRouter.get(
  "/audit-logs",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "audit:read");
    const logs = await prisma.auditLog.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    response.json({ logs });
  })
);

platformRouter.get(
  "/outbox",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "audit:read");
    const events = await prisma.outboxEvent.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: "desc" },
      take: 100
    });

    response.json({ events });
  })
);

platformRouter.get(
  "/portal",
  asyncHandler(async (request, response) => {
    const tenant = requireTenant(request);
    const customer = await prisma.customer.findFirst({
      where: { organizationId: tenant.organizationId },
      include: {
        subscriptions: { include: { plan: true } },
        invoices: {
          include: { lines: true, payments: true },
          orderBy: { createdAt: "desc" },
          take: 10
        }
      },
      orderBy: { createdAt: "desc" }
    });

    response.json({ customer });
  })
);
