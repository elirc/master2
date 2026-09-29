import cors from "cors";
import express from "express";
import { prisma } from "@billing/db";
import { billingRouter } from "./modules/billing.routes.js";
import { catalogRouter } from "./modules/catalog.routes.js";
import { identityRouter } from "./modules/identity.routes.js";
import { paymentsRouter } from "./modules/payments.routes.js";
import { platformRouter } from "./modules/platform.routes.js";
import { attachTenantContext } from "./shared/auth.js";
import { errorMiddleware } from "./shared/errors.js";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(attachTenantContext);

  app.get("/health", (_request, response) => {
    response.json({ ok: true, service: "billing-api" });
  });

  app.get("/health/live", (_request, response) => {
    response.json({ ok: true, status: "live" });
  });

  app.get("/health/ready", async (_request, response) => {
    try {
      await prisma.$queryRaw`SELECT 1`;
      const heartbeat = await prisma.workerHeartbeat.findUnique({
        where: { worker: "billing-worker" }
      });
      response.json({
        ok: true,
        status: "ready",
        dependencies: {
          database: "ready",
          worker:
            heartbeat && Date.now() - heartbeat.checkedAt.getTime() < 30_000
              ? "ready"
              : "unknown"
        }
      });
    } catch (error) {
      response.status(503).json({
        ok: false,
        status: "not_ready",
        error: "Readiness dependencies are unavailable."
      });
    }
  });

  app.use("/api/identity", identityRouter);
  app.use("/api/catalog", catalogRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/payments", paymentsRouter);
  app.use("/api/platform", platformRouter);

  app.use(errorMiddleware);

  return app;
}
