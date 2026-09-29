# Walkthrough: `apps/web/src/App.tsx`

## What The File Does

This file provides the initial React operator interface: dashboard, customers, subscriptions, catalog, customer portal, and audit views.

## Why It Exists

The frontend is intentionally workflow-shaped. It is not a marketing page; it is an operational surface for exercising backend workflows.

## How It Connects

- `api.ts` sends requests with development tenant headers.
- Dashboard and list views read API data.
- Action buttons create customers, create subscriptions, generate invoices, and queue payments.

## Important Sections

- `refresh`: loads the main data slices in parallel.
- Topbar actions: trigger core write workflows.
- View components: keep each operational screen readable while sharing one file for the initial version.

## Senior-Level Concepts

Frontend role checks are not security. This UI may hide or show actions later, but the backend remains the source of truth through `assertPermission`.

## How To Read It

Start at `App`, then follow one action button into `postJson`, then into the matching API route.
