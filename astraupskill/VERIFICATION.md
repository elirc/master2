# Verification and remaining limits

Run these commands from the project root after installing Node.js and npm. The recorded environment used Node 22.16.0. The connection string below is deliberately synthetic: generating a Prisma client and validating a schema do not establish a database connection. These checks did not run database push, migrations, seed, Redis, worker jobs, or a payment provider.

```powershell
npm ci
$env:DATABASE_URL = "postgresql://test:test@127.0.0.1:65432/unused"
npm run db:generate
node node_modules/prisma/build/index.js validate --schema packages/db/prisma/schema.prisma
npm run verify
```

`verify` first builds the domain and database packages so workspace imports can resolve their compiled entry points, then typechecks the workspaces, runs their tests, and builds all packages and applications. Running an API test directly before building its workspace dependencies can fail for setup reasons even when its source is valid. Read the first failing command rather than treating every later missing-import error as a separate bug.

The final [verification record](evidence/root-verify-01.json) reports exit code zero (recorded 2026-09-12; the referenced `.log` files were not committed, so only the JSON summaries are in `evidence/`). All **30 tests passed**: five existing domain tests, sixteen payment-service tests, and nine HTTP-route tests. The service suite checks tenant ownership, changed-payload replay, valid payment failure, late failure after success, missing invoices, rejected draft/void invoice transitions, valid uncollectible payment, strict payload rejection, and bounded retries for Prisma conflict codes. The route suite exercises an actual Express router, JSON parser, and the shared error middleware; its payment service and permission function are mocked. It verifies expected domain errors remain useful 400/403/409 responses while unexpected errors become a safe 500 response.

The [schema validation](evidence/prisma_validate_v2.json) and [client generation](evidence/root-generate-01.json) also passed. The full build compiled API, worker, shared packages, and the Vite frontend. These are compilation results; they do not demonstrate browser interaction or a running worker. [The machine-readable summary](evidence/results.json) states the same scope and test counts.

Prisma transaction callbacks are mocked in the service tests. They prove calls, arguments, decisions, and retry limits, but cannot prove PostgreSQL rollback, concurrent serialization, row locks, or durability. Those two scenarios now exist as `apps/api/src/modules/payments.integration.test.ts`: an injected `AuditLog` trigger failure that must leave every count unchanged, and two identical concurrent events of which exactly one may process. The file skips unless `TEST_DATABASE_URL` is set (line 10), is outside the recorded 30, and has no recorded result here; its header comment lists the disposable-PostgreSQL commands. The current synthetic provider route has no real signature verification, and demo headers are not production authentication. Full application membership wiring is not covered by the route fixture. Subscription idempotency and count-based invoice numbering retain their pre-existing race risks. Review these boundaries before describing the project as production-ready.

## Dependency-free checks (2026-10-06)

The eight practice checks in [05-PRACTICE](05-PRACTICE.md) were run on the unmodified repository with Node 22.16.0 and no `node_modules`: `node --experimental-strip-types --test practice.check.mjs` reported 8 pass, 0 fail. They read source text and execute only the two pure domain files, so they confirm structure and the hashing and transition rules, not runtime behaviour of the API.

## Run the app and watch a webhook

Dated note (2026-10-06): an earlier version of this section said `db:seed` creates an open invoice and a payment. It does not: `packages/db/prisma/seed.ts` creates the Acme organization, the owner `owner@acme.test`, two plans, a coupon, a tax rate, one customer and one `trialing` subscription, and no invoice or payment. Payments are created only by the worker's `attemptPayment` (`apps/worker/src/jobs.ts:107`), so the flow below needs Redis and the worker. These steps were not executed for this revision.

```powershell
docker compose up -d            # PostgreSQL 16 on 5432 (billing/billing, db billing_platform) and Redis 7 on 6379
npm install
npm run db:generate
npm run db:push
npm run db:seed
npm run dev:api                 # API_PORT defaults to 4000; the API connects to Redis at import (shared/queues.ts)
npm run dev:worker              # in a second terminal
```

Every request below omits the tenant headers on purpose: they default to `acme` / `owner@acme.test` (finding F1 in chapter 06).

1. `GET http://localhost:4000/api/billing/subscriptions` and copy the subscription id.
2. `POST /api/billing/subscriptions/<id>/invoices` creates an open invoice synchronously. With the seed data the total is 11301 cents (4 seats × 2900, 10% coupon, 825 bp tax).
3. `POST /api/billing/invoices/<invoice id>/pay` returns 202; the worker creates the payment. `11301 % 7` is 3, so the deterministic rule at `jobs.ts:120` makes it `succeeded` and marks the invoice paid.
4. `GET /api/billing/invoices` and copy the payment id from the invoice's `payments` array.

```powershell
$body = '{"providerEventId":"evt-demo-0001","eventType":"payment.succeeded","paymentId":"<payment id>"}'
curl.exe -i -X POST http://localhost:4000/api/payments/webhooks/mock -H "content-type: application/json" -d $body
# -> 200 { processed: true, eventId, ignoredFailure: false }. The payment was already succeeded, so no
#    payment/invoice update, but one new audit row AND a second payment.succeeded outbox row (finding F2)
curl.exe -i -X POST http://localhost:4000/api/payments/webhooks/mock -H "content-type: application/json" -d $body
# -> 200 { duplicate: true, eventId } and no new rows: the replay is absorbed by the stored event
```

Change `paymentId` or `eventType` and resend under the same `providerEventId` to see `webhook.identity_conflict` (409). Send a `payment.failed` with a new event id to see `ignoredFailure: true` and an audit-only `payment.failed.ignored`. Use `curl.exe` in Windows PowerShell 5.1, where `curl` is an alias for `Invoke-WebRequest`.
