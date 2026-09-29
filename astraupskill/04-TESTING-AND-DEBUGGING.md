# Testing and debugging

Vitest mocks are persistent module objects. `clearAllMocks` removes call history but keeps implementations, so this project calls `vi.resetAllMocks()` in `beforeEach` and restores the transaction callback. Tests assert predicates such as `{ id, organizationId }`, side-effect counts, and exact typed errors. A test that only checks HTTP 200 could pass while writing another tenant's row.

When a test fails, first inspect whether the mock returned a row that the real predicate could return. Next inspect call order: permission denial should precede `$transaction`; missing payment should precede event creation; replay should precede payment lookup. For a route behavior, use an actual Express app and malformed JSON, because a service test cannot exercise `express.json()`.

Exercise: inject a P2034 twice. (answer: [06, chapter 04](06-SOLUTIONS-AND-REVIEW.md#chapter-04-exercise))

Keep one reason per test. Assert predicates to catch missing tenant filters, and assert forbidden calls to catch accidental writes. Verify positive results before using every/all checks. The actual route test uses a listener because a direct service call cannot exercise Express JSON parsing. If a test unexpectedly passes, first inspect whether its mock returned a row the real query could return.

Resetting implementations is especially important when one test forces contention and the next expects success. Use `void method.mockReset()` in hooks so the callback return value is not accidentally treated as a test hook promise. Restore the transaction implementation immediately after reset.

## The hook that makes the reset discipline real

This is the `beforeEach` described above, `apps/api/src/modules/payments.service.test.ts:40`. Note `void method.mockReset()` on every nested mock and the transaction implementation being restored on the last line, after the reset that removed it.

```ts
  beforeEach(() => {
    vi.resetAllMocks();
    for (const method of Object.values(tx.webhookEvent)) void method.mockReset();
    for (const method of Object.values(tx.payment)) void method.mockReset();
    for (const method of Object.values(tx.invoice)) void method.mockReset();
    void tx.auditLog.create.mockReset();
    void tx.outboxEvent.create.mockReset();
    transaction.mockImplementation(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx));
  });
```

