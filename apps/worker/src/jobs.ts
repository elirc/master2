import { prisma } from "@billing/db";
import { calculateInvoice } from "@billing/domain";

export async function generateInvoice(input: { organizationId: string; subscriptionId: string }) {
  return prisma.$transaction(async (tx) => {
    const subscription = await tx.subscription.findFirstOrThrow({
      where: {
        id: input.subscriptionId,
        organizationId: input.organizationId
      },
      include: {
        plan: { include: { prices: { where: { active: true }, take: 1 } } }
      }
    });

    const price = subscription.plan.prices[0];
    if (!price) {
      throw new Error("Subscription plan does not have an active price.");
    }

    const existing = await tx.invoice.findFirst({
      where: {
        organizationId: input.organizationId,
        subscriptionId: subscription.id,
        createdAt: {
          gte: subscription.currentPeriodStart,
          lte: subscription.currentPeriodEnd
        }
      }
    });

    if (existing) {
      return { invoiceId: existing.id, reused: true };
    }

    const [coupon, taxRate] = await Promise.all([
      tx.coupon.findFirst({
        where: { organizationId: input.organizationId, active: true },
        orderBy: { createdAt: "desc" }
      }),
      tx.taxRate.findFirst({
        where: { organizationId: input.organizationId, active: true }
      })
    ]);

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
      }
    });

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: "worker.invoice.generated",
        entityType: "Invoice",
        entityId: invoice.id,
        metadata: { subscriptionId: subscription.id, total: invoice.total }
      }
    });

    await tx.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        topic: "billing.invoice.generated",
        payload: { invoiceId: invoice.id, total: invoice.total }
      }
    });

    return { invoiceId: invoice.id };
  });
}

export async function attemptPayment(input: { organizationId: string; invoiceId: string }) {
  return prisma.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirstOrThrow({
      where: {
        id: input.invoiceId,
        organizationId: input.organizationId
      }
    });

    if (invoice.status === "paid") {
      return { invoiceId: invoice.id, alreadyPaid: true };
    }

    const succeeds = invoice.total % 7 !== 0;
    const payment = await tx.payment.create({
      data: {
        organizationId: input.organizationId,
        customerId: invoice.customerId,
        invoiceId: invoice.id,
        provider: "mock",
        providerRef: `mock_${Date.now()}`,
        status: succeeds ? "succeeded" : "failed",
        amount: invoice.total,
        currency: invoice.currency,
        failureCode: succeeds ? null : "card_declined",
        failureMessage: succeeds ? null : "The mock card was declined by deterministic test rule."
      }
    });

    if (succeeds) {
      await tx.invoice.update({
        where: { id: invoice.id },
        data: {
          status: "paid",
          paidAt: new Date()
        }
      });
    }

    await tx.auditLog.create({
      data: {
        organizationId: input.organizationId,
        action: succeeds ? "payment.succeeded" : "payment.failed",
        entityType: "Payment",
        entityId: payment.id,
        metadata: { invoiceId: invoice.id, amount: invoice.total }
      }
    });

    await tx.outboxEvent.create({
      data: {
        organizationId: input.organizationId,
        topic: succeeds ? "payment.succeeded" : "payment.failed",
        payload: { paymentId: payment.id, invoiceId: invoice.id }
      }
    });

    return { paymentId: payment.id, succeeded: succeeds };
  });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}
