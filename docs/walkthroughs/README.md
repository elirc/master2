# Code Walkthrough Index

Read these files first when learning the codebase. They cover the architectural center of gravity rather than every implementation detail.

1. [Prisma Schema](prisma-schema.md)
2. [Domain Rules](domain-rules.md)
3. [API App Composition](api-app.md)
4. [Billing Routes And Workflow](billing-routes.md)
5. [Worker Jobs](worker-jobs.md)
6. [Frontend App Surface](frontend-app.md)

The suggested reading style is workflow-first. Pick an action, such as creating a subscription, then trace how data moves through frontend, API, domain helpers, database records, outbox events, and worker jobs.
