export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export type PaymentStatus = "requires_payment_method" | "processing" | "succeeded" | "failed";

const subscriptionTransitions: Record<SubscriptionStatus, SubscriptionStatus[]> = {
  trialing: ["active", "past_due", "canceled"],
  active: ["past_due", "paused", "canceled"],
  past_due: ["active", "canceled"],
  paused: ["active", "canceled"],
  canceled: []
};

const invoiceTransitions: Record<InvoiceStatus, InvoiceStatus[]> = {
  draft: ["open", "void"],
  open: ["paid", "void", "uncollectible"],
  paid: [],
  void: [],
  uncollectible: ["paid", "void"]
};

export function canTransitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): boolean {
  return subscriptionTransitions[from].includes(to);
}

export function transitionSubscription(from: SubscriptionStatus, to: SubscriptionStatus): SubscriptionStatus {
  if (!canTransitionSubscription(from, to)) {
    throw new Error(`Cannot transition subscription from ${from} to ${to}.`);
  }

  return to;
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  return invoiceTransitions[from].includes(to);
}

export function transitionInvoice(from: InvoiceStatus, to: InvoiceStatus): InvoiceStatus {
  if (!canTransitionInvoice(from, to)) {
    throw new Error(`Cannot transition invoice from ${from} to ${to}.`);
  }

  return to;
}
