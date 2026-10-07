# Practice

## Warm-up: the scenario table

Build a table with columns tenant, role, event id, payload, payment status, invoice status, expected status, and expected writes. Include: viewer; foreign payment; missing invoice; success; failure; same-payload replay; changed payload; late failure; draft/void invoice; contention twice. For each row predict whether event create, payment update, invoice update, audit, and outbox calls occur, and write the expected response beside it. Then check every row against `apps/api/src/modules/payments.service.test.ts`; each has a matching case there (the model table is at the end of the review walkthrough in chapter 06). Add one row the suite does **not** have: a `payment.succeeded` with a new event id for a payment that is already `succeeded`. Read `payments.service.ts:83-116` and predict its writes before reading exercise P5.

## Runnable exercises

Each exercise has a **Goal** (what to work out) and a **Check** (a test in one file that runs against the real source). The checks need only Node 22.6 or newer, with no `npm install`: they read source files as text, and P1/P2 import the two pure domain files with Node's `--experimental-strip-types`. Save the file below anywhere outside the repository as `practice.check.mjs`, then run it **from the repository root**:

```bash
node --experimental-strip-types --test path/to/practice.check.mjs
```

On Node 22 you will see an `ExperimentalWarning` for type stripping; that is expected. Attempt each Goal on paper first, then run the Check. If a check fails after you have edited the code, the failure is the lesson: explain it before reverting.

**P1. Payload identity.** Goal: explain why the same event with its keys reordered is a replay, but the same event with another `paymentId` is a conflict. Check: `P1` imports `packages/domain/src/idempotency.ts` and compares hashes.

**P2. Which invoices can a success pay?** Goal: from `packages/domain/src/billing-state.ts:22-28`, list the invoice states that may become `paid`, then explain why a `paid` invoice does not trip the 409 at `payments.service.ts:69`. Check: `P2` runs the real `canTransitionInvoice` over all five states and asserts the service's `invoice.status !== "paid"` short-circuit.

**P3. Guard order.** Goal: list, in order, every step that runs before the first write, and say which refusal each one produces. Check: `P3` asserts the eight steps appear in that order inside `processMockPaymentWebhook`.

**P4. Transaction ownership.** Goal: prove that nothing inside the `$transaction` callback uses the global `prisma` client. Check: `P4` scans the callback text for `prisma.` and confirms the audit and outbox helpers receive `tx`.

**P5. The second success.** Goal: for a payment already `succeeded`, predict the payment update, invoice update, audit and outbox writes of (a) a late failure and (b) a new success event. Check: `P5` pins the guard on line 110 and evaluates its truth table. Then read finding F2 in chapter 06.

**P6. Who is a request with no headers?** Goal: trace `attachTenantContext` with neither `x-org-slug` nor `x-user-email` set and name the resulting role. Check: `P6` follows the defaults through `auth.ts`, `config.ts` and `seed.ts`.

**P7. Recount the evidence.** Goal: verify the "30 tests: 5 domain, 16 service, 9 route" claim in VERIFICATION by counting, and note what the count leaves out. Check: `P7` counts `it(` and `it.each(` blocks; the `it.each` tables have 2 rows each in the service suite and 3 rows each in the route suite.

**P8. The other payment path.** Goal: compare how the webhook and the worker's `attemptPayment` decide an invoice may be paid. Check: `P8` confirms the worker only checks `status === "paid"` and never calls `canTransitionInvoice` (finding F6).

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const read = (p) => readFileSync(resolve(p), "utf8");
const svc = read("apps/api/src/modules/payments.service.ts");

test("P1 payload identity: key order ignored, meaning not", async () => {
  const { hashRequestPayload } = await import(pathToFileURL(resolve("packages/domain/src/idempotency.ts")).href);
  const a = { providerEventId: "evt-1234", eventType: "payment.succeeded", paymentId: "pay-a" };
  const reordered = { paymentId: "pay-a", eventType: "payment.succeeded", providerEventId: "evt-1234" };
  assert.equal(hashRequestPayload(a), hashRequestPayload(reordered));
  assert.notEqual(hashRequestPayload(a), hashRequestPayload({ ...a, paymentId: "pay-b" }));
  assert.notEqual(hashRequestPayload(a), hashRequestPayload({ ...a, providerEventId: " evt-1234" }));
});

