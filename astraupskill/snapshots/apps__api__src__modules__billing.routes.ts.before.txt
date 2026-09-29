import { prisma } from "@billing/db";
import { calculateInvoice } from "@billing/domain";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../shared/async-handler.js";
import { assertPermission, requireTenant } from "../shared/auth.js";
import { writeAuditLog } from "../shared/audit.js";
import { runIdempotent } from "../shared/idempotent.js";
import { writeOutboxEvent } from "../shared/outbox.js";
import { billingQueue } from "../shared/queues.js";

export const billingRouter = Router();

billingRouter.get(
  "/dashboard",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:read");
    const [customers, subscriptions, invoices, payments] = await Promise.all([
      prisma.customer.count({ where: { organizationId: tenant.organizationId } }),
      prisma.subscription.groupBy({
        by: ["status"],
        where: { organizationId: tenant.organizationId },
        _count: { status: true }
      }),
      prisma.invoice.findMany({
        where: { organizationId: tenant.organizationId },
        include: { customer: true },
        orderBy: { createdAt: "desc" },
        take: 8
      }),
      prisma.payment.findMany({
        where: { organizationId: tenant.organizationId },
        orderBy: { createdAt: "desc" },
        take: 8
      })
    ]);

    response.json({
      metrics: {
        customers,
        subscriptions: Object.fromEntries(subscriptions.map((row) => [row.status, row._count.status])),
        openInvoiceTotal: invoices.filter((invoice) => invoice.status === "open").reduce((sum, invoice) => sum + invoice.total, 0),
        successfulPaymentTotal: payments
          .filter((payment) => payment.status === "succeeded")
          .reduce((sum, payment) => sum + payment.amount, 0)
      },
      invoices,
      payments
    });
  })
);

billingRouter.get(
  "/customers",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:read");
    const search = typeof request.query.search === "string" ? request.query.search : undefined;
    const customers = await prisma.customer.findMany({
      where: {
        organizationId: tenant.organizationId,
        OR: search
          ? [
              { name: { contains: search, mode: "insensitive" } },
              { email: { contains: search, mode: "insensitive" } }
            ]
          : undefined
      },
      include: {
        subscriptions: { include: { plan: true } },
        invoices: { orderBy: { createdAt: "desc" }, take: 3 }
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    response.json({ customers });
  })
);

billingRouter.post(
  "/customers",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:manage");
    const body = createCustomerSchema.parse(request.body);

    const customer = await prisma.customer.create({
      data: {
        organizationId: tenant.organizationId,
        email: body.email,
        name: body.name,
        externalRef: body.externalRef
      }
    });

    await prisma.auditLog.create({
      data: {
        organizationId: tenant.organizationId,
        actorUserId: tenant.userId,
        action: "billing.customer.created",
        entityType: "Customer",
        entityId: customer.id,
        metadata: { email: customer.email }
      }
    });

    response.status(201).json({ customer });
  })
);

billingRouter.get(
  "/subscriptions",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:read");
    const subscriptions = await prisma.subscription.findMany({
      where: { organizationId: tenant.organizationId },
      include: { customer: true, plan: { include: { prices: true } } },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    response.json({ subscriptions });
  })
);

billingRouter.post(
  "/subscriptions",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:manage");
    const body = createSubscriptionSchema.parse(request.body);

    const result = await runIdempotent({
      organizationId: tenant.organizationId,
      key: request.header("idempotency-key") ?? undefined,
      payload: body,
      run: async () => {
        const subscription = await prisma.$transaction(async (tx) => {
          const [customer, plan] = await Promise.all([
            tx.customer.findFirstOrThrow({
              where: { id: body.customerId, organizationId: tenant.organizationId }
            }),
            tx.plan.findFirstOrThrow({
              where: { id: body.planId, organizationId: tenant.organizationId },
              include: { prices: true }
            })
          ]);

          const periodStart = new Date();
          const periodEnd = addDays(periodStart, body.periodDays);
          const trialEndsAt = body.startWithTrial ? addDays(periodStart, plan.trialDays) : null;
          const created = await tx.subscription.create({
            data: {
              organizationId: tenant.organizationId,
              customerId: customer.id,
              planId: plan.id,
              status: body.startWithTrial ? "trialing" : "active",
              seatCount: body.seatCount,
              currentPeriodStart: periodStart,
              currentPeriodEnd: periodEnd,
              trialEndsAt
            },
            include: { customer: true, plan: { include: { prices: true } } }
          });

          await writeAuditLog(tx, {
            organizationId: tenant.organizationId,
            actorUserId: tenant.userId,
            action: "billing.subscription.created",
            entityType: "Subscription",
            entityId: created.id,
            metadata: { customerId: customer.id, planId: plan.id, seatCount: body.seatCount }
          });

          await writeOutboxEvent(tx, {
            organizationId: tenant.organizationId,
            topic: "billing.subscription.created",
            payload: { subscriptionId: created.id }
          });

          return created;
        });

        await billingQueue.add("generate-invoice", {
          organizationId: tenant.organizationId,
          subscriptionId: subscription.id
        });

        return { subscription };
      }
    });

    response.status(201).json(result);
  })
);

