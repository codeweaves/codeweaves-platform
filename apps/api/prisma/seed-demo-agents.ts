/**
 * Seed demo agents for the AI orchestration dev test page.
 *
 * Creates (idempotently):
 *   - Demo Organization "AI Dev Sandbox" (slug: 'ai-dev-sandbox')
 *   - Agent "Normal Bot"   — simple direct-mode chat, no RAG
 *   - Agent "RAG Bot"      — direct-mode, RAG enabled (documents come later)
 *
 * Run:
 *   cd apps/api && bun run prisma/seed-demo-agents.ts
 *
 * Safe to re-run: existing records with matching names are left alone, not
 * duplicated.
 */
import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, type Prisma } from '@prisma/client';
import { nanoid } from 'nanoid';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error('DATABASE_URL environment variable is not configured');
}
const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

const DEMO_ORG_SLUG = 'ai-dev-sandbox';
// Per-agent model selection, one provider per bot so the dev page exercises
// all four integration paths (Groq / Gemini / OpenAI direct / OpenRouter).
//   - Groq free tier: 30 req/min, 6000/day. Fastest inference anywhere.
//   - Gemini free tier: 15 req/min, 1500/day, 1M context window.
//   - OpenAI GPT-4.1: paid, but best instruction-following for strict prompts.
const NORMAL_BOT_MODEL = 'groq:llama-3.3-70b-versatile';
// Gemini 2.5 Flash Lite: smaller/faster variant of Flash. 1M context retained.
const RAG_BOT_MODEL = 'gemini:gemini-2.5-flash-lite';
// Gemini 2.5 Flash (free): picked over GPT-4.1-mini for the P&P demo because
// it handles 95%+ of the strict rules correctly for $0 (no credit burn). Note:
// TTFT is variable (1.3-4.5s on free tier) and occasional mid-Markdown cutoffs
// happen. maxTokens raised to 4096 to accommodate Gemini's thinking-mode token
// usage. For production-grade consistency: swap to 'openai:gpt-4.1-mini'.
const SHREYA_MODEL = 'gemini:gemini-2.5-flash';

const NORMAL_BOT_NAME = 'Normal Bot';
const NORMAL_BOT_PROMPT = `You are a friendly, helpful assistant for testing the CodeWeaves AI orchestration layer.

- Keep responses concise (2-3 sentences unless the user asks for detail).
- If the user asks what you can do, explain you're a demo agent for testing streaming chat.
- Be honest: if you don't know something, say so — don't make things up.
- You do NOT have access to any external knowledge base. Everything you say comes from your training data.`;

const RAG_BOT_NAME = 'RAG Bot';
const RAG_BOT_PROMPT = `You are a knowledge-grounded assistant for the CodeWeaves AI orchestration layer demo.

When a knowledge base is connected (Phase 3), you MUST:
- Ground every factual claim in the provided sources
- Cite sources inline using [Source N] notation
- If the sources don't contain enough information to answer, say so explicitly
- Never fabricate information not present in the sources

Until the knowledge base is connected, answer conversationally but keep responses brief.`;

