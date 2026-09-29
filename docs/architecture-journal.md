# Architecture Journal

This journal records what changed, why it changed, and what a growing engineer should notice. It is deliberately written as a learning artifact, not a changelog.

## Entry 001: Initial System Shape

The first decision was to build a modular monolith instead of separate services. Billing systems have many workflows that must stay transactionally consistent: subscription creation, invoice generation, payment attempts, webhooks, retries, audit logs, and customer-visible state. Keeping these in one backend makes the first version easier to reason about while still allowing clear module boundaries.

The repository is split into apps and packages. Apps are deployable processes or user interfaces. Packages contain shared code with no direct HTTP concerns. This is a common enterprise pattern because it lets teams keep domain rules reusable without making every concept a network call.

The key teaching idea is that "monolith" does not mean "one big file." A good monolith has strict internal boundaries, boring deployment, and visible workflows.

## Entry 002: Verification First Backlog Batch

After the initial build, the first backlog batch added quality gates, CI, health checks, runtime config validation, worker heartbeat tracking, and migration discipline documentation.

This was deliberately chosen before deeper product features. Enterprise systems become hard to learn when every change feels risky. A `verify` command, CI workflow, and health endpoints create a safety loop: change something, run checks, inspect failures, fix the real cause, and repeat.

The sub-agent was useful for drafting the broad backlog while the main implementation stayed focused on code. The upside was parallel progress on planning and implementation. The downside is coordination: delegated work needs a narrow write area and a clear final artifact, otherwise two agents can easily step on the same files or produce plans that do not match the code. For this project, docs-only delegation worked well.
