# Product Backlog: Multi-Tenant SaaS Billing Platform

This backlog is a phased learning path for building a realistic enterprise billing and subscription platform. Each feature should be implemented as production-shaped code, but the phases are ordered so a junior developer can first learn the core patterns, then grow into mid-level and senior concerns like state machines, idempotency, observability, migration discipline, and operational tooling.

Feature IDs are stable. When a feature is planned in detail, create or update a matching file in `docs/features/` and record implementation notes in the architecture journal or the feature journal section.

## Phase 0: Foundation And Working Habits

Goal: make the codebase easy to run, test, review, and reason about before adding business complexity.

### BIL-000: Initial Core System

- Establish npm workspaces, TypeScript configuration, API app, worker app, web app, shared domain package, and database package.
- Create the first tenant-aware data model for organizations, users, memberships, customers, plans, subscriptions, invoices, payments, audit logs, outbox events, and jobs.
- Teach the basic repo map: app boundaries, package boundaries, migrations, tests, docs, and local development.

### BIL-001: Backlog And Feature Process

- Define how every future feature is planned, built, journaled, and verified.
- Require feature plans to name business goals, affected modules, state changes, security checks, tests, migrations, and rollback notes.
- Teach developers to work from intent to implementation instead of jumping straight into route handlers.

### BIL-002: Local Dev, CI, And Quality Gates

- Add consistent scripts for linting, type checking, formatting, unit tests, API tests, worker tests, and frontend build checks.
- Add CI that runs the same commands developers run locally.
- Publish a short failure-triage guide so junior developers know whether a failure is lint, type, test, migration, or environment related.

### BIL-003: Health Checks And Runtime Configuration

- Add `/health/live` and `/health/ready` endpoints for the API and a worker health heartbeat.
- Validate environment variables at startup with clear errors.
- Teach the difference between process liveness, dependency readiness, and business-level correctness.

### BIL-004: Migration Discipline

- Document how to create, review, apply, and roll back database migrations.
- Add seed data that supports local demos without hiding tenant-isolation bugs.
- Introduce migration review rules: no silent data loss, no unbounded locks, no enum changes without transition plans, and no schema drift.

## Phase 1: Identity, Tenancy, And Access Control

Goal: make every later feature safe by default. Billing systems are multi-tenant first; authorization is not a UI concern.

### BIL-010: Authentication Session Flow

- Implement sign in, sign out, current user lookup, password hashing or provider-compatible auth abstraction, and session expiration.
- Add frontend flows for login, logout, expired sessions, and authenticated layout.
- Include API tests for missing, expired, and malformed credentials.

### BIL-011: Tenant Isolation Guardrails

- Enforce `organizationId` filtering in backend queries for every tenant-owned resource.
- Add helper APIs that make correct scoping the easiest path for new code.
- Add tests that try to access customers, invoices, subscriptions, files, and settings across tenant boundaries.

### BIL-012: RBAC Roles And Permissions

- Create roles such as owner, admin, billing manager, support agent, auditor, developer, and customer portal user.
- Model permissions around actions, not just screens: view invoices, create subscriptions, refund payments, manage settings, approve changes, export data, and view audit logs.
- Add frontend permission-aware navigation while keeping backend authorization authoritative.

### BIL-013: Membership And Team Administration

- Add invite, accept invite, remove member, change role, and deactivate member workflows.
- Add audit logs for all membership changes.
- Teach safe admin workflows: confirm destructive actions, avoid privilege escalation, and handle the last-owner case.

### BIL-014: User Preferences And Notification Settings

- Store per-user preferences for timezone, date format, currency display, table density, email notifications, and in-app notifications.
- Add settings UI that saves optimistically only when API confirmation succeeds.
- Teach the difference between tenant settings, user preferences, and feature flags.

## Phase 2: Core Billing Domain

Goal: build the heart of the product with explicit state machines, auditable changes, and deterministic money behavior.

### BIL-020: Catalog Plans, Prices, Coupons, And Taxes

- Manage products, plans, price versions, coupons, tax rates, and entitlement metadata.
- Prevent accidental edits to historical prices used by existing subscriptions.
- Add search, filtering, sorting, and pagination to catalog list screens.

### BIL-021: Customer Management

- Add customers, contacts, billing addresses, tax identifiers, payment method metadata, notes, and lifecycle status.
- Support customer list search, filters, pagination, CSV export, and detail tabs.
- Teach how list endpoints should avoid leaking raw database models.

### BIL-022: Subscription State Machine

- Implement explicit subscription states: draft, trialing, active, past_due, paused, canceled, expired, and archived.
- Centralize valid transitions in `packages/domain` with tests for allowed and blocked transitions.
- Add UI actions for create, activate, pause, resume, cancel, and schedule cancellation.

### BIL-023: Invoice State Machine

- Implement invoice states: draft, open, finalized, void, uncollectible, paid, and refunded.
- Keep invoice totals deterministic using integer money helpers.
- Add audit and domain events for invoice creation, finalization, voiding, and payment.

### BIL-024: Payments And Mock Provider

