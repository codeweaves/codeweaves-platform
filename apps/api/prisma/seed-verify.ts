/**
 * Seed the fixed tenants and users the `verify` skill drives (.claude/skills/verify).
 *
 * Creates, idempotently:
 *   - Org "Verify Sandbox" (`verify-sandbox`) with three agents:
 *       chat   "Verify Chat Bot"   text chat, human-handover button on
 *       voice  "Verify Voice Bot"  voice enabled
 *       editor "Verify Editor Bot" the one agent editor recipes may change
 *       failing "Verify Failing Bot" its model does not exist: the LLM-error path
 *   - Org "Verify Other Org" (`verify-other`) with "Verify Other Bot": a tenant the
 *     sandbox users must NOT reach, for isolation checks
 *   - Three Clerk DEVELOPMENT users per machine, linked to local users:
 *       owner      `verify-owner-<host>+clerk_test@example.com`      org.owner
 *       teammate   `verify-teammate-<host>+clerk_test@example.com`   org.inbox_agent
 *       superadmin `verify-superadmin-<host>+clerk_test@example.com` platform.super_admin
 *
 * Writes `.verify/state.json` (ids) and `.verify/credentials.json` (passwords) at
 * the repo root. Both are gitignored. The last stdout line is the state as JSON.
 *
 * Refuses to run against a non-local database or a non-test Clerk key.
 *
 * Run: cd apps/api && bun run prisma/seed-verify.ts
 */
import "dotenv/config";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { AccessScope, Prisma, PrismaClient, Role } from "@prisma/client";
import { nanoid } from "nanoid";
import { assertLocalDatabase } from "../prisma.config";

const SANDBOX = { slug: "verify-sandbox", name: "Verify Sandbox" };
const OTHER = { slug: "verify-other", name: "Verify Other Org" };
// Cheap and reliable for short verification replies.
const MODEL = "openai:gpt-4.1-mini";
const CLERK_API = "https://api.clerk.com/v1";

// One set of Clerk test users per machine. Shared users would break: each
// machine's seed sets its own random password, which logs the others out.
const MACHINE = hostname()
  .toLowerCase()
  .replace(/[^a-z0-9-]/g, "-")
  .slice(0, 30);

type UserKey = "owner" | "teammate" | "superadmin";
const USERS: Record<
  UserKey,
  { roleKey: string; name: string; platform: boolean }
> = {
  owner: { roleKey: "org.owner", name: "Verify Owner", platform: false },
  teammate: {
    roleKey: "org.inbox_agent",
    name: "Verify Teammate",
    platform: false,
  },
  superadmin: {
    roleKey: "platform.super_admin",
    name: "Verify Superadmin",
    platform: true,
  },
};
const emailFor = (key: UserKey) =>
  `verify-${key}-${MACHINE}+clerk_test@example.com`;

const VERIFY_DIR = resolve(__dirname, "../../../.verify");
const STATE_FILE = join(VERIFY_DIR, "state.json");
const CREDS_FILE = join(VERIFY_DIR, "credentials.json");

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
assertLocalDatabase(databaseUrl, ["node", "prisma", "migrate", "dev"]);

const clerkKey = process.env.CLERK_SECRET_KEY ?? "";
if (!clerkKey.startsWith("sk_test_")) {
  throw new Error(
    "CLERK_SECRET_KEY must be a development key (sk_test_...). The verify seed never touches a production Clerk instance.",
  );
}

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: databaseUrl }),
});

async function clerk<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${CLERK_API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${clerkKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) {
    throw new Error(
      `Clerk ${init.method ?? "GET"} ${path} failed: ${res.status} ${await res.text()}`,
    );
  }
  return (await res.json()) as T;
}

type Credentials = Partial<
  Record<UserKey, { email: string; password: string }>
>;

function savedCredentials(): Credentials {
  if (!existsSync(CREDS_FILE)) return {};
  const raw = JSON.parse(readFileSync(CREDS_FILE, "utf8")) as {
    users?: Credentials;
  };
  return raw.users ?? {};
}

