export type Moneyish = {
  total: number;
  currency: string;
};

export type DashboardResponse = {
  metrics: {
    customers: number;
    subscriptions: Record<string, number>;
    openInvoiceTotal: number;
    successfulPaymentTotal: number;
  };
  invoices: Invoice[];
  payments: Payment[];
};

export type IdentityResponse = {
  user: {
    id: string;
    email: string;
    role: string;
    permissions: string[];
  };
  organization: {
    id: string;
    name: string;
    slug: string;
    status: string;
  };
  members: Array<{
    id: string;
    name: string;
    email: string;
    role: string;
  }>;
  teams: Array<{
    id: string;
    name: string;
    memberCount: number;
  }>;
};

export type Plan = {
  id: string;
  name: string;
  code: string;
  description: string;
  trialDays: number;
  prices: Array<{
    id: string;
    nickname: string;
    currency: string;
    unitAmount: number;
    interval: string;
  }>;
  entitlements: Array<{
    key: string;
    value: string;
  }>;
};

export type Customer = {
  id: string;
  name: string;
  email: string;
  subscriptions: Subscription[];
  invoices: Invoice[];
};

export type Subscription = {
  id: string;
  status: string;
  seatCount: number;
  currentPeriodEnd: string;
  customer?: Customer;
  plan: Plan;
};

export type Invoice = {
  id: string;
  number: string;
  status: string;
  currency: string;
  subtotal: number;
  discount: number;
  tax: number;
  total: number;
  dueAt: string;
  customer?: {
    name: string;
    email: string;
  };
  lines?: Array<{
    description: string;
    quantity: number;
    unitAmount: number;
    subtotal: number;
  }>;
  payments?: Payment[];
};

export type Payment = {
  id: string;
  status: string;
  amount: number;
  currency: string;
  provider: string;
  failureMessage?: string | null;
  createdAt: string;
};

export type AuditLog = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  metadata: Record<string, unknown>;
  createdAt: string;
};