- Add payment attempts, payment method references, refunds, failed-payment reasons, and provider event ingestion.
- Use idempotency keys for payment commands and webhook-like callbacks.
- Teach why external callbacks must be stored before business effects are applied.

### BIL-025: Billing Settings

- Add tenant billing settings for invoice numbering, payment terms, default currency, tax behavior, grace periods, retry policy, and invoice branding basics.
- Add validation that protects existing invoices and subscriptions from unsafe setting changes.
- Add API tests for setting updates by role.

## Phase 3: Platform Reliability And Workflow Automation

Goal: introduce the patterns that keep enterprise workflows dependable when work crosses process boundaries.

### BIL-030: Domain Events

- Define domain events for customer, subscription, invoice, payment, membership, settings, file, and approval changes.
- Keep event payloads versioned and small enough to be stable.
- Teach the difference between an event that records something that happened and a command that asks for work.

### BIL-031: Transactional Outbox

- Persist outbox rows in the same transaction as business changes.
- Build worker processing with retries, dead-letter status, idempotent handlers, and operational visibility.
- Add tests that verify business writes and outbox writes succeed or fail together.

### BIL-032: Background Jobs

- Add scheduled invoice generation, payment retry, dunning notification, CSV export generation, import processing, report generation, and cleanup jobs.
- Track job status, attempts, errors, next run time, and tenant ownership.
- Teach when to use a background job instead of making the HTTP request wait.

### BIL-033: Notifications

- Add notification templates and delivery records for invoice finalized, payment failed, payment succeeded, subscription canceled, approval requested, export ready, and import failed.
- Support email-like mock delivery plus in-app notifications.
- Respect user preferences, tenant settings, and compliance suppression rules.

### BIL-034: Audit Logs

- Make audit logs append-only and tenant-scoped.
- Capture actor, action, target, metadata, request ID, IP-like context, and before/after summaries where appropriate.
- Add admin UI for filtering by actor, action, target type, date range, and severity.

### BIL-035: Observability Baseline

- Add structured logging, request IDs, worker job IDs, audit correlation IDs, and error normalization.
- Add metrics for API latency, job failures, outbox lag, payment failures, notification failures, and import/export durations.
- Teach developers how to follow one workflow across API, database, worker, and UI logs.

## Phase 4: Enterprise Operations And Data Movement

Goal: make the platform useful for real operators who need imports, exports, reporting, approvals, search, and support tooling.

### BIL-040: File Uploads And Object Storage

- Add object storage abstraction for invoice PDFs, CSV imports, CSV exports, receipts, and tenant branding assets.
- Store file metadata in the database with tenant ownership, uploader, content type, size, checksum, scan status, and retention policy.
- Add upload limits, signed-download style access, and tests for cross-tenant file access.

### BIL-041: CSV Import Framework

- Build import workflows for customers, subscriptions, catalog prices, tax IDs, and adjustments.
- Include upload, parse, validate, preview, commit, partial failure handling, and import history.
- Teach batch validation, row-level errors, idempotency, and rollback expectations.

### BIL-042: CSV Export Framework

- Add exports for customers, subscriptions, invoices, payments, audit logs, and reports.
- Generate large exports asynchronously and notify the requester when ready.
- Enforce RBAC, tenant isolation, object-storage access, and audit logging for every export.

### BIL-043: Reporting

- Add reports for monthly recurring revenue, churn, failed payments, aging invoices, tax summaries, refunds, revenue by plan, and tenant activity.
- Support filters, date ranges, pagination, CSV export, and background generation for expensive reports.
- Teach the difference between operational queries and reporting-shaped read models.

### BIL-044: Search, Filtering, Sorting, And Pagination

- Standardize API query parameters and response metadata for list endpoints.
- Add full-text or indexed search where appropriate for customers, invoices, subscriptions, audit logs, jobs, and admin tools.
- Add frontend table patterns for filters, saved views, empty states, loading states, and permission-sensitive actions.

### BIL-045: Approvals

- Add approval workflows for refunds above threshold, plan price changes, subscription cancellations, credit grants, export of sensitive data, and billing setting changes.
- Model requested, approved, rejected, canceled, expired, and applied states.
- Teach separation between requesting a change, approving it, and applying the business effect.

### BIL-046: Admin Tools

- Add internal admin screens for tenant lookup, user support, job retry, outbox inspection, notification replay, audit review, feature flags, and read-only billing diagnostics.
- Require elevated permissions and audit every admin action.
- Add break-glass guidance and warnings for tools that can affect customer-visible billing state.

## Phase 5: Portals, Compliance, And Product Polish

Goal: complete the user-facing workflows and the policies expected in a serious billing product.

### BIL-050: Customer Self-Service Portal

- Add portal login or access-token flow for customer contacts.
- Let customers view subscriptions, invoices, receipts, payment status, billing details, and downloadable files.
- Add safe self-service actions such as update billing details, request cancellation, and download invoices.

### BIL-051: Worker Operations Portal

