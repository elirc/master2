import { prisma } from "@billing/db";

export async function processOutboxBatch() {
  const events = await prisma.outboxEvent.findMany({
    where: {
      status: "pending",
      availableAt: { lte: new Date() }
    },
    orderBy: { createdAt: "asc" },
    take: 10
  });

  for (const event of events) {
    await prisma.outboxEvent.update({
      where: { id: event.id },
      data: {
        status: "processing",
        attempts: { increment: 1 }
      }
    });

    try {
      console.log(`Outbox event ${event.topic}`, event.payload);
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: "processed",
          processedAt: new Date()
        }
      });
    } catch (error) {
      const attempts = event.attempts + 1;
      await prisma.outboxEvent.update({
        where: { id: event.id },
        data: {
          status: attempts >= 5 ? "failed" : "pending",
          availableAt: new Date(Date.now() + attempts * 30_000)
        }
      });
      throw error;
    }
  }

  return { processed: events.length };
}
