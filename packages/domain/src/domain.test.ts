import { describe, expect, it } from "vitest";
import { calculateInvoice } from "./invoice-calculator.js";
import { formatMoney, money } from "./money.js";
import { hasPermission } from "./permissions.js";
import { canTransitionInvoice, transitionSubscription } from "./billing-state.js";
import { hashRequestPayload } from "./idempotency.js";

describe("money helpers", () => {
  it("formats integer cents without floating-point storage", () => {
    expect(formatMoney(money(1299))).toBe("$12.99");
  });
});

describe("invoice calculation", () => {
  it("applies quantity, coupon, and tax in a deterministic order", () => {
    const invoice = calculateInvoice({
      currency: "USD",
      lines: [{ description: "Pro seats", unitAmountCents: 2000, quantity: 3 }],
      couponPercentOff: 10,
      taxBasisPoints: 825
    });

    expect(invoice.subtotal.cents).toBe(6000);
    expect(invoice.discount.cents).toBe(600);
    expect(invoice.tax.cents).toBe(446);
    expect(invoice.total.cents).toBe(5846);
  });
});

describe("permissions", () => {
  it("keeps backend RBAC explicit", () => {
    expect(hasPermission("viewer", "billing:manage")).toBe(false);
    expect(hasPermission("billing_manager", "billing:manage")).toBe(true);
  });
});

describe("state machines", () => {
  it("allows only declared workflow transitions", () => {
    expect(transitionSubscription("trialing", "active")).toBe("active");
    expect(canTransitionInvoice("paid", "open")).toBe(false);
  });
});

describe("idempotency", () => {
  it("hashes equivalent object payloads consistently", () => {
    expect(hashRequestPayload({ b: 2, a: 1 })).toBe(hashRequestPayload({ a: 1, b: 2 }));
  });
});
