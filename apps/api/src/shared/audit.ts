import type { Prisma, PrismaClient } from "@billing/db";

export async function writeAuditLog(
  tx: PrismaClient | Prisma.TransactionClient,
  input: {
    organizationId: string;
    actorUserId?: string;
    action: string;
    entityType: string;
    entityId: string;
    metadata?: Prisma.InputJsonValue;
  }
) {
  await tx.auditLog.create({
    data: {
      organizationId: input.organizationId,
      actorUserId: input.actorUserId,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId,
      metadata: input.metadata ?? {}
    }
  });
}
