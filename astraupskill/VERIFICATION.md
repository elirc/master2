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

The final [verification record](evidence/root-verify-01.json) and [complete output](evidence/root-verify-01.log) report exit code zero. All **30 tests passed**: five existing domain tests, sixteen payment-service tests, and nine HTTP-route tests. The service suite checks tenant ownership, changed-payload replay, valid payment failure, late failure after success, missing invoices, rejected draft/void invoice transitions, valid uncollectible payment, strict payload rejection, and bounded retries for Prisma conflict codes. The route suite exercises an actual Express router, JSON parser, and the shared error middleware; its payment service and permission function are mocked. It verifies expected domain errors remain useful 400/403/409 responses while unexpected errors become a safe 500 response.

The [schema validation](evidence/prisma_validate_v2.log) and [client generation](evidence/root-generate-01.log) also passed. The full build compiled API, worker, shared packages, and the Vite frontend. These are compilation results; they do not demonstrate browser interaction or a running worker. [The machine-readable summary](evidence/results.json) states the same scope and test counts.

Prisma transaction callbacks are mocked in the service tests. They prove calls, arguments, decisions, and retry limits, but cannot prove PostgreSQL rollback, concurrent serialization, row locks, or durability. A separate disposable PostgreSQL test database is the next useful integration exercise: inject an audit-write failure and verify no payment, invoice, event, or outbox write commits; then race two identical provider event IDs. The current synthetic provider route has no real signature verification, and demo headers are not production authentication. Full application membership wiring is not covered by the route fixture. Subscription idempotency and count-based invoice numbering retain their pre-existing race risks. Review these boundaries before describing the project as production-ready.

## Run the app and watch a replay

```powershell
docker compose up -d            # PostgreSQL on localhost:5432 (billing/billing, db billing_platform)
npm install
npm run db:generate
npm run db:push
npm run db:seed                 # organization acme, an owner user, a customer, an open invoice and a payment
npm run dev --workspace @billing/api   # API_PORT defaults to 4000
```

Find a payment id: `npx prisma studio` in `packages/db`, or `SELECT id, status FROM "Payment" LIMIT 1;`. Then, with the seeded owner email in `$email`:

```powershell
$body = '{"providerEventId":"evt-demo-0001","eventType":"payment.succeeded","paymentId":"<payment id>"}'
curl -i -X POST http://localhost:4000/api/payments/webhooks/mock -H "content-type: application/json" -H "x-org-slug: acme" -H "x-user-email: $email" -d $body
# -> 200 { processed: true, eventId }, invoice paid, one audit row, one outbox row
curl -i -X POST http://localhost:4000/api/payments/webhooks/mock -H "content-type: application/json" -H "x-org-slug: acme" -H "x-user-email: $email" -d $body
# -> 200 { duplicate: true, eventId } and no new rows: the replay is absorbed by the stored event
```

Change one character of the body and send it again under the same `providerEventId` to see `webhook.identity_conflict` (409).

