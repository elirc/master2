import { money, requirePermission, transitionInvoice } from "@billing/domain";
import express from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpError, errorMiddleware } from "../shared/errors.js";

const processWebhook = vi.hoisted(() => vi.fn());
const tenant = { organizationId: "org-a", organizationSlug: "acme", userId: "u1", userEmail: "a@example.com", role: "owner", permissions: ["payments:manage"] };
vi.mock("./payments.service.js", () => ({ processMockPaymentWebhook: processWebhook }));
vi.mock("../shared/auth.js", () => ({ assertPermission: vi.fn(() => tenant) }));
vi.mock("@billing/db", () => ({ prisma: { webhookEvent: { findMany: vi.fn() } } }));
const { paymentsRouter } = await import("./payments.routes.js");

describe("mock payment webhook HTTP boundary", () => {
  afterEach(() => { processWebhook.mockReset(); });

  async function request(body: string, contentType = "application/json") {
    const app = express();
    app.use(express.json());
    app.use("/api/payments", paymentsRouter);
    app.use(errorMiddleware);
    const server = await new Promise<ReturnType<typeof app.listen>>((resolve) => {
      const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
    });
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("listener address unavailable");
      return await fetch(`http://127.0.0.1:${address.port}/api/payments/webhooks/mock`, { method: "POST", headers: { "content-type": contentType }, body });
    } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
  }

  it("invokes the real route and returns service result", async () => {
    processWebhook.mockResolvedValue({ processed: true, eventId: "event-a" });
    const response = await request(JSON.stringify({ providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ processed: true, eventId: "event-a" });
    expect(processWebhook).toHaveBeenCalledWith(tenant, expect.objectContaining({ paymentId: "pay-a" }));
  });

  it("classifies malformed JSON as a 400 client error", async () => {
    const response = await request('{"providerEventId":');
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "request.invalid" });
    expect(processWebhook).not.toHaveBeenCalled();
  });

  it.each([[403, "permission.denied"], [404, "payment.not_found"], [409, "webhook.identity_conflict"]] as const)("uses shared middleware for %i", async (status, code) => {
    processWebhook.mockRejectedValue(new HttpError(status, code, "synthetic client failure"));
    const response = await request(JSON.stringify({ providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });

  it("sanitizes unexpected failures through shared middleware", async () => {
    processWebhook.mockRejectedValue(new Error("secret database detail"));
    const response = await request(JSON.stringify({ providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" }));
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ error: "Internal server error.", code: "server.internal" });
  });

  it.each([
    [400, "money.invalid", () => money(1.5)],
    [409, "billing.transition_invalid", () => transitionInvoice("void", "paid")],
    [403, "permission.denied", () => requirePermission("viewer", "payments:manage")]
  ] as const)("preserves expected domain failure as HTTP%i", async (status, code, operation) => {
    processWebhook.mockImplementation(async () => operation());
    const response = await request(JSON.stringify({ providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" }));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ code });
  });
});
