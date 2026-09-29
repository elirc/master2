import { Worker } from "bullmq";
import { Redis } from "ioredis";
import { prisma } from "@billing/db";
import { z } from "zod";
import { processOutboxBatch } from "./outbox-processor.js";
import { attemptPayment, generateInvoice } from "./jobs.js";

const config = z
  .object({
    REDIS_URL: z.string().url().default("redis://localhost:6379")
  })
  .parse(process.env);

const connection = new Redis(config.REDIS_URL, {
  maxRetriesPerRequest: null
});

const billingWorker = new Worker(
  "billing",
  async (job) => {
    if (job.name === "generate-invoice") {
      return generateInvoice(job.data as { organizationId: string; subscriptionId: string });
    }

    if (job.name === "attempt-payment") {
      return attemptPayment(job.data as { organizationId: string; invoiceId: string });
    }

    throw new Error(`Unknown billing job ${job.name}.`);
  },
  { connection }
);

billingWorker.on("completed", (job) => {
  console.log(`Completed job ${job.name}:${job.id}`);
});

billingWorker.on("failed", (job, error) => {
  console.error(`Failed job ${job?.name}:${job?.id}`, error);
});

setInterval(() => {
  processOutboxBatch().catch((error) => {
    console.error("Outbox processing failed", error);
  });
}, 5_000);

setInterval(() => {
  prisma.workerHeartbeat
    .upsert({
      where: { worker: "billing-worker" },
      update: {
        status: "running",
        checkedAt: new Date(),
        metadata: { queue: "billing" }
      },
      create: {
        worker: "billing-worker",
        status: "running",
        metadata: { queue: "billing" }
      }
    })
    .catch((error) => {
      console.error("Worker heartbeat failed", error);
    });
}, 10_000);

console.log("Billing worker started.");
