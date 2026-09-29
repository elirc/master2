# Practice

Build a scenario table with columns tenant, role, event id, payload, payment status, invoice status, expected status, and expected writes. Include: viewer; foreign payment; missing invoice; success; failure; same-payload replay; changed payload; late failure; and contention. For each row predict whether payment, invoice, audit, and outbox calls occur.

Implement one test at a time in `payments.service.test.ts`. Use `vi.hoisted` fixtures, return null for rows hidden by tenant predicates, and reset all implementations before each test. For route practice, compose `express()`, `express.json()`, and `paymentsRouter`; use the shared errorMiddleware, mock permission and service dependencies, then send a truncated JSON body with `fetch`.

Matched checkpoint: the payment service cases and real-router cases are listed in VERIFICATION. The route boundary returns 400 for malformed JSON through the same error middleware used by the application. Explain every expected call in a comment. Do not add a real payment network or start workers. The goal is a reviewable local contract whose assumptions are visible.

Write the expected response beside each scenario before running it. Success returns processed and an event id; duplicate returns its marker and id; failures return a stable code. Ensure provider ids satisfy the four-character schema and label every fake limitation. This keeps the exercise reviewable by a junior learner while still requiring senior-level attention to predicates and side effects.

A complete answer includes why a write is absent. For missing invoice, no event, audit, or outbox should exist. For replay, no payment read is necessary. For late failure, audit remains as an operator record but state and outbox stay unchanged.

Record the actual call arguments in your solution. This turns the exercise into evidence that tenant boundaries and transaction ownership were preserved, rather than a superficial status-code demonstration.