async function upsertClerkUser(
  email: string,
  name: string,
  password: string,
): Promise<string> {
  const found = await clerk<{ id: string }[]>(
    `/users?email_address=${encodeURIComponent(email)}`,
  );
  const body = { password, skip_password_checks: true };
  if (found[0]) {
    await clerk(`/users/${found[0].id}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return found[0].id;
  }
  const [first, last] = name.split(" ");
  const created = await clerk<{ id: string }>("/users", {
    method: "POST",
    body: JSON.stringify({
      ...body,
      email_address: [email],
      first_name: first,
      last_name: last,
    }),
  });
  return created.id;
}

async function upsertOrg(org: { slug: string; name: string }) {
  return prisma.organization.upsert({
    where: { slug: org.slug },
    update: { deletedAt: null },
    create: org,
  });
}

async function upsertAgent(
  orgId: string,
  name: string,
  data: Prisma.AgentUncheckedUpdateInput,
) {
  const existing = await prisma.agent.findFirst({
    where: { name, organizationId: orgId, deletedAt: null },
  });
  if (existing) {
    return prisma.agent.update({
      where: { id: existing.id },
      data: { ...data, status: "ACTIVE" },
    });
  }
  return prisma.agent.create({
    data: {
      ...(data as Prisma.AgentUncheckedCreateInput),
      publicId: nanoid(8),
      name,
      organizationId: orgId,
      status: "ACTIVE",
      allowedDomains: [],
    },
  });
}

async function upsertUser(key: UserKey, clerkId: string, orgId: string) {
  const spec = USERS[key];
  const email = emailFor(key);
  const scope = spec.platform ? AccessScope.PLATFORM : AccessScope.ORG;
  const organizationId = spec.platform ? null : orgId;
  const user = await prisma.user.upsert({
    where: { email },
    update: { clerkId, organizationId, accessScope: scope, deletedAt: null },
    create: {
      email,
      name: spec.name,
      clerkId,
      organizationId,
      accessScope: scope,
      // Legacy tier, still written because invitations read it (see seed.ts).
      ...(spec.platform ? { role: Role.SUPER_ADMIN } : {}),
    },
  });
  // PLATFORM grants carry no organization; ORG grants are tied to the org.
  const grant = await prisma.userRoleAssignment.findFirst({
    where: { userId: user.id, roleKey: spec.roleKey, organizationId },
  });
  if (!grant) {
    await prisma.userRoleAssignment.create({
      data: { userId: user.id, roleKey: spec.roleKey, organizationId },
    });
  } else if (grant.deletedAt) {
    await prisma.userRoleAssignment.update({
      where: { id: grant.id },
      data: { deletedAt: null },
    });
  }
  return {
    id: user.id,
    email,
    clerkId,
    role: spec.roleKey,
    accessScope: scope,
  };
}

async function main() {
  const sandbox = await upsertOrg(SANDBOX);
  const other = await upsertOrg(OTHER);

  const aiConfig: Prisma.InputJsonValue = {
    routingMode: "direct",
    modelId: MODEL,
    temperature: 0.4,
    maxTokens: 512,
    maxContextMessages: 20,
    contextStrategy: "sliding-window",
    ragEnabled: false,
    ragRerankEnabled: false,
    cachingEnabled: true,
  };
  const systemPrompt =
    "You are the Verify Sandbox test assistant. Reply in one or two short sentences.";

  const chat = await upsertAgent(sandbox.id, "Verify Chat Bot", {
    systemPrompt,
    welcomeMessage: "Hi, I am the Verify Chat Bot.",
    aiConfig,
    humanTakeoverEnabled: true,
    showTalkToHumanButton: true,
  });
  const voice = await upsertAgent(sandbox.id, "Verify Voice Bot", {
    systemPrompt,
    welcomeMessage: "Hi, I am the Verify Voice Bot.",
    aiConfig,
    voiceEnabled: true,
    voiceConfig: {
      ttsSpeed: 1,
      sttEnabled: true,
      ttsEnabled: true,
      defaultLanguage: "en",
      autoDetectLanguage: false,
      supportedLanguages: ["en"],
    },
  });
  // Editor recipes change this agent. Every agent-level field they touch is
  // reset here, so a seed run always returns it to the same baseline. Its theme
  // is reset from the editor with "Reset to Defaults".
  const editor = await upsertAgent(sandbox.id, "Verify Editor Bot", {
    systemPrompt,
    welcomeMessage: "Hi, I am the Verify Editor Bot.",
    aiConfig,
    humanTakeoverEnabled: false,
    showTalkToHumanButton: false,
    humanConnectedLabel: null,
    handoverEmailEnabled: false,
    handoverEmailRecipients: [],
    voiceEnabled: false,
    voiceConfig: Prisma.DbNull,
    categoryKeywords: [],
    supportedLanguages: [],
    fallbackPhrases: [],
    sessionLifetimeHours: 6,
  });
  await prisma.agentKnowledge.deleteMany({ where: { agentId: editor.id } });
  // Error-path fixture: the model does not exist, so every LLM call fails the
  // same way a provider outage or exhausted quota would.
  const failing = await upsertAgent(sandbox.id, "Verify Failing Bot", {
    systemPrompt,
    welcomeMessage: "Hi, I am the Verify Failing Bot.",
    aiConfig: {
      ...(aiConfig as Record<string, unknown>),
      modelId: "openai:verify-model-does-not-exist",
    },
  });
  const otherBot = await upsertAgent(other.id, "Verify Other Bot", {
    systemPrompt,
    welcomeMessage: "Hi, I belong to another org.",
    aiConfig,
  });

  const previous = savedCredentials();
  const credentials: Credentials = {};
  const users: Record<string, Awaited<ReturnType<typeof upsertUser>>> = {};
  for (const key of Object.keys(USERS) as UserKey[]) {
    const email = emailFor(key);
    const password =
      previous[key]?.email === email && previous[key]?.password
        ? previous[key].password
        : `${randomBytes(18).toString("base64url")}Aa1!`;
    const clerkId = await upsertClerkUser(email, USERS[key].name, password);
    users[key] = await upsertUser(key, clerkId, sandbox.id);
    credentials[key] = { email, password };
  }

  const pick = (a: { id: string; publicId: string; name: string }) => ({
    id: a.id,
    publicId: a.publicId,
    name: a.name,
  });
  const state = {
    machine: MACHINE,
    org: { id: sandbox.id, slug: sandbox.slug, name: sandbox.name },
    otherOrg: {
      id: other.id,
      slug: other.slug,
      name: other.name,
      agent: pick(otherBot),
    },
    agents: {
      chat: pick(chat),
      voice: pick(voice),
      editor: pick(editor),
      failing: pick(failing),
    },
    users,
    // Kept for older callers; equals users.owner.
    owner: users.owner,
  };
  mkdirSync(VERIFY_DIR, { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
  writeFileSync(
    CREDS_FILE,
    `${JSON.stringify({ users: credentials }, null, 2)}\n`,
  );
  console.log(JSON.stringify(state));
}

main()
  .catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