const SHREYA_NAME = 'Shreya (P&P Associates)';
const SHREYA_PROMPT = `PANVELKAR & POL ASSOCIATES
AI SALES & SUPPORT ASSISTANT CONFIGURATION

--------------------------------------------
1. ROLE DEFINITION
--------------------------------------------
You are Shreya, AI Sales & Support Assistant for Panvelkar & Pol Associates.

Tone must always be:
1. Formal
2. Clear
3. Business-like
4. Articulate
5. Efficient

Strictly prohibited:
- Slang
- Emojis
- Casual expressions

--------------------------------------------
2. LANGUAGE RULE (STRICT)
--------------------------------------------
Respond only in the exact language used by the user.
1. English → English
2. Hindi → Hindi
3. Hinglish → Hinglish
Do not switch languages.

--------------------------------------------
3. RESPONSE LENGTH RULE
--------------------------------------------
1. 50–150 characters only
2. One concise line if simple
3. No unnecessary explanation

--------------------------------------------
4. KNOWLEDGE BASE RESTRICTION (HIGHEST PRIORITY)
--------------------------------------------
Use ONLY the Official Knowledge Base in Section 5.

If information is unavailable, respond exactly with:

I'm sorry, I don't have that information. Could you please share your name, email, and phone number so our manager can reach out to you regarding this?

--------------------------------------------
5. OFFICIAL KNOWLEDGE BASE
--------------------------------------------

5.1 ABOUT THE FIRM
Panvelkar & Pol Associates is a premier consultancy dedicated to guiding organizations through the complexities of Indian labour regulations.

Specializations:
1. Labour Law Compliance
2. Employee Relations Audits
3. Workplace Policy Advisory

Mission:
To analyze, assess, and enhance workplace relations through detailed audits, risk mitigation strategies, and compliance frameworks, providing actionable insights that strengthen workforce stability and business performance.

Vision:
To be the most trusted and pioneering consultancy in Employee Relations and Industrial Relations Audits.

Goal:
To help organizations achieve compliance, workplace harmony, and sustainable growth through transparent, legally sound, employee-centric workplaces.

Combined Experience:
Over six decades at the highest levels of labour administration.

Organizations Guided: 500+
Compliance Record: 100%

5.2 LEADERSHIP

1. Vikas Panvelkar
   - Retired Deputy Commissioner of Labour (33 years' experience)
   - B.Com
   - MSW in Labour Welfare & Personnel Management
   - Specialization: Employee Relations Audits and Labour Laws
   - Contact: +91 9822348676
   - Email: vikas.panvelkar@panvelkarandpolassociates.com

2. Shailendra Pol
   - Retired Additional Commissioner of Labour (34 years' experience)
   - B.A.
   - Diploma in Labour Laws & Welfare
   - Master's in Labour Management
   - Specialization: Employee Relations Audits, Compliance, and Labour Laws
   - Contact: +91 9833773535
   - Email: shailendra.pol@panvelkarandpolassociates.com

Together, they have successfully guided 500+ organizations with a 100% compliance track record.

5.3 SERVICES

1. Labour Law Compliance Audits
   - Evaluation of adherence to central and state labour laws
   - Statutory compliance assessments
   - Risk identification
   - Remediation roadmap
   - Ongoing monitoring
   - External audits provide unbiased risk identification

2. Employee Relations Advisory
   - Dispute resolution
   - Grievance handling
   - Union negotiations
   - Early intervention prevents escalation

3. Workplace Policy Development
   - Policy drafting
   - Legal review
   - Implementation guidance
   - Regular updates
   - Tailored policies reduce industry-specific risks

4. Implementation of Upcoming Labour Codes
   - Gap analysis
   - Impact assessment
   - Wage definition restructuring
   - Delay increases compliance complexity

5. Regulatory Representation
   - Representation before labour commissioners and authorities
   - Documentation support
   - Hearing preparation
   - Advantage from insider regulatory experience

6. Crisis Management
   - Labour crisis intervention
   - 24/7 emergency response
   - Investigation management
   - Media handling

7. Payroll and Compliance Management
   - End-to-end payroll processing
   - Statutory payments (including Provident Fund)
   - Reduces costly compliance errors

8. Strategic HR Transformation
   - HR process reviews
   - System optimization
   - Training programs
   - Begins with deep-dive HR diagnostic

5.4 CONTACT DETAILS

General Email:
support@panvelkarandpolassociates.com

Office Hours:
1. Monday–Friday: 9:00 AM – 6:00 PM
2. Saturday: 9:00 AM – 1:00 PM
3. Sunday: Closed

Response Time:
Within 24 business hours.
Mention "URGENT" in subject line for urgent matters.

Website URLs:
1. Home: https://www.panvelkarandpolassociates.com/
2. Services: https://www.panvelkarandpolassociates.com/services
3. About: https://www.panvelkarandpolassociates.com/about
4. Contact: https://www.panvelkarandpolassociates.com/contact

--------------------------------------------
6. LEGAL ADVICE RESTRICTION
--------------------------------------------
If asked for legal advice, respond exactly with:

As an AI assistant, I cannot provide legal advice. However, this is precisely the type of complex issue our experts, Mr. Panvelkar and Mr. Pol, can provide strategic guidance on. I can arrange a consultation for you.

--------------------------------------------
7. SERVICE SCOPE LIMITATION
--------------------------------------------
If asked about international labour laws:
- Clarify specialization in Indian labour regulations
- Recommend consulting an international specialist firm

--------------------------------------------
8. LEAD CAPTURE RULE
--------------------------------------------
After 3–4 exchanges (or earlier if strong intent shown), request:
1. Full Name
2. Email Address
3. Phone Number

--------------------------------------------
9. UNRELATED QUESTIONS
--------------------------------------------
Respond professionally and redirect toward services.

--------------------------------------------
10. MARKDOWN OUTPUT RULE (CRITICAL)
--------------------------------------------
All responses must be in clean Markdown (MD) format.

Formatting rules:
1. Use proper paragraph spacing
2. Use numbered or bullet lists only when necessary
3. Use standard Markdown link format: [Link Text](URL)
4. Do not output raw URLs unless unavoidable

Emphasis Rules (Strict):
- Use **bold**, *italic*, underline, or links only around key words, phrases, or critical actions that truly require emphasis.
- Never format entire sentences or paragraphs.
- Treat formatting like a highlighter — apply it only to the exact words that must stand out.

Correct Example:
Please complete the **report submission** by *5 PM today*.

Only the important phrases are formatted.

Strictly prohibited:
- HTML tags
- CSS
- Inline styling
- Over-formatting full sentences or paragraphs
- Backticks unless absolutely necessary for structure

--------------------------------------------
11. PRIORITY ORDER
--------------------------------------------
1. Knowledge Base Restriction
2. Legal Advice Restriction
3. Language Rule
4. Response Length Rule
5. Lead Capture Rule
6. Markdown Output Rule

Never violate Knowledge Base boundaries.`;

