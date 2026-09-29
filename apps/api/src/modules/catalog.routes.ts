import { prisma } from "@billing/db";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../shared/async-handler.js";
import { assertPermission, requireTenant } from "../shared/auth.js";
import { writeAuditLog } from "../shared/audit.js";
import { writeOutboxEvent } from "../shared/outbox.js";

export const catalogRouter = Router();

catalogRouter.get(
  "/plans",
  asyncHandler(async (request, response) => {
    const tenant = requireTenant(request);
    const plans = await prisma.plan.findMany({
      where: { organizationId: tenant.organizationId },
      include: { prices: true, entitlements: true },
      orderBy: { createdAt: "asc" }
    });

    response.json({ plans });
  })
);

catalogRouter.post(
  "/plans",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "catalog:manage");
    const body = createPlanSchema.parse(request.body);

    const plan = await prisma.$transaction(async (tx) => {
      const created = await tx.plan.create({
        data: {
          organizationId: tenant.organizationId,
          name: body.name,
          code: body.code,
          description: body.description,
          trialDays: body.trialDays,
          prices: {
            create: {
              nickname: body.price.nickname,
              currency: body.price.currency,
              unitAmount: body.price.unitAmount,
              interval: body.price.interval
            }
          },
          entitlements: {
            create: body.entitlements.map((entitlement) => ({
              key: entitlement.key,
              value: entitlement.value
            }))
          }
        },
        include: { prices: true, entitlements: true }
      });

      await writeAuditLog(tx, {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: "catalog.plan.created",
        entityType: "Plan",
        entityId: created.id,
        metadata: { code: created.code }
      });

      await writeOutboxEvent(tx, {
        organizationId: tenant.organizationId,
        topic: "catalog.plan.created",
        payload: { planId: created.id }
      });

      return created;
    });

    response.status(201).json({ plan });
  })
);

catalogRouter.get(
  "/coupons",
  asyncHandler(async (request, response) => {
    const tenant = requireTenant(request);
    const coupons = await prisma.coupon.findMany({
      where: { organizationId: tenant.organizationId },
      orderBy: { createdAt: "desc" }
    });

    response.json({ coupons });
  })
);

const createPlanSchema = z.object({
  name: z.string().min(2),
  code: z.string().min(2).regex(/^[a-z0-9_-]+$/),
  description: z.string().min(5),
  trialDays: z.number().int().min(0).max(90).default(14),
  price: z.object({
    nickname: z.string().min(2),
    currency: z.enum(["USD", "EUR", "GBP"]),
    unitAmount: z.number().int().positive(),
    interval: z.enum(["month", "year"])
  }),
  entitlements: z
    .array(
      z.object({
        key: z.string().min(2),
        value: z.string().min(1)
      })
    )
    .default([])
});
