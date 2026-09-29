# Walkthrough: `packages/domain/src`

## What These Files Do

The domain package contains business rules that should not live inside random HTTP handlers:

- `money.ts`: integer-cent money helpers.
- `invoice-calculator.ts`: line, discount, tax, and total calculation.
- `permissions.ts`: role-to-permission mapping.
- `billing-state.ts`: subscription and invoice state transitions.
- `idempotency.ts`: stable request hashing.

## Why They Exist

Shared domain helpers keep API, worker, and tests aligned. If invoice math changes, it should change in one place and be tested directly.

## How They Connect

- API routes import permissions and invoice calculation.
- Worker jobs reuse invoice calculation.
- Tests in `domain.test.ts` cover high-risk rules quickly without needing a database.

## Important Sections

Read `calculateInvoice` after `money.ts`. It shows a clear order: line subtotals, discount, tax, total. That order matters because billing disputes often come from hidden calculation rules.

## Senior-Level Concepts

Money is stored as integer cents, not floating point. Permissions are action-based, not screen-based. State transitions are explicit so invalid transitions fail near the source.

## How To Read It

Treat this package as the system's business vocabulary. Before changing a billing route, check whether the rule belongs here.