billingRouter.get(
  "/invoices",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:read");
    const status = typeof request.query.status === "string" ? request.query.status : undefined;
    const invoices = await prisma.invoice.findMany({
      where: {
        organizationId: tenant.organizationId,
        status: status as never
      },
      include: {
        customer: true,
        lines: true,
        payments: true
      },
      orderBy: { createdAt: "desc" },
      take: 50
    });

    response.json({ invoices });
  })
);

billingRouter.post(
  "/subscriptions/:subscriptionId/invoices",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "billing:manage");
    const invoice = await createInvoiceForSubscription({
      organizationId: tenant.organizationId,
      actorUserId: tenant.userId,
      subscriptionId: String(request.params.subscriptionId)
    });

    response.status(201).json({ invoice });
  })
);

billingRouter.post(
  "/invoices/:invoiceId/pay",
  asyncHandler(async (request, response) => {
    const tenant = assertPermission(request, "payments:manage");
    const invoice = await prisma.invoice.findFirstOrThrow({
      where: {
        id: String(request.params.invoiceId),
        organizationId: tenant.organizationId
      }
    });

    await billingQueue.add("attempt-payment", {
      organizationId: tenant.organizationId,
      invoiceId: invoice.id
    });

    response.status(202).json({ queued: true, invoiceId: invoice.id });
  })
);

export async function createInvoiceForSubscription(input: {
  organizationId: string;
  actorUserId?: string;
  subscriptionId: string;
}) {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirstOrThrow({
      where: {
        id: input.subscriptionId,
        organizationId: input.organizationId
      },
      include: {
        customer: true,
        plan: { include: { prices: { where: { active: true }, take: 1 } } }
      }
    });

    const price = subscription.plan.prices[0];
    if (!price) {
      throw new Error("Subscription plan does not have an active price.");
    }

    const coupon = await tx.coupon.findFirst({
      where: { organizationId: input.organizationId, active: true },
      orderBy: { createdAt: "desc" }
    });
    const taxRate = await tx.taxRate.findFirst({
      where: { organizationId: input.organizationId, active: true }
    });
    const calculation = calculateInvoice({
      currency: price.currency as "USD",
      lines: [
        {
          description: `${subscription.plan.name} subscription seats`,
          unitAmountCents: price.unitAmount,
          quantity: subscription.seatCount
        }
      ],
      couponPercentOff: coupon?.percentOff,
      taxBasisPoints: taxRate?.basisPoints
    });

    const invoiceCount = await tx.invoice.count({ where: { organizationId: input.organizationId } });
    const invoice = await tx.invoice.create({
      data: {
        organizationId: input.organizationId,
        customerId: subscription.customerId,
        subscriptionId: subscription.id,
        number: `INV-${String(invoiceCount + 1).padStart(6, "0")}`,
        status: "open",
        currency: price.currency,
        subtotal: calculation.subtotal.cents,
        discount: calculation.discount.cents,
        tax: calculation.tax.cents,
        total: calculation.total.cents,
        dueAt: addDays(new Date(), 14),
        finalizedAt: new Date(),
        lines: {
          create: calculation.lines.map((line) => ({
            description: line.description,
            quantity: line.quantity,
            unitAmount: line.unitAmountCents,
            subtotal: line.subtotal.cents
          }))
        }
      },
      include: {
        customer: true,
        lines: true
      }
    });

    await writeAuditLog(tx, {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: "billing.invoice.generated",
      entityType: "Invoice",
      entityId: invoice.id,
      metadata: { subscriptionId: subscription.id, total: invoice.total }
    });

    await writeOutboxEvent(tx, {
      organizationId: input.organizationId,
      topic: "billing.invoice.generated",
      payload: { invoiceId: invoice.id, total: invoice.total }
    });

    return invoice;
  });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

const createCustomerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(2),
  externalRef: z.string().optional()
});

const createSubscriptionSchema = z.object({
  customerId: z.string().min(1),
  planId: z.string().min(1),
  seatCount: z.number().int().positive().max(500),
  periodDays: z.number().int().positive().max(366).default(30),
  startWithTrial: z.boolean().default(true)
});
