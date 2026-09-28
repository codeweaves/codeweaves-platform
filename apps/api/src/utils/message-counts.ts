import type { PrismaService } from "../services/prisma.service";

/**
 * Message count per chat session, for the given sessions only.
 *
 * Use this instead of Prisma's relation `_count` on `messages`. That compiles
 * to a GROUP BY over the whole chat_messages table, every tenant included,
 * before the join, so one page of results costs a scan of all messages ever
 * stored. This query reads only the listed sessions through the
 * chatSessionId index. Sessions with no messages are absent from the map.
 */
export async function countMessagesBySession(
  prisma: PrismaService,
  sessionIds: string[],
): Promise<Map<string, number>> {
  if (sessionIds.length === 0) return new Map();
  const groups = await prisma.chatMessage.groupBy({
    by: ["chatSessionId"],
    where: { chatSessionId: { in: sessionIds } },
    _count: { _all: true },
  });
  return new Map(groups.map((g) => [g.chatSessionId, g._count._all]));
}
