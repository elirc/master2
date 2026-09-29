import { HttpError } from "./errors.js";
import { prisma } from "@billing/db";
import { hashRequestPayload } from "@billing/domain";

export async function runIdempotent<TResponse extends object>(input: {
  organizationId: string;
  key?: string;
  payload: unknown;
  run: () => Promise<TResponse>;
}): Promise<TResponse> {
  if (!input.key) {
    return input.run();
  }

  const requestHash = hashRequestPayload(input.payload);
  const existing = await prisma.idempotencyKey.findUnique({
    where: {
      organizationId_key: {
        organizationId: input.organizationId,
        key: input.key
      }
    }
  });

  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new HttpError(409, "idempotency.payload_conflict", "Idempotency key was reused with a different request payload.");
    }

    if (existing.response) {
      return existing.response as TResponse;
    }
  }

  const response = await input.run();
  await prisma.idempotencyKey.upsert({
    where: {
      organizationId_key: {
        organizationId: input.organizationId,
        key: input.key
      }
    },
    update: {
      response
    },
    create: {
      organizationId: input.organizationId,
      key: input.key,
      requestHash,
      response
    }
  });

  return response;
}
