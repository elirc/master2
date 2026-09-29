import {
  Activity,
  BadgeDollarSign,
  BookOpenCheck,
  Building2,
  CreditCard,
  FileClock,
  Layers3,
  Play,
  RefreshCw,
  Search,
  ShieldCheck,
  Users
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getJson, postJson } from "./api.js";
import type { AuditLog, Customer, DashboardResponse, IdentityResponse, Invoice, Plan, Subscription } from "./types.js";

type View = "dashboard" | "customers" | "subscriptions" | "catalog" | "portal" | "audit";

const navItems: Array<{ id: View; label: string; icon: typeof Activity }> = [
  { id: "dashboard", label: "Dashboard", icon: Activity },
  { id: "customers", label: "Customers", icon: Users },
  { id: "subscriptions", label: "Subscriptions", icon: Layers3 },
  { id: "catalog", label: "Catalog", icon: BookOpenCheck },
  { id: "portal", label: "Portal", icon: CreditCard },
  { id: "audit", label: "Audit", icon: ShieldCheck }
];

export function App() {
  const [view, setView] = useState<View>("dashboard");
  const [identity, setIdentity] = useState<IdentityResponse | null>(null);
  const [dashboard, setDashboard] = useState<DashboardResponse | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const [identityData, dashboardData, planData, customerData, subscriptionData, invoiceData, auditData] =
        await Promise.all([
          getJson<IdentityResponse>("/api/identity/me"),
          getJson<DashboardResponse>("/api/billing/dashboard"),
          getJson<{ plans: Plan[] }>("/api/catalog/plans"),
          getJson<{ customers: Customer[] }>(`/api/billing/customers${search ? `?search=${encodeURIComponent(search)}` : ""}`),
          getJson<{ subscriptions: Subscription[] }>("/api/billing/subscriptions"),
          getJson<{ invoices: Invoice[] }>("/api/billing/invoices"),
          getJson<{ logs: AuditLog[] }>("/api/platform/audit-logs")
        ]);
      setIdentity(identityData);
      setDashboard(dashboardData);
      setPlans(planData.plans);
      setCustomers(customerData.customers);
      setSubscriptions(subscriptionData.subscriptions);
      setInvoices(invoiceData.invoices);
      setAuditLogs(auditData.logs);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Unable to load dashboard.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  const activePlan = plans[0];
  const activeCustomer = customers[0];
  const activeSubscription = subscriptions[0];
  const openInvoice = invoices.find((invoice) => invoice.status === "open");

  async function createCustomer() {
    await postJson("/api/billing/customers", {
      name: `Customer ${customers.length + 1}`,
      email: `customer-${Date.now()}@example.test`
    });
    await refresh();
  }

  async function createSubscription() {
    if (!activeCustomer || !activePlan) {
      setError("Create a customer and plan first.");
      return;
    }

    await postJson(
      "/api/billing/subscriptions",
      {
        customerId: activeCustomer.id,
        planId: activePlan.id,
        seatCount: 3,
        periodDays: 30,
        startWithTrial: true
      },
      `sub_${activeCustomer.id}_${activePlan.id}_${Date.now()}`
    );
    await refresh();
  }

  async function generateInvoice() {
    if (!activeSubscription) {
      setError("No subscription is available for invoicing.");
      return;
    }

    await postJson(`/api/billing/subscriptions/${activeSubscription.id}/invoices`, {});
    await refresh();
  }

  async function queuePayment() {
    if (!openInvoice) {
      setError("No open invoice is available for payment.");
      return;
    }

    await postJson(`/api/billing/invoices/${openInvoice.id}/pay`, {});
    await refresh();
  }

  const content = useMemo(() => {
    if (view === "dashboard") {
      return <Dashboard dashboard={dashboard} invoices={invoices} />;
    }
    if (view === "customers") {
      return <Customers customers={customers} search={search} setSearch={setSearch} refresh={refresh} />;
    }
    if (view === "subscriptions") {
      return <Subscriptions subscriptions={subscriptions} />;
    }
    if (view === "catalog") {
      return <Catalog plans={plans} />;
    }
    if (view === "portal") {
      return <Portal customer={activeCustomer} invoices={invoices} />;
    }
    return <Audit logs={auditLogs} />;
  }, [view, dashboard, invoices, customers, search, subscriptions, plans, activeCustomer, auditLogs]);

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <BadgeDollarSign size={28} />
          <div>
            <strong>LedgerStack</strong>
            <span>{identity?.organization.name ?? "Billing Platform"}</span>
          </div>
        </div>
        <nav>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.id}
                className={view === item.id ? "active" : ""}
                onClick={() => setView(item.id)}
                title={item.label}
              >
                <Icon size={18} />
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>
      </aside>

      <section className="workspace">
        <header className="topbar">
          <div>
            <span className="eyebrow">{identity?.user.role ?? "loading"}</span>
            <h1>{navItems.find((item) => item.id === view)?.label}</h1>
          </div>
          <div className="actions">
            <button onClick={createCustomer} title="Create customer">
              <Users size={17} />
              <span>Customer</span>
            </button>
            <button onClick={createSubscription} title="Create subscription">
              <Layers3 size={17} />
              <span>Subscribe</span>
            </button>
            <button onClick={generateInvoice} title="Generate invoice">
              <FileClock size={17} />
              <span>Invoice</span>
            </button>
            <button onClick={queuePayment} title="Queue payment">
              <Play size={17} />
              <span>Pay</span>
            </button>
            <button className="iconButton" onClick={refresh} title="Refresh">
              <RefreshCw size={18} />
            </button>
          </div>
        </header>

        {error ? <div className="error">{error}</div> : null}
        {loading ? <div className="loading">Loading operational data...</div> : content}
      </section>
    </main>
  );
}

