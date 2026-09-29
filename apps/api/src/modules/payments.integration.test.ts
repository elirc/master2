import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Runs only against a disposable PostgreSQL with the schema pushed:
//   docker run --rm -d -e POSTGRES_PASSWORD=local-test -p 5433:5432 postgres:18
//   $env:TEST_DATABASE_URL = "postgresql://postgres:local-test@127.0.0.1:5433/postgres"
//   $env:DATABASE_URL = $env:TEST_DATABASE_URL; npm run db:push
//   npx vitest run src/modules/payments.integration.test.ts   (from apps/api)
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)("mock payment webhook against a real database", () => {
  let prisma: import("@billing/db").PrismaClient;
  let svc: typeof import("./payments.service.js");
  let orgId: string, paymentId: string, invoiceId: string;
  const stamp = Date.now().toString(36);
  const tenant = () => ({
    organizationId: orgId, organizationSlug: "int-" + stamp, userId: "u", userEmail: "u@" + stamp,
    role: "owner" as const, permissions: ["payments:manage"] as never[]
  });

  beforeAll(async () => {
    process.env.DATABASE_URL = url;
    const db = await import("@billing/db");
    prisma = db.prisma;
    svc = await import("./payments.service.js");
    const org = await prisma.organization.create({ data: { name: "Int " + stamp, slug: "int-" + stamp } });
    orgId = org.id;
    const customer = await prisma.customer.create({ data: { organizationId: orgId, email: "c@" + stamp, name: "C" } });
    const invoice = await prisma.invoice.create({ data: { organizationId: orgId, customerId: customer.id, number: "INV-" + stamp, status: "open", currency: "usd", subtotal: 1000, total: 1000, dueAt: new Date() } });
    invoiceId = invoice.id;
    const payment = await prisma.payment.create({ data: { organizationId: orgId, customerId: customer.id, invoiceId, provider: "mock", status: "processing", amount: 1000, currency: "usd" } });
    paymentId = payment.id;
  });

  afterAll(async () => {
    if (!prisma) return;
    await prisma.$executeRawUnsafe('DROP TRIGGER IF EXISTS fail_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS fail_audit()");
    await prisma.webhookEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.outboxEvent.deleteMany({ where: { organizationId: orgId } });
    await prisma.auditLog.deleteMany({ where: { organizationId: orgId } });
    await prisma.payment.deleteMany({ where: { organizationId: orgId } });
    await prisma.invoice.deleteMany({ where: { organizationId: orgId } });
    await prisma.customer.deleteMany({ where: { organizationId: orgId } });
    await prisma.organization.deleteMany({ where: { id: orgId } });
    await prisma.$disconnect();
  });

  const snapshot = async () => ({
    payment: (await prisma.payment.findUniqueOrThrow({ where: { id: paymentId } })).status,
    invoice: (await prisma.invoice.findUniqueOrThrow({ where: { id: invoiceId } })).status,
    events: await prisma.webhookEvent.count({ where: { organizationId: orgId } }),
    outbox: await prisma.outboxEvent.count({ where: { organizationId: orgId } }),
    audit: await prisma.auditLog.count({ where: { organizationId: orgId } }),
  });

  it("rolls every row back when the audit write fails mid-transaction", async () => {
    await prisma.$executeRawUnsafe("CREATE OR REPLACE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected audit failure'; END $$");
    await prisma.$executeRawUnsafe('CREATE TRIGGER fail_audit BEFORE INSERT ON "AuditLog" FOR EACH ROW EXECUTE FUNCTION fail_audit()');
    const before = await snapshot();
    await expect(svc.processMockPaymentWebhook(tenant(), { providerEventId: "evt-fail-" + stamp, eventType: "payment.succeeded", paymentId })).rejects.toBeTruthy();
    expect(await snapshot()).toEqual(before);
    await prisma.$executeRawUnsafe('DROP TRIGGER fail_audit ON "AuditLog"');
    await prisma.$executeRawUnsafe("DROP FUNCTION fail_audit()");
  });

  it("processes exactly one of two identical concurrent events; the other is a 409 or a duplicate", async () => {
    const body = { providerEventId: "evt-race-" + stamp, eventType: "payment.succeeded" as const, paymentId };
    const results = await Promise.allSettled([svc.processMockPaymentWebhook(tenant(), body), svc.processMockPaymentWebhook(tenant(), body)]);
    const processed = results.filter((r) => r.status === "fulfilled" && (r.value as { processed?: boolean }).processed);
    const other = results.filter((r) => r.status === "rejected" || (r.status === "fulfilled" && (r.value as { duplicate?: boolean }).duplicate));
    expect(processed).toHaveLength(1);
    expect(other).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
    if (rejected) expect(rejected.reason).toMatchObject({ status: 409 });
    const after = await snapshot();
    expect(after.payment).toBe("succeeded");
    expect(after.invoice).toBe("paid");
    expect(after.events).toBe(1);
    expect(after.outbox).toBe(1);
  });
});
