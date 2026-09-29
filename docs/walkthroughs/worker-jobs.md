# Walkthrough: `apps/worker/src/jobs.ts`

## What The File Does

This file implements asynchronous billing jobs: generating invoices and attempting mock payments.

## Why It Exists

Not every billing task belongs in the HTTP request. Workers let the API respond quickly while slower or retryable work continues separately.

## How It Connects

- API routes enqueue jobs through BullMQ.
- Worker jobs read and write Prisma records.
- Domain invoice calculation keeps money math consistent with API behavior.
- Outbox events record follow-up events for future notification and integration features.

## Important Sections

- `generateInvoice`: ensures only one invoice is generated for a subscription period, calculates totals, writes invoice lines, audit logs, and outbox events.
- `attemptPayment`: creates a deterministic mock payment and updates invoice state.

## Senior-Level Concepts

The worker checks for an existing invoice in the subscription period. This is a practical idempotency guard for retried jobs. It is not enough for every production race, but it teaches the instinct: background jobs must assume retries.

## How To Read It

Read each job as a transaction. Ask what happens if the process crashes halfway, what can be retried, and what audit trail remains.
