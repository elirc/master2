# Feature 004: Migration Discipline

Backlog ID: `BIL-004`

## Goal

Document how schema changes should be made, reviewed, and verified.

## Impacted Areas Of The Codebase

- `packages/db/package.json`
- `docs/migration-discipline.md`

## Implementation Approach

Add Prisma migration scripts and write a migration discipline guide for local development, review, and deployment.

## Design Considerations

Database changes are product changes. Billing systems are especially sensitive because schema mistakes can corrupt money, state, or auditability.

## Build Journal

Added `prisma:migrate` and `prisma:deploy` scripts and a migration guide. The guide explains expand/contract migrations, enum caution, seed data expectations, and review rules.

The tradeoff is that the initial project still uses `db push` for fast local setup. Real production changes should move through generated migrations as the schema stabilizes.
