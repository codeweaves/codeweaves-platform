/**
 * Load the LOCAL database with production-sized data, to find what breaks as
 * data grows. Used by the verify skill's performance work (features/performance.md).
 *
 * Creates, per org: 4 "Scale Agent N" agents, SESSIONS_PER_ORG conversations
 * spread over DAYS days (3 in 4 on the widget, 1 in 4 on WhatsApp),
 * MESSAGES_PER_SESSION messages each (visitor and assistant alternating), and
 * a chat_message_metrics row per assistant reply.
 * The orgs are verify-sandbox (so its owner's dashboard carries the load) and
 * scale-org-1..3 (so platform users see several large tenants).
 *
 * Rows are generated inside Postgres with generate_series; millions of rows
 * through the Prisma client would take far too long. They are inserted in
 * time order, the way production writes them, so a time window sits in a
 * contiguous part of the table and index range scans behave as they do live.
 *
 * Run:    cd apps/api && bun run prisma/seed-scale.ts
 * Remove: cd apps/api && bun run prisma/seed-scale.ts --remove
 * Env:    SESSIONS_PER_ORG (default 50000), MESSAGES_PER_SESSION (10), DAYS (90)
 *
 * Refuses a non-local database.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { assertLocalDatabase } from "../prisma.config";

const SESSIONS_PER_ORG = Number(process.env.SESSIONS_PER_ORG ?? 50_000);
const MESSAGES_PER_SESSION = Number(process.env.MESSAGES_PER_SESSION ?? 10);
const DAYS = Number(process.env.DAYS ?? 90);
const AGENTS_PER_ORG = 4;
const AGENT_PREFIX = "Scale Agent";
const ORGS = [
  { slug: "verify-sandbox", name: "Verify Sandbox" },
  { slug: "scale-org-1", name: "Scale Org 1" },
  { slug: "scale-org-2", name: "Scale Org 2" },
  { slug: "scale-org-3", name: "Scale Org 3" },
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
assertLocalDatabase(databaseUrl, ["node", "prisma", "migrate", "dev"]);

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function scaleAgentIds(): Promise<string[]> {
  const agents = await prisma.agent.findMany({
    where: {
      name: { startsWith: AGENT_PREFIX },
      organization: { slug: { in: ORGS.map((o) => o.slug) } },
    },
    select: { id: true },
  });
  return agents.map((a) => a.id);
}

async function remove() {
  const ids = await scaleAgentIds();
  // Sessions cascade to messages, metrics, handover events and collected data.
  const sessions = await prisma.chatSession.deleteMany({
    where: { agentId: { in: ids } },
  });
  await prisma.agent.deleteMany({ where: { id: { in: ids } } });
  const orgs = await prisma.organization.deleteMany({
    where: { slug: { startsWith: "scale-org-" } },
  });
  console.log(
    JSON.stringify({
      removed: {
        agents: ids.length,
        sessions: sessions.count,
        orgs: orgs.count,
      },
    }),
  );
}

async function seed() {
  if ((await scaleAgentIds()).length) {
    throw new Error("scale data already present; run with --remove first");
  }
  const started = Date.now();
  const agentIds: string[] = [];
  for (const o of ORGS) {
    const org = await prisma.organization.upsert({
      where: { slug: o.slug },
      update: {},
      create: o,
    });
    for (let i = 1; i <= AGENTS_PER_ORG; i++) {
      const agent = await prisma.agent.create({
        data: {
          publicId: nanoid(8),
          name: `${AGENT_PREFIX} ${i}`,
          organizationId: org.id,
          status: "ACTIVE",
          allowedDomains: [],
          aiConfig: { routingMode: "direct", modelId: "openai:gpt-4.1-mini" },
        },
      });
      agentIds.push(agent.id);
    }
  }

  const perAgent = Math.ceil(SESSIONS_PER_ORG / AGENTS_PER_ORG);
  const seconds = DAYS * 86_400;
  await prisma.$executeRawUnsafe(
    `INSERT INTO chat_sessions (id, "agentId", "sessionId", source, title, category, "detectedLanguage", "createdAt", "updatedAt", "lastMessageAt")
     SELECT gen_random_uuid()::text, r.id, gen_random_uuid()::text,
            (ARRAY['WIDGET','WIDGET','WIDGET','WHATSAPP'])[1 + ((r.g / 4) % 4)]::"ChatSource",
            'Scale conversation ' || r.g,
            (ARRAY['billing','support','sales','onboarding'])[1 + (r.g % 4)],
            'en',
            r.t, r.t + interval '5 minutes', r.t + interval '5 minutes'
     FROM (
       SELECT a.id, g, now() - (random() * $3::int) * interval '1 second' AS t
       FROM unnest($1::text[]) AS a(id)
       CROSS JOIN generate_series(1, $2::int) AS g
     ) AS r
     ORDER BY r.t`,
    agentIds,
    perAgent,
    seconds,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO chat_messages (id, "chatSessionId", "agentId", "sessionSource", role, content, "createdAt")
     SELECT gen_random_uuid()::text, s.id, s."agentId", s.source,
            (CASE WHEN n % 2 = 1 THEN 'USER' ELSE 'ASSISTANT' END)::"MessageRole",
            'Scale test message ' || n,
            s."createdAt" + n * interval '30 seconds'
     FROM chat_sessions s
     CROSS JOIN generate_series(1, $2::int) AS n
     WHERE s."agentId" = ANY($1::text[])
     ORDER BY 7`,
    agentIds,
    MESSAGES_PER_SESSION,
  );
  await prisma.$executeRawUnsafe(
    `INSERT INTO chat_message_metrics ("messageId", "agentId", "sessionSource", role, "createdAt", "responseLatencyMs", "llmLatencyMs", "timeToFirstTokenMs", streamed)
     SELECT m.id, m."agentId", m."sessionSource", m.role, m."createdAt",
            500 + (random() * 3500)::int, 300 + (random() * 2500)::int, 200 + (random() * 1500)::int, true
     FROM chat_messages m
     WHERE m."agentId" = ANY($1::text[]) AND m.role = 'ASSISTANT'
     ORDER BY m."createdAt"`,
    agentIds,
  );
  await prisma.$executeRawUnsafe(
    "ANALYZE chat_sessions, chat_messages, chat_message_metrics",
  );

  const [sessions, messages] = await Promise.all([
    prisma.chatSession.count({ where: { agentId: { in: agentIds } } }),
    prisma.chatMessage.count({ where: { agentId: { in: agentIds } } }),
  ]);
  console.log(
    JSON.stringify({
      created: {
        orgs: ORGS.length,
        agents: agentIds.length,
        sessions,
        messages,
        days: DAYS,
      },
      seconds: Math.round((Date.now() - started) / 1000),
    }),
  );
}

(process.argv.includes("--remove") ? remove() : seed())
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