/**
 * Prisma 7 doesn't allow writing typed JSONB shapes directly without a cast
 * through InputJsonValue — so the aiConfig payload lives in a factory that
 * returns a fresh object per call (safer than a module-level constant for
 * createMany-style writes).
 */
/**
 * Build an aiConfig JSONB payload for an agent. `modelId` is required per-agent
 * because different bots use different providers (Groq / Gemini / OpenAI).
 *
 * Note on fallbackModels: only OpenRouter's API supports native model fallback
 * routing (`models: []`). Direct providers (Groq, OpenAI, Gemini) don't — so
 * fallbackModels is left empty for direct-provider agents. If we later add
 * client-side cross-provider fallback in the resilience layer, agents can opt
 * in with a fallbackModels array of any provider's model IDs.
 */
function makeAiConfig(
  modelId: string,
  extra: Record<string, unknown> = {},
): Prisma.InputJsonValue {
  return {
    routingMode: 'direct',
    modelId,
    temperature: 0.7,
    maxTokens: 2048,
    maxContextMessages: 20,
    contextStrategy: 'sliding-window',
    ragEnabled: false,
    ragRerankEnabled: true,
    cachingEnabled: true,
    ...extra,
  };
}

/** Generate an 8-char public ID matching the platform's existing format. */
function generatePublicId(): string {
  return nanoid(8);
}

async function upsertOrg() {
  const existing = await prisma.organization.findUnique({
    where: { slug: DEMO_ORG_SLUG },
  });
  if (existing) {
    console.log(`  ✓ Org "${existing.name}" already exists (${existing.id})`);
    return existing;
  }
  const org = await prisma.organization.create({
    data: { name: 'AI Dev Sandbox', slug: DEMO_ORG_SLUG },
  });
  console.log(`  + Created org "${org.name}" (${org.id})`);
  return org;
}

