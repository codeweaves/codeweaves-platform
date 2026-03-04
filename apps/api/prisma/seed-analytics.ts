/// <reference types="node" />
import 'dotenv/config';
import { Prisma, PrismaClient, ChatSource } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not configured');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ── Constants ──────────────────────────────────────────────
const SEED_PREFIX = 'seed-analytics-';
const DAYS_TO_SEED = 90;

// Volume profiles for agents
type VolumeProfile = 'high' | 'medium' | 'low';
const VOLUME_PROFILES: Record<
  VolumeProfile,
  { sessionsPerDay: [number, number]; messagesPerSession: [number, number] }
> = {
  high: { sessionsPerDay: [20, 50], messagesPerSession: [5, 15] },
  medium: { sessionsPerDay: [5, 15], messagesPerSession: [3, 8] },
  low: { sessionsPerDay: [1, 5], messagesPerSession: [2, 5] },
};

// Latency profiles
type LatencyProfile = 'fast' | 'medium' | 'slow';
const LATENCY_PROFILES: Record<LatencyProfile, [number, number]> = {
  fast: [200, 800],
  medium: [500, 2000],
  slow: [1000, 5000],
};

// ── Helpers ────────────────────────────────────────────────
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function randFloat(min: number, max: number): number {
  return Math.random() * (max - min) + min;
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

/** Weight toward business hours (9-18) with some 24/7 activity */
function weightedHour(): number {
  const roll = Math.random();
  if (roll < 0.75) {
    // 75% business hours
    return randInt(9, 17);
  }
  // 25% off-hours
  return randInt(0, 23);
}

// ── Message content pools ──────────────────────────────────
const USER_MESSAGES = [
  'What are your pricing plans?',
  'How do I get started?',
  'Can you help me with my order?',
  'I need to reset my password',
  'What payment methods do you accept?',
  'Do you offer a free trial?',
  'How can I contact support?',
  'I have a question about shipping',
  'What is your return policy?',
  'Can I upgrade my plan?',
  'How do I cancel my subscription?',
  'Is there an API available?',
  'What integrations do you support?',
  'I need help with setup',
  'Can you explain your features?',
  'Do you have documentation?',
  'What are your business hours?',
  'How long does delivery take?',
  'Can I schedule a demo?',
  'I found a bug in the product',
  'How do I export my data?',
  'Is there a mobile app?',
  'What security measures do you have?',
  'Can I add more users to my account?',
  'How does billing work?',
];

const ASSISTANT_MESSAGES = [
  "I'd be happy to help you with that! We offer three pricing tiers: Starter at $29/mo, Professional at $79/mo, and Enterprise with custom pricing. Each tier includes different features and usage limits.",
  "Great question! Getting started is easy. First, sign up for a free account, then follow our onboarding wizard which will guide you through the initial setup. It typically takes about 5 minutes.",
  "I can definitely help with your order. Could you please provide your order number so I can look into the details for you?",
  "To reset your password, click on 'Forgot Password' on the login page. You'll receive an email with a reset link within a few minutes. Make sure to check your spam folder if you don't see it.",
  'We accept all major credit cards (Visa, Mastercard, AmEx), PayPal, and bank transfers for annual plans.',
  'Yes! We offer a 14-day free trial with full access to all Professional features. No credit card required to start.',
  "You can reach our support team through this chat, via email at support@example.com, or by phone at 1-800-555-0123 during business hours (9 AM - 6 PM EST).",
  'Shipping typically takes 3-5 business days for standard delivery and 1-2 business days for express. International shipping may take 7-14 business days.',
  'Our return policy allows returns within 30 days of purchase for a full refund. Items must be in original condition. We also offer free return shipping.',
  "Absolutely! You can upgrade your plan at any time from your account settings. The price difference will be prorated for the remainder of your billing cycle.",
  "I understand you'd like to cancel. You can do this from Account Settings > Subscription > Cancel Plan. Your access will continue until the end of your current billing period.",
  'Yes, we have a comprehensive REST API with full documentation. You can find API keys and docs in your dashboard under Settings > Developer.',
  'We support integrations with Slack, Zapier, Salesforce, HubSpot, and many more. Check our integrations page for the full list.',
  "I'll walk you through the setup process. What specific part are you working on? Common starting points are user management, API configuration, or data import.",
  'Our key features include real-time analytics, automated workflows, team collaboration tools, and customizable dashboards. Would you like details on any specific feature?',
];

// ── Visitor ID generation ──────────────────────────────────
function generateVisitorIp(): string {
  return `${randInt(10, 220)}.${randInt(0, 255)}.${randInt(0, 255)}.${randInt(1, 254)}`;
}

// ── Core seed logic ────────────────────────────────────────

async function cleanup() {
  console.log('🧹 Cleaning up previous seed data...');

  const seededSessions = await prisma.chatSession.findMany({
    where: { sessionId: { startsWith: SEED_PREFIX } },
    select: { id: true },
  });

  if (seededSessions.length > 0) {
    const sessionIds = seededSessions.map((s) => s.id);
    const deletedMessages = await prisma.chatMessage.deleteMany({
      where: { chatSessionId: { in: sessionIds } },
    });
    console.log(`  Deleted ${deletedMessages.count} seeded messages`);

    const deletedSessions = await prisma.chatSession.deleteMany({
      where: { sessionId: { startsWith: SEED_PREFIX } },
    });
    console.log(`  Deleted ${deletedSessions.count} seeded sessions`);
  } else {
    console.log('  No previous seed data found');
  }
}

async function getOrgsAndAgents() {
  const orgs = await prisma.organization.findMany({
    include: {
      agents: {
        where: { deletedAt: null },
      },
    },
  });

  if (orgs.length === 0) {
    console.warn(
      '⚠️  No organizations found. Seed against existing orgs/agents — exiting.',
    );
    process.exit(0);
  }

  const orgsWithAgents = orgs.filter((o) => o.agents.length > 0);
  if (orgsWithAgents.length === 0) {
    console.warn(
      '⚠️  No organizations with agents found. Create agents first — exiting.',
    );
    process.exit(0);
  }

  console.log(
    `📊 Found ${orgsWithAgents.length} org(s) with ${orgsWithAgents.reduce((sum, o) => sum + o.agents.length, 0)} total agent(s)`,
  );
  return orgsWithAgents;
}

function assignProfiles(agentIndex: number): {
  volume: VolumeProfile;
  latency: LatencyProfile;
} {
  const volumeOrder: VolumeProfile[] = ['high', 'medium', 'low'];
  const latencyOrder: LatencyProfile[] = ['fast', 'medium', 'slow'];
  return {
    volume: volumeOrder[agentIndex % volumeOrder.length]!,
    latency: latencyOrder[agentIndex % latencyOrder.length]!,
  };
}

async function seedForAgent(
  agentId: string,
  agentName: string,
  volumeProfile: VolumeProfile,
  latencyProfile: LatencyProfile,
) {
  const volumeCfg = VOLUME_PROFILES[volumeProfile];
  const latencyRange = LATENCY_PROFILES[latencyProfile];
  const now = new Date();

  // Build visitor pool — ~30% will be returning visitors
  const totalVisitors = randInt(40, 100);
  const visitorPool: string[] = [];
  for (let i = 0; i < totalVisitors; i++) {
    visitorPool.push(generateVisitorIp());
  }
  // Mark first 30% as "returning" — they'll be reused across multiple days
  const returningCount = Math.ceil(totalVisitors * 0.3);
  const returningVisitors = visitorPool.slice(0, returningCount);

  let sessionCount = 0;
  let messageCount = 0;

  // Batch data for bulk insert
  const allSessions: Array<{
    agentId: string;
    sessionId: string;
    source: ChatSource;
    visitorId: string;
    status: 'ACTIVE' | 'EXPIRED';
    createdAt: Date;
    updatedAt: Date;
    lastMessageAt: Date;
  }> = [];

  const allMessages: Array<Prisma.ChatMessageCreateManyInput> = [];

  // Session ID → UUID mapping (we need to pre-generate UUIDs for bulk insert)
  const sessionUuids: Map<string, string> = new Map();

  for (let dayOffset = DAYS_TO_SEED - 1; dayOffset >= 0; dayOffset--) {
    const dayDate = new Date(now);
    dayDate.setDate(dayDate.getDate() - dayOffset);
    dayDate.setHours(0, 0, 0, 0);

    // Weekend: reduce volume by ~60%
    const isWeekend = dayDate.getDay() === 0 || dayDate.getDay() === 6;
    const dayMultiplier = isWeekend ? 0.4 : 1;

    const sessionsToday = Math.max(
      1,
      Math.round(
        randInt(volumeCfg.sessionsPerDay[0], volumeCfg.sessionsPerDay[1]) *
          dayMultiplier,
      ),
    );

    for (let s = 0; s < sessionsToday; s++) {
      const hour = weightedHour();
      const minute = randInt(0, 59);
      const second = randInt(0, 59);

      const sessionStart = new Date(dayDate);
      sessionStart.setHours(hour, minute, second, 0);

      const sessionId = `${SEED_PREFIX}${agentId.slice(0, 8)}-${dayOffset}-${s}`;
      const uuid = crypto.randomUUID();
      sessionUuids.set(sessionId, uuid);

      // Pick visitor — favor returning visitors
      const useReturning = Math.random() < 0.3 && returningVisitors.length > 0;
      const visitorId = useReturning
        ? pickRandom(returningVisitors)
        : pickRandom(visitorPool);

      const msgCount = randInt(
        volumeCfg.messagesPerSession[0],
        volumeCfg.messagesPerSession[1],
      );

      let lastMsgTime = sessionStart;

      // Generate messages
      for (let m = 0; m < msgCount; m++) {
        const isUser = m % 2 === 0;
        const gap = isUser
          ? randInt(5, 60)
          : randFloat(latencyRange[0], latencyRange[1]) / 1000;
        const msgTime = new Date(lastMsgTime.getTime() + gap * 1000);

        if (isUser) {
          allMessages.push({
            chatSessionId: uuid,
            role: 'USER',
            content: pickRandom(USER_MESSAGES),
            metadata: Prisma.JsonNull,
            createdAt: msgTime,
          });
        } else {
          const responseLatencyMs = Math.round(
            randFloat(latencyRange[0], latencyRange[1]),
          );
          const backendReceivedAt = new Date(lastMsgTime.getTime() + 50);
          const backendRespondedAt = new Date(
            backendReceivedAt.getTime() + responseLatencyMs,
          );

          allMessages.push({
            chatSessionId: uuid,
            role: 'ASSISTANT',
            content: pickRandom(ASSISTANT_MESSAGES),
            metadata: {
              backendReceivedAt: backendReceivedAt.toISOString(),
              n8nReceivedAt: null,
              agentRepliedAt: null,
              backendRespondedAt: backendRespondedAt.toISOString(),
              responseLatencyMs,
            },
            createdAt: msgTime,
          });
        }

        lastMsgTime = msgTime;
        messageCount++;
      }

      allSessions.push({
        agentId,
        sessionId,
        source: ChatSource.WIDGET,
        visitorId,
        status: 'EXPIRED',
        createdAt: sessionStart,
        updatedAt: lastMsgTime,
        lastMessageAt: lastMsgTime,
      });

      sessionCount++;
    }
  }

  // Bulk insert sessions and messages using createMany (fast, no transaction timeout)
  const BATCH_SIZE = 500;

  const sessionRows = allSessions.map((s) => ({
    id: sessionUuids.get(s.sessionId)!,
    agentId: s.agentId,
    sessionId: s.sessionId,
    source: s.source,
    visitorId: s.visitorId,
    status: s.status,
    createdAt: s.createdAt,
    updatedAt: s.updatedAt,
    lastMessageAt: s.lastMessageAt,
  }));

  for (let i = 0; i < sessionRows.length; i += BATCH_SIZE) {
    await prisma.chatSession.createMany({
      data: sessionRows.slice(i, i + BATCH_SIZE),
    });
  }

  for (let i = 0; i < allMessages.length; i += BATCH_SIZE) {
    await prisma.chatMessage.createMany({
      data: allMessages.slice(i, i + BATCH_SIZE),
    });
  }

  console.log(
    `  🤖 ${agentName}: ${sessionCount} sessions, ${messageCount} messages (${volumeProfile} volume, ${latencyProfile} latency)`,
  );
}

// ── Main ───────────────────────────────────────────────────
async function main() {
  console.log('🌱 Analytics Seed Script');
  console.log('========================\n');

  await cleanup();

  const orgs = await getOrgsAndAgents();

  let globalAgentIndex = 0;

  for (const org of orgs) {
    console.log(`\n🏢 Org: ${org.name} (${org.agents.length} agents)`);

    for (const agent of org.agents) {
      const { volume, latency } = assignProfiles(globalAgentIndex);
      await seedForAgent(agent.id, agent.name, volume, latency);
      globalAgentIndex++;
    }
  }

  console.log('\n✅ Analytics seed complete!');
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
