# Walkthrough: `packages/db/prisma/schema.prisma`

## What The File Does

This file defines the durable data model for the platform. It is the source of truth for tenant-owned data, billing workflow state, auditability, idempotency, and worker coordination.

## Why It Exists

Enterprise billing systems are mostly about preserving correct state over time. The schema makes important business concepts explicit instead of hiding them in unstructured JSON or route logic.

## How It Connects

- `packages/db/src/index.ts` exports the Prisma client used by API and worker code.
- `apps/api/src/modules/*.routes.ts` query tenant-owned rows through this schema.
- `apps/worker/src/jobs.ts` creates invoices and payments from subscription records.
- `packages/domain` helpers calculate money and validate state, but persistence happens here.

## Important Sections

- Organization, User, Membership, Team: tenant identity and RBAC foundation.
- Plan, Price, Entitlement, Coupon, TaxRate: product catalog.
- Customer, Subscription, Invoice, InvoiceLine, Payment: billing workflow.
- WebhookEvent, IdempotencyKey: retry-safe external command handling.
- AuditLog, OutboxEvent, WorkerHeartbeat: operational traceability.

## Senior-Level Concepts

Notice that most tenant-owned models include `organizationId`. This is not just a convenience field; it is a safety boundary. Also notice explicit enums for subscription, invoice, payment, and outbox status. Real systems avoid many booleans because boolean combinations create ambiguous states.

## How To Read It

Start with `Organization`, then follow relations outward. Ask which rows belong to a tenant, which rows are append-only, and which rows represent workflow state.
