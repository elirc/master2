import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: "acme" },
    update: {},
    create: {
      name: "Acme Cloud Systems",
      slug: "acme"
    }
  });

  const owner = await prisma.user.upsert({
    where: { email: "owner@acme.test" },
    update: {},
    create: {
      email: "owner@acme.test",
      name: "Avery Owner"
    }
  });

  await prisma.membership.upsert({
    where: {
      organizationId_userId: {
        organizationId: organization.id,
        userId: owner.id
      }
    },
    update: { role: "owner" },
    create: {
      organizationId: organization.id,
      userId: owner.id,
      role: "owner"
    }
  });

  const proPlan = await prisma.plan.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "pro"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Pro",
      code: "pro",
      description: "Core SaaS subscription with team seats and standard support.",
      trialDays: 14,
      prices: {
        create: {
          nickname: "Monthly seat",
          currency: "USD",
          unitAmount: 2900,
          interval: "month"
        }
      },
      entitlements: {
        create: [
          { key: "projects", value: "50" },
          { key: "support", value: "standard" }
        ]
      }
    }
  });

  await prisma.plan.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "enterprise"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "Enterprise",
      code: "enterprise",
      description: "Higher-touch plan with advanced controls and premium support.",
      trialDays: 30,
      prices: {
        create: {
          nickname: "Monthly seat",
          currency: "USD",
          unitAmount: 9900,
          interval: "month"
        }
      },
      entitlements: {
        create: [
          { key: "projects", value: "unlimited" },
          { key: "support", value: "premium" },
          { key: "audit_retention_days", value: "365" }
        ]
      }
    }
  });

  await prisma.coupon.upsert({
    where: {
      organizationId_code: {
        organizationId: organization.id,
        code: "WELCOME10"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      code: "WELCOME10",
      percentOff: 10
    }
  });

  await prisma.taxRate.upsert({
    where: {
      organizationId_name: {
        organizationId: organization.id,
        name: "California SaaS"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      name: "California SaaS",
      basisPoints: 825
    }
  });

  const customer = await prisma.customer.upsert({
    where: {
      organizationId_email: {
        organizationId: organization.id,
        email: "billing@example-customer.test"
      }
    },
    update: {},
    create: {
      organizationId: organization.id,
      email: "billing@example-customer.test",
      name: "Example Customer"
    }
  });

  const existingSubscription = await prisma.subscription.findFirst({
    where: {
      organizationId: organization.id,
      customerId: customer.id,
      planId: proPlan.id
    }
  });

  if (!existingSubscription) {
    await prisma.subscription.create({
      data: {
        organizationId: organization.id,
        customerId: customer.id,
        planId: proPlan.id,
        seatCount: 4,
        status: "trialing",
        currentPeriodStart: new Date(),
        currentPeriodEnd: addDays(new Date(), 30),
        trialEndsAt: addDays(new Date(), 14)
      }
    });
  }

  console.log("Seeded Acme tenant:", {
    organizationId: organization.id,
    ownerEmail: owner.email
  });
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
