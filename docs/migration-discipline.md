# Migration Discipline

Database changes should be treated as application behavior, not plumbing.

## Local Workflow

1. Edit `packages/db/prisma/schema.prisma`.
2. Run `npm run db:generate`.
3. For early local-only experiments, run `npm run db:push`.
4. For durable feature work, run `npm run prisma:migrate --workspace @billing/db`.
5. Update seed data only when the new schema needs realistic local examples.
6. Run `npm run verify`.

## Review Rules

- Every tenant-owned table needs an `organizationId` or a clear reason why it does not.
- Money columns must be integer cents plus currency.
- State changes should prefer explicit enums over boolean combinations.
- Avoid destructive migrations unless there is a documented backup and rollback path.
- Avoid enum changes without a transition plan; production databases can make enum edits awkward.
- Add indexes for common tenant-scoped reads and workflow queues.
- Keep audit logs append-only.
- Do not hide cross-tenant data leaks in seed data.

## Expand And Contract

Prefer safe multi-step migrations for risky changes:

1. Expand: add nullable column or new table.
2. Backfill: copy or compute existing data.
3. Read: update application code to read from the new shape.
4. Write: update application code to write the new shape.
5. Contract: remove old column only after the system no longer depends on it.

## Deployment

Production deployment should use:

```bash
npm run prisma:deploy --workspace @billing/db
```

`db push` is for local learning speed, not production discipline.
