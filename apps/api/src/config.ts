import { z } from "zod";

const configSchema = z.object({
  API_PORT: z.coerce.number().int().positive().default(4000),
  REDIS_URL: z.string().url().default("redis://localhost:6379"),
  DEFAULT_USER_EMAIL: z.string().email().default("owner@acme.test")
});

const parsed = configSchema.parse(process.env);

export const config = {
  port: parsed.API_PORT,
  redisUrl: parsed.REDIS_URL,
  defaultUserEmail: parsed.DEFAULT_USER_EMAIL
};
