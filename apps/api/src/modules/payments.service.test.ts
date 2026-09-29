import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TenantContext } from "../shared/types.js";

const { prisma, transaction, tx, KnownRequestError } = vi.hoisted(() => {
  class KnownRequestError extends Error {
    constructor(public code: string) { super("Synthetic Prisma contention"); }
  }
  const tx = {
    webhookEvent: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
    payment: { findFirst: vi.fn(), update: vi.fn() },
    invoice: { findFirst: vi.fn(), update: vi.fn() },
    auditLog: { create: vi.fn() },
    outboxEvent: { create: vi.fn() }
  };
  const transaction = vi.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  return { prisma: { $transaction: transaction }, transaction, tx, KnownRequestError };
});

vi.mock("@billing/db", () => ({
  prisma,
  Prisma: {
    TransactionIsolationLevel: { Serializable: "Serializable" },
    PrismaClientKnownRequestError: KnownRequestError
  }
}));

const { processMockPaymentWebhook } = await import("./payments.service.js");

const owner: TenantContext = {
  organizationId: "org-a", organizationSlug: "acme", userId: "user-a", userEmail: "a@example.com",
  role: "owner", permissions: ["payments:manage"]
};
const viewer: TenantContext = { ...owner, role: "viewer", permissions: ["billing:read"] };
const body = { providerEventId: "evt-1234", eventType: "payment.succeeded" as const, paymentId: "pay-a" };

function payment(status = "processing") { return { id: "pay-a", organizationId: "org-a", invoiceId: "inv-a", status }; }
function invoice(status = "open") { return { id: "inv-a", status }; }

