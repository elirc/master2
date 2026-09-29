import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { config } from "../config.js";

const connection = new Redis(config.redisUrl, {
  maxRetriesPerRequest: null
});

export const billingQueue = new Queue("billing", { connection });