- Add an operations view for workers and support staff to inspect job queues, failed jobs, outbox lag, notification status, import status, and report generation.
- Allow permission-gated retries and cancellations with audit logs.
- Teach operators to understand failure modes without direct database access.

### BIL-052: Compliance And Business Rules

- Add rule checks for tax ID requirements, invoice retention, refund windows, dunning rules, export restrictions, approval thresholds, and data deletion constraints.
- Make rules testable in `packages/domain` and visible in admin/settings UI where appropriate.
- Teach how compliance logic differs from one-off validation in a controller.

### BIL-053: Tenant Settings And Platform Settings

- Expand settings into tenant profile, billing defaults, notification defaults, security settings, portal settings, approval thresholds, and report preferences.
- Add settings history and audit-friendly change summaries.
- Distinguish tenant-configurable settings from platform-wide environment configuration.

### BIL-054: Frontend Workflow Completion

- Complete dashboard workflows for auth, RBAC-aware navigation, customers, catalog, subscriptions, invoices, payments, imports, exports, reports, settings, admin tools, audit logs, and approvals.
- Add consistent loading, error, empty, disabled, and optimistic-action states.
- Teach junior developers to design flows around real user jobs rather than isolated components.

### BIL-055: API Contracts And Client SDK Shape

- Document REST resources, request/response DTOs, errors, pagination metadata, idempotency behavior, and webhook payloads.
- Add contract tests or generated schema checks so frontend and backend drift is caught early.
- Teach why stable contracts matter even inside a monorepo.

## Phase 6: Verification, Release Discipline, And Senior-Level Hardening

Goal: make the system trustworthy enough to change repeatedly without fear.

### BIL-060: End-To-End Test Suite

- Add E2E tests for login, tenant switching, RBAC denial, customer creation, subscription creation, invoice finalization, payment success, payment failure, approval flow, import preview/commit, export download, and portal invoice download.
- Run a small smoke subset in CI and a broader suite on demand.
- Teach how E2E tests prove workflows, not implementation details.

### BIL-061: Security And Isolation Test Matrix

- Add systematic tests for cross-tenant access, missing permissions, stale sessions, unsafe file access, export authorization, approval bypass attempts, and admin-tool restrictions.
- Document the expected denial shape for API and frontend.
- Teach developers to think like a reviewer before opening a pull request.

### BIL-062: Resilience And Idempotency Review

- Review payment commands, webhook ingestion, import commits, export jobs, notification replay, approval application, and outbox handlers for duplicate delivery.
- Add tests for retries, duplicate requests, partial failures, and already-applied state.
- Teach the senior habit of assuming every external system will retry at the least convenient moment.

### BIL-063: Performance And Data Growth

- Add indexes, query review, pagination enforcement, report offloading, job batch sizing, and log sampling where needed.
- Add realistic seed data for thousands of customers, subscriptions, invoices, payments, jobs, and audit logs.
- Teach developers to read query plans and design list pages that still work with large tenants.

### BIL-064: Release Readiness And Runbooks

- Add runbooks for migrations, failed jobs, stuck outbox rows, payment incident simulation, notification outage, export cleanup, and rollback decisions.
- Add release checklist covering CI, migrations, seed updates, API contracts, E2E smoke tests, docs, and observability checks.
- Teach how production readiness is a repeatable habit, not a final scramble.

## Cross-Cutting Standards For Every Feature

- Auth: every protected route must define who can call it and why.
- RBAC: UI permissions improve usability, but backend permissions are the source of truth.
- Tenant isolation: every tenant-owned read and write must be scoped by organization.
- Audit logs: important business changes must be append-only and searchable.
- State machines: workflow states must have explicit transitions and tests.
- Domain events and outbox: cross-process follow-up should not depend on in-memory side effects.
- Background jobs: long-running work must be observable, retryable, and idempotent.
- Files: object storage access must be tenant-scoped, permission-checked, and audited.
- Notifications: respect preferences, settings, suppression rules, and delivery history.
- CSV import/export: validate, preview, audit, and process large files asynchronously.
- Reporting: avoid expensive request-time work for reports that can grow.
- Compliance and rules: keep policy logic testable and visible.
- API contracts: DTOs, errors, pagination, and idempotency behavior must be documented.
- Frontend workflows: every screen needs loading, empty, error, disabled, and permission-denied states.
- Observability: logs, metrics, request IDs, job IDs, and audit IDs should make workflows traceable.
- Health checks: readiness must reflect required dependencies, not just a running process.
- CI: no feature is complete until lint, types, tests, and build checks pass or failures are documented.
- E2E tests: key user journeys should be protected before broad refactors.
- Migrations: schema changes need review, rollback thinking, and seed data updates when relevant.

## Suggested Learning Progression

- Junior developers should start with narrow, well-tested slices: DTO validation, table filters, permission checks, domain helper tests, and small settings forms.
- Growing mid-level developers should own end-to-end features across API, domain, database, worker, and frontend, with a mentor reviewing boundaries and failure modes.
- Senior developers should lead state machines, migrations, idempotency design, observability, approvals, compliance rules, and release readiness because those choices shape the system for everyone else.