describe("processMockPaymentWebhook", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    for (const method of Object.values(tx.webhookEvent)) void method.mockReset();
    for (const method of Object.values(tx.payment)) void method.mockReset();
    for (const method of Object.values(tx.invoice)) void method.mockReset();
    void tx.auditLog.create.mockReset();
    void tx.outboxEvent.create.mockReset();
    transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  });

  it("denies viewers before opening a transaction", async () => {
    await expect(processMockPaymentWebhook(viewer, body)).rejects.toMatchObject({ status: 403, code: "permission.denied" });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("scopes payment and invoice reads and leaves denied targets unwritten", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(null);
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 404, code: "payment.not_found" });
    expect(tx.webhookEvent.create).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
    expect(tx.payment.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pay-a", organizationId: "org-a" } }));
  });

  it("clears stale failure fields when a failed payment later succeeds", async () => {
    const retry = { providerEventId: "evt-retry", eventType: "payment.succeeded" as const, paymentId: "pay-a" };
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment("failed"));
    tx.invoice.findFirst.mockResolvedValue(invoice("open"));
    tx.webhookEvent.create.mockResolvedValue({ id: "event-retry", organizationId: "org-a", processedAt: null, payload: retry });
    await processMockPaymentWebhook(owner, retry);
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ failureCode: null, failureMessage: null }) }));
  });

  it("processes a success with event, payment, invoice, audit and outbox in one transaction", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(invoice());
    tx.webhookEvent.create.mockResolvedValue({ id: "event-a", organizationId: "org-a", processedAt: null, payload: body });
    const result = await processMockPaymentWebhook(owner, body);
    expect(result).toMatchObject({ processed: true, eventId: "event-a", ignoredFailure: false });
    expect(transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "pay-a" }, data: expect.objectContaining({ status: "succeeded" }) }));
    expect(tx.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv-a" }, data: expect.objectContaining({ status: "paid" }) }));
    expect(tx.webhookEvent.update).toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalled();
    expect(tx.outboxEvent.create).toHaveBeenCalled();
  });

  it("returns a same-payload replay without duplicate side effects", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue({ id: "event-a", organizationId: "org-a", processedAt: new Date(), payload: body });
    const result = await processMockPaymentWebhook(owner, body);
    expect(result).toEqual({ duplicate: true, eventId: "event-a" });
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  it("rejects a provider id collision across tenant or payload", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue({ id: "event-x", organizationId: "org-b", processedAt: null, payload: body });
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 409, code: "webhook.identity_conflict" });
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expect(tx.webhookEvent.create).not.toHaveBeenCalled();
  });

  it("does not regress a succeeded payment on a later failed notification", async () => {
    const failure = { providerEventId: "evt-fail", eventType: "payment.failed" as const, paymentId: "pay-a", failureCode: "late" };
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment("succeeded"));
    tx.invoice.findFirst.mockResolvedValue(invoice("paid"));
    tx.webhookEvent.create.mockResolvedValue({ id: "event-fail", organizationId: "org-a", processedAt: null, payload: failure });
    const result = await processMockPaymentWebhook(owner, failure);
    expect(result).toMatchObject({ processed: true, ignoredFailure: true });
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ action: "payment.failed.ignored" }) }));
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  });

  function expectNoWrites() {
    expect(tx.webhookEvent.create).not.toHaveBeenCalled();
    expect(tx.webhookEvent.update).not.toHaveBeenCalled();
    expect(tx.payment.update).not.toHaveBeenCalled();
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).not.toHaveBeenCalled();
    expect(tx.outboxEvent.create).not.toHaveBeenCalled();
  }

  it("rejects a missing scoped invoice before claiming the event", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(null);
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 404, code: "invoice.not_found" });
    expect(tx.invoice.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "inv-a", organizationId: "org-a" } }));
    expectNoWrites();
  });

  it("rejects a changed payload under the same tenant event identity", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue({ id: "event-a", organizationId: "org-a", processedAt: new Date(), payload: { ...body, paymentId: "pay-other" } });
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 409, code: "webhook.identity_conflict" });
    expect(tx.payment.findFirst).not.toHaveBeenCalled();
    expectNoWrites();
  });

  it("records a legitimate failure without marking its invoice paid", async () => {
    const failure = { ...body, eventType: "payment.failed", failureCode: "declined", failureMessage: "Synthetic decline" };
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(invoice());
    tx.webhookEvent.create.mockResolvedValue({ id: "failed-event" });
    await expect(processMockPaymentWebhook(owner, failure)).resolves.toMatchObject({ processed: true, ignoredFailure: false });
    expect(tx.payment.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "failed", failureCode: "declined", failureMessage: "Synthetic decline" }) }));
    expect(tx.invoice.update).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledTimes(1);
    expect(tx.outboxEvent.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ topic: "payment.failed" }) }));
    expect(tx.webhookEvent.update).toHaveBeenCalledTimes(1);
  });

  it.each(["P2002", "P2034"])("bounds %s contention retries and exposes typed409", async (code) => {
    transaction.mockRejectedValue(new KnownRequestError(code));
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 409, code: "webhook.claim_conflict" });
    expect(transaction).toHaveBeenCalledTimes(2);
    expectNoWrites();
  });

  it.each(["draft", "void"])("rejects paying a %s invoice before any mutation", async (status) => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(invoice(status));
    await expect(processMockPaymentWebhook(owner, body)).rejects.toMatchObject({ status: 409, code: "invoice.transition_invalid" });
    expectNoWrites();
  });

  it("permits the existing uncollectible-to-paid domain transition", async () => {
    tx.webhookEvent.findUnique.mockResolvedValue(null);
    tx.payment.findFirst.mockResolvedValue(payment());
    tx.invoice.findFirst.mockResolvedValue(invoice("uncollectible"));
    tx.webhookEvent.create.mockResolvedValue({ id: "recovered-event" });
    await processMockPaymentWebhook(owner, body);
    expect(tx.invoice.update).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ status: "paid" }) }));
  });

  it("rejects unknown request keys before opening a transaction", async () => {
    await expect(processMockPaymentWebhook(owner, { ...body, organizationId: "org-b" })).rejects.toMatchObject({ status: 400, code: "webhook.invalid" });
    expect(transaction).not.toHaveBeenCalled();
  });
});
