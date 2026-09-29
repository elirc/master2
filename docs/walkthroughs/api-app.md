# Walkthrough: `apps/api/src/app.ts`

## What The File Does

`app.ts` composes the Express application: middleware, health checks, module routers, and shared error handling.

## Why It Exists

This file is the API entry point for request flow. It should stay small because business logic belongs in modules and shared services, not app setup.

## How It Connects

- `server.ts` starts the app.
- `attachTenantContext` loads the authenticated tenant context.
- Module routers under `apps/api/src/modules` own feature-specific endpoints.
- Health checks use Prisma to report readiness.

## Important Sections

- JSON and CORS middleware.
- `/health/live` for process liveness.
- `/health/ready` for database readiness and worker heartbeat visibility.
- Router mounting for identity, catalog, billing, payments, and platform modules.

## Senior-Level Concepts

The health endpoints skip tenant auth because deployment platforms and load balancers need to call them. Readiness includes dependency checks; liveness does not.

## How To Read It

Read top to bottom once, then jump into the mounted router for the workflow you care about.
