# Feature 002: Local Dev, CI, And Quality Gates

Backlog ID: `BIL-002`

## Goal

Make the project easy to verify locally and in CI with the same commands.

## Impacted Areas Of The Codebase

- Root `package.json` scripts.
- `.github/workflows/ci.yml`.
- Prisma client generation as a required CI step.

## Implementation Approach

Add a root `verify` script that runs typecheck, tests, and build. Add a GitHub Actions workflow that installs dependencies, generates Prisma client code, and runs verification against PostgreSQL and Redis service containers.

## Design Considerations

The workflow intentionally runs boring checks first. A junior developer should learn that CI is not magic; it is a repeatable version of local verification with clean dependencies.

## Build Journal

Implemented a root `npm run verify` command and CI workflow. The workflow uses Node 22, npm cache, PostgreSQL 16, and Redis 7. It runs `npm ci`, `npm run db:generate`, and `npm run verify`.

This connects to the rest of the system by making generated Prisma client code and workspace builds explicit. The tradeoff is that CI does not yet run browser E2E tests or apply real migrations; those arrive later when Playwright and migration discipline mature.