async function upsertAgent(params: {
  orgId: string;
  name: string;
  systemPrompt: string;
  welcomeMessage: string;
  aiConfig: Prisma.InputJsonValue;
}) {
  const existing = await prisma.agent.findFirst({
    where: {
      name: params.name,
      organizationId: params.orgId,
      deletedAt: null,
    },
  });

  if (existing) {
    // Update aiConfig + systemPrompt on re-run so seed changes land without
    // requiring a manual delete. Keeps the demo setup current.
    const updated = await prisma.agent.update({
      where: { id: existing.id },
      data: {
        systemPrompt: params.systemPrompt,
        welcomeMessage: params.welcomeMessage,
        aiConfig: params.aiConfig,
        status: 'ACTIVE',
      },
    });
    console.log(
      `  ✓ Agent "${updated.name}" refreshed (id=${updated.id}, publicId=${updated.publicId})`,
    );
    return updated;
  }

  // Retry loop in case the generated publicId collides (unlikely at 8 chars
  // but handled like the rest of the codebase does).
  for (let attempt = 0; attempt < 3; attempt++) {
    const publicId = generatePublicId();
    try {
      const agent = await prisma.agent.create({
        data: {
          publicId,
          name: params.name,
          organizationId: params.orgId,
          status: 'ACTIVE',
          systemPrompt: params.systemPrompt,
          welcomeMessage: params.welcomeMessage,
          aiConfig: params.aiConfig,
          allowedDomains: [],
        },
      });
      console.log(
        `  + Created agent "${agent.name}" (id=${agent.id}, publicId=${agent.publicId})`,
      );
      return agent;
    } catch (err) {
      const e = err as { code?: string };
      if (e.code === 'P2002' && attempt < 2) {
        continue; // publicId collision — try a new one
      }
      throw err;
    }
  }
  throw new Error('Failed to create agent after retries');
}

async function main() {
  console.log('\n🌱 Seeding demo agents for AI orchestration dev test page...\n');

  const org = await upsertOrg();

  // Normal Bot → Groq direct. Free tier, 400+ tok/sec — the fastest option
  // anywhere. Used as the "how fast can streaming feel?" demo.
  const normalBot = await upsertAgent({
    orgId: org.id,
    name: NORMAL_BOT_NAME,
    systemPrompt: NORMAL_BOT_PROMPT,
    welcomeMessage:
      "Hi! I'm Normal Bot, your basic streaming chat demo. Ask me anything to see the AI orchestration flow in action.",
    aiConfig: makeAiConfig(NORMAL_BOT_MODEL, { ragEnabled: false }),
  });

  // RAG Bot → Gemini direct (Google AI Studio). Free tier with 1M context
  // window — useful for RAG when documents get long.
  const ragBot = await upsertAgent({
    orgId: org.id,
    name: RAG_BOT_NAME,
    systemPrompt: RAG_BOT_PROMPT,
    welcomeMessage:
      "Hi! I'm RAG Bot. In Phase 3 I'll be grounded in uploaded documents. For now, I behave like a cautious assistant that admits what it doesn't know.",
    aiConfig: makeAiConfig(RAG_BOT_MODEL, { ragEnabled: true }),
  });

  // Shreya is the production-style demo: Panvelkar & Pol Associates's sales
  // assistant with a strict formal tone, 50-150 char response cap, and an
  // inline knowledge base. Uses OpenAI GPT-4.1 direct for the best instruction-
  // following on the strict Markdown + length rules. Temperature 0.4 (lower
  // than default) helps the model comply more reliably.
  const shreya = await upsertAgent({
    orgId: org.id,
    name: SHREYA_NAME,
    systemPrompt: SHREYA_PROMPT,
    welcomeMessage:
      'Good day. I am Shreya, AI Sales & Support Assistant for Panvelkar & Pol Associates. How may I assist you today?',
    aiConfig: makeAiConfig(SHREYA_MODEL, {
      temperature: 0.4,
      // Raised from 512 because Gemini 2.5 Flash uses "thinking mode" tokens
      // (internal reasoning) that count toward the output budget BEFORE any
      // visible response is generated. 512 was getting fully consumed by
      // thinking and the actual reply was truncated.
      maxTokens: 4096,
      ragEnabled: false,
    }),
  });

  console.log('\n✅ Seed complete.\n');
  console.log('Try it out:');
  console.log('  1. Start the API:   cd apps/api && bun run dev');
  console.log('  2. Open in browser: http://localhost:3001/dev/ai/test-chat');
  console.log(
    `  3. Select agent:    "${normalBot.name}", "${ragBot.name}", or "${shreya.name}"`,
  );
  console.log('  4. Send a message and watch the trace panel fill up.');
  console.log(
    '\nWatch logs live:     tail -f apps/api/logs/ai-trace.log | jq',
  );
  console.log('');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
