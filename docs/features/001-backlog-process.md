# Feature 001: Backlog And Feature Process

## Goal

Create a repeatable way to plan, build, journal, and verify every future feature in the SaaS billing platform. The process should help junior developers understand what good engineering work looks like while giving mid-level and senior developers enough structure to review risk, architecture, and release readiness.

## Why This Matters

Enterprise billing systems are workflow-heavy. A small feature can touch authentication, RBAC, tenant isolation, state transitions, audit logs, background jobs, notifications, files, reports, and migrations. The feature process exists so each change starts with the business outcome, names its risks, and leaves behind a useful learning trail.

## Feature File Naming

Each planned feature should have a stable ID from `docs/backlog.md`.

- Use `docs/features/NNN-short-feature-name.md` for feature plans.
- Keep the backlog ID inside the file, such as `BIL-023`.
- Update the feature file as the plan becomes clearer.
- Do not rename feature files casually after implementation begins because links from journals, pull requests, and reviews may depend on them.

## Planning Template

Every feature plan should include these sections.

### Goal

- State the user or operator outcome in plain language.
- Name what will be possible after the feature ships.
- Avoid implementation-only goals like "add a table" unless the table is the actual product outcome.

### Scope

- List what is included.
- List what is intentionally excluded.
- Call out follow-up features instead of quietly expanding the work.

### Impacted Areas Of The Codebase

- Name the apps and packages likely to change.
- Call out database migrations, API routes, worker jobs, frontend screens, shared domain helpers, docs, and tests.
- Mention any object storage, queue, notification, or reporting impact.

### Data And State

- List new tables, columns, enums, indexes, and seed data.
- Name any state machine states and transitions.
- Explain tenant ownership for every new persistent record.
- Note retention, soft-delete, archive, and audit expectations.

### Security And Permissions

- Define who can view, create, update, approve, export, retry, or delete the resource.
- Explain backend RBAC checks and tenant-isolation checks.
- Include cross-tenant denial cases in the test plan.
- Call out admin or break-glass behavior separately from tenant user behavior.

### API Contract

- List endpoints, methods, request DTOs, response DTOs, errors, pagination metadata, and idempotency behavior.
- Explain how frontend clients should handle loading, empty, error, validation, and permission-denied responses.
- Document webhook or event payload versions if the feature emits or consumes events.

### Background Work And Events

- Name jobs that should run asynchronously.
- Name domain events emitted by the feature.
- Explain whether the transactional outbox is required.
- Define retry behavior, idempotency keys, dead-letter handling, and operational visibility.

### Frontend Workflow

- Describe the main user workflow from entry point to completion.
- Include list, detail, create, edit, review, approve, import, export, or portal screens as needed.
- Specify loading, empty, error, disabled, optimistic, and permission-denied states.
- Keep the UI operational and scannable; this is a billing product, not a marketing site.

### Observability And Operations

- Name logs, metrics, request IDs, job IDs, audit IDs, and dashboard views needed to debug the feature.
- Add health check or readiness impact if the feature depends on a new service.
- Include runbook notes for common failure modes when the feature is operationally important.

### Migration And Rollback Plan

- Explain the migration order.
- Note data backfill needs.
- Describe safe rollback expectations.
- Include compatibility notes if old code and new schema may run at the same time.

### Test Plan

- Include domain unit tests for business rules and state transitions.
- Include API tests for validation, RBAC, tenant isolation, and idempotency.
- Include worker tests for jobs, retries, and outbox processing.
- Include frontend tests for workflow states where practical.
- Include E2E tests for high-value or high-risk user journeys.

### Build Journal

- Record what changed and why as implementation progresses.
- Capture tradeoffs, surprises, rejected approaches, and follow-up work.
- Write notes so a newer developer can learn how the feature came together.

### Verification

- List the commands run.
- List manual checks performed.
- Document any checks that could not be run and why.
- Link follow-up issues for known gaps.

## Build Workflow

1. Pick a backlog item and read nearby architecture docs before editing code.
2. Create or update the feature plan with scope, risks, affected modules, and a test plan.
3. Build the smallest vertical slice that proves the design across database, domain, API, worker, and frontend if those layers apply.
4. Add focused tests close to the risky logic before broad UI polish.
5. Add audit logs, domain events, outbox writes, notifications, and observability where the feature requires them.
6. Update the build journal with decisions and follow-up work.
7. Run verification commands and record the results.
8. Review the feature against the backlog cross-cutting standards before calling it done.

## Definition Of Ready

A feature is ready to build when:

- The business goal is clear.
- The scope has explicit exclusions.
- Tenant ownership and RBAC expectations are named.
- Data model and migration needs are understood.
- State transitions are listed if the feature has workflow state.
- API contract and frontend workflow are sketched.
- Test strategy covers the riskiest behavior.
- The team knows whether jobs, events, outbox, notifications, files, or reports are involved.

## Definition Of Done

A feature is done when:

- The implementation matches the feature plan or the plan has been updated to explain changes.
- Backend authorization and tenant isolation are tested.
- State machines and money logic have domain tests where applicable.
- Migrations are committed, reviewed, and compatible with seed data.
- API contracts are documented or covered by contract-style tests.
- Background jobs and outbox handlers are idempotent where retries are possible.
- Audit logs and observability are present for important business actions.
- Frontend workflows include realistic loading, empty, error, disabled, and permission-denied states.
- CI-relevant checks pass, or any failures are documented with a clear reason.
- The build journal explains what changed, why, and what a developer should notice.

## Guidance For Junior Developers

- Start by tracing an existing workflow before writing a new one.
- Prefer small vertical slices over large disconnected chunks.
- Ask where tenant isolation, permissions, and audit logging happen.
- Put business rules in shared domain helpers when API, worker, and frontend need the same behavior.
- Write tests for the rule that would be most expensive to break.
- Update the journal while the work is fresh; future readers need the story, not just the final code.

## Guidance For Mid-Level Developers

- Own features across boundaries instead of only one layer.
- Keep route handlers thin and put workflow orchestration in service-level code.
- Think about retries, idempotency, pagination, and partial failure before the first review.
- Check that frontend screens match the actual API contract and permission model.
- Leave behind enough documentation for someone else to extend the feature safely.

## Guidance For Senior Developers

- Review whether the feature changes core invariants: tenant isolation, money math, state machines, auditability, compliance, or external callbacks.
- Watch for migrations that are correct locally but dangerous with production-sized data.
- Require observability for workflows that can fail after the HTTP request returns.
- Push complex features toward explicit states, idempotent commands, and testable domain rules.
- Help the team learn by explaining tradeoffs in feature journals and reviews.

## Review Checklist

- Does every tenant-owned query include tenant scope?
- Does every protected action have a backend permission check?
- Are state transitions explicit and tested?
- Are money calculations integer-based and deterministic?
- Are audit logs written for meaningful business changes?
- Are jobs and outbox handlers safe to retry?
- Are import/export and file access permission-checked and audited?
- Are list endpoints paginated, filterable, and protected from unbounded queries?
- Are API errors shaped so the frontend can show useful states?
- Are migrations reversible or at least operationally safe?
- Are verification results recorded?
