import type { Prisma, PrismaClient } from "@billing/db";

export async function writeOutboxEvent(
  tx: PrismaClient | Prisma.TransactionClient,
  input: {
    organizationId: string;
    topic: string;
    payload: Prisma.InputJsonValue;
  }
) {
  await tx.outboxEvent.create({
    data: {
      organizationId: input.organizationId,
      topic: input.topic,
      payload: input.payload
    }
  });
}