test("P2 which invoice states can a success pay?", async () => {
  // billing-state.ts imports ./errors.js, which type-stripping cannot map to errors.ts,
  // so load a copy with that import removed (only canTransitionInvoice is called).
  const src = read("packages/domain/src/billing-state.ts").replace(/^import .*errors\.js";\r?\n/m, "");
  const file = join(mkdtempSync(join(tmpdir(), "m2-")), "billing-state.ts");
  writeFileSync(file, src);
  const { canTransitionInvoice } = await import(pathToFileURL(file).href);
  const payable = ["draft", "open", "paid", "void", "uncollectible"].filter((s) => canTransitionInvoice(s, "paid"));
  assert.deepEqual(payable, ["open", "uncollectible"]);
  // a "paid" invoice is not payable, yet the service skips the guard for it:
  assert.match(svc, /invoice\.status !== "paid" && !canTransitionInvoice\(invoice\.status, "paid"\)/);
});

test("P3 guards run in order before the first write", () => {
  const order = ["requirePaymentPermission(tenant)", "parseMockWebhook(input)", "prisma.$transaction",
    "tx.webhookEvent.findUnique", "tx.payment.findFirst", "tx.invoice.findFirst",
    "tx.webhookEvent.create", "tx.payment.update"];
  const body = svc.slice(svc.indexOf("export async function processMockPaymentWebhook"));
  const idx = order.map((needle) => body.indexOf(needle));
  assert.ok(idx.every((i) => i >= 0), "every step is present");
  assert.deepEqual([...idx].sort((x, y) => x - y), idx);
});

test("P4 nothing inside the transaction callback escapes to global prisma", () => {
  const start = svc.indexOf("prisma.$transaction(async (tx) => {");
  const end = svc.indexOf("isolationLevel: Prisma.TransactionIsolationLevel.Serializable");
  const callback = svc.slice(start + "prisma.$transaction".length, end);
  assert.equal((callback.match(/\bprisma\./g) ?? []).length, 0);
  assert.match(callback, /writeAuditLog\(tx,/);
  assert.match(callback, /writeOutboxEvent\(tx,/);
});

test("P5 outbox truth table: success on an already-succeeded payment", () => {
  assert.match(svc, /if \(!\(alreadySucceeded && !succeeded\)\) \{\s*await writeOutboxEvent/);
  const emits = (alreadySucceeded, succeeded) => !(alreadySucceeded && !succeeded);
  assert.equal(emits(true, false), false); // late failure: suppressed
  assert.equal(emits(true, true), true);   // second success, new event id: ANOTHER payment.succeeded
});

test("P6 a request with no headers is the seeded owner", () => {
  assert.match(read("apps/api/src/shared/auth.ts"), /request\.header\("x-org-slug"\) \?\? "acme"/);
  assert.match(read("apps/api/src/config.ts"), /DEFAULT_USER_EMAIL: z\.string\(\)\.email\(\)\.default\("owner@acme\.test"\)/);
  const seed = read("packages/db/prisma/seed.ts");
  assert.match(seed, /email: "owner@acme\.test"/);
  assert.match(seed, /role: "owner"/);
});

test("P7 recount the recorded test totals", () => {
  const count = (p, re) => (read(p).match(re) ?? []).length;
  const s = "apps/api/src/modules/payments.service.test.ts", r = "apps/api/src/modules/payments.routes.test.ts";
  assert.equal(count(s, /^\s+it\(/gm), 12);      // + 2 it.each x 2 rows = 16
  assert.equal(count(s, /^\s+it\.each\(/gm), 2);
  assert.equal(count(r, /^\s+it\(/gm), 3);       // + 2 it.each x 3 rows = 9
  assert.equal(count(r, /^\s+it\.each\(/gm), 2);
  assert.equal(count("packages/domain/src/domain.test.ts", /^\s+it\(/gm), 5);
  assert.equal(count("apps/api/src/modules/payments.integration.test.ts", /^\s+it\(/gm), 2); // skipped without TEST_DATABASE_URL
});

test("P8 the worker pays invoices without the domain transition table", () => {
  const jobs = read("apps/worker/src/jobs.ts");
  const attempt = jobs.slice(jobs.indexOf("export async function attemptPayment"));
  assert.match(attempt, /if \(invoice\.status === "paid"\)/);
  assert.doesNotMatch(jobs, /canTransitionInvoice/);
});
```

Expected result on the unmodified repository (verified 2026-10-06 with Node 22.16.0): `# tests 8`, `# pass 8`, `# fail 0`.

## Stretch: write the missing Vitest case

Once dependencies are installed, add the test the suite lacks to `payments.service.test.ts`: `payment("succeeded")`, `invoice("paid")`, a `payment.succeeded` body with a new event id, and an assertion that `tx.outboxEvent.create` was not called. Predict that it **fails** on the current code (F2). Make it pass with the smallest change to line 110, then confirm the existing late-failure test still passes. Do not add a real payment network or start workers; the goal is a reviewable local contract whose assumptions are visible.

Answers for P1-P8 are in [06, Practice answers](06-SOLUTIONS-AND-REVIEW.md#practice-answers).