function Dashboard({ dashboard, invoices }: { dashboard: DashboardResponse | null; invoices: Invoice[] }) {
  const metrics = dashboard?.metrics;
  return (
    <div className="stack">
      <section className="metricGrid">
        <Metric label="Customers" value={metrics?.customers ?? 0} />
        <Metric label="Active subs" value={metrics?.subscriptions.active ?? 0} />
        <Metric label="Open invoices" value={formatCents(metrics?.openInvoiceTotal ?? 0)} />
        <Metric label="Paid revenue" value={formatCents(metrics?.successfulPaymentTotal ?? 0)} />
      </section>
      <section className="panel">
        <div className="panelHeader">
          <h2>Invoice Queue</h2>
          <span>{invoices.length} records</span>
        </div>
        <InvoiceTable invoices={invoices} />
      </section>
    </div>
  );
}

function Customers({
  customers,
  search,
  setSearch,
  refresh
}: {
  customers: Customer[];
  search: string;
  setSearch: (value: string) => void;
  refresh: () => Promise<void>;
}) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Tenant Customers</h2>
        <label className="searchBox">
          <Search size={16} />
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            onBlur={() => refresh()}
            placeholder="Search"
          />
        </label>
      </div>
      <div className="cards">
        {customers.map((customer) => (
          <article className="card" key={customer.id}>
            <strong>{customer.name}</strong>
            <span>{customer.email}</span>
            <div className="cardStats">
              <span>{customer.subscriptions.length} subs</span>
              <span>{customer.invoices.length} invoices</span>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Subscriptions({ subscriptions }: { subscriptions: Subscription[] }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Subscription State</h2>
        <span>{subscriptions.length} subscriptions</span>
      </div>
      <div className="rows">
        {subscriptions.map((subscription) => (
          <div className="row" key={subscription.id}>
            <div>
              <strong>{subscription.customer?.name ?? "Customer"}</strong>
              <span>{subscription.plan.name}</span>
            </div>
            <Status value={subscription.status} />
            <span>{subscription.seatCount} seats</span>
            <span>{new Date(subscription.currentPeriodEnd).toLocaleDateString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Catalog({ plans }: { plans: Plan[] }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Plan Catalog</h2>
        <span>{plans.length} plans</span>
      </div>
      <div className="cards">
        {plans.map((plan) => (
          <article className="card" key={plan.id}>
            <strong>{plan.name}</strong>
            <span>{plan.description}</span>
            <div className="priceLine">{formatCents(plan.prices[0]?.unitAmount ?? 0)} / {plan.prices[0]?.interval ?? "month"}</div>
            <div className="chips">
              {plan.entitlements.map((entitlement) => (
                <span key={entitlement.key}>{entitlement.key}: {entitlement.value}</span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function Portal({ customer, invoices }: { customer?: Customer; invoices: Invoice[] }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>{customer?.name ?? "Customer Portal"}</h2>
        <span>{customer?.email ?? "No customer selected"}</span>
      </div>
      <InvoiceTable invoices={invoices.slice(0, 6)} />
    </section>
  );
}

function Audit({ logs }: { logs: AuditLog[] }) {
  return (
    <section className="panel">
      <div className="panelHeader">
        <h2>Audit Trail</h2>
        <span>{logs.length} events</span>
      </div>
      <div className="rows">
        {logs.map((log) => (
          <div className="row auditRow" key={log.id}>
            <div>
              <strong>{log.action}</strong>
              <span>{log.entityType} {log.entityId.slice(0, 8)}</span>
            </div>
            <span>{new Date(log.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function InvoiceTable({ invoices }: { invoices: Invoice[] }) {
  return (
    <div className="table">
      <div className="tableHead">
        <span>Number</span>
        <span>Customer</span>
        <span>Status</span>
        <span>Total</span>
        <span>Due</span>
      </div>
      {invoices.map((invoice) => (
        <div className="tableRow" key={invoice.id}>
          <strong>{invoice.number}</strong>
          <span>{invoice.customer?.name ?? "Customer"}</span>
          <Status value={invoice.status} />
          <span>{formatCents(invoice.total)}</span>
          <span>{new Date(invoice.dueAt).toLocaleDateString()}</span>
        </div>
      ))}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function Status({ value }: { value: string }) {
  return <span className={`status ${value}`}>{value.replaceAll("_", " ")}</span>;
}

function formatCents(cents: number) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}
