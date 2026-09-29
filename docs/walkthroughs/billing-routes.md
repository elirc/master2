# Walkthrough: `apps/api/src/modules/billing.routes.ts`

## What The File Does

This router owns customer, subscription, invoice, and payment-queue API workflows.

## Why It Exists

Billing is a central module with high coordination cost. Keeping its routes together makes it easier to trace workflow state while the project is still a modular monolith.

## How It Connects

- Uses `assertPermission` for backend authorization.
- Uses Prisma for tenant-scoped reads and writes.
- Uses `runIdempotent` for subscription creation.
- Uses domain invoice calculation.
- Writes audit logs and outbox events.
- Queues worker jobs through BullMQ.

## Important Sections

- `GET /dashboard`: aggregates operational metrics.
- `POST /customers`: creates tenant-owned customers.
- `POST /subscriptions`: creates subscriptions transactionally and queues invoice work.
- `createInvoiceForSubscription`: turns subscription, price, coupon, and tax records into invoice rows.
- `POST /invoices/:invoiceId/pay`: queues a payment attempt.

## Senior-Level Concepts

This file shows why route handlers need boundaries. A single business action can require validation, authorization, tenant scoping, transactions, audit logs, idempotency, and async jobs. When this file grows, the next refactor should extract billing services while keeping the same workflow shape.

## How To Read It

Trace `POST /subscriptions` first. It is the best example of a real backend workflow in the initial system.
