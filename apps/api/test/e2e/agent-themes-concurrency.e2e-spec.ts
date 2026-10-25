import { execSync } from "child_process";
import { join } from "path";
import { AccessScope, Role } from "@prisma/client";
import { AgentThemesService } from "../../src/services/agent-themes.service";
import { PrismaService } from "../../src/services/prisma.service";
import type { AgentLoggerService } from "../../src/common/logger/agent.logger";
import type { PermissionCatalogService } from "../../src/common/rbac/permission-catalog.service";
import type { CurrentUserData } from "../../src/decorators/current-user.decorator";
import type {
  PartialWidgetTheme,
  WidgetTheme,
} from "../../src/models/agent-theme.dto";

/**
 * Real Postgres (test/setup/global-setup.ts). Concurrent theme writes to one
 * agent must all land: each write reads the stored theme and writes back a
 * result built from it, so without serialisation a later write drops an
 * earlier one's change.
 */
describe("AgentThemesService concurrent writes (Postgres)", () => {
  let prisma: PrismaService;
  let service: AgentThemesService;
  let agentId: string;
  let user: CurrentUserData;

  beforeAll(async () => {
    // prisma.config.ts prefers DIRECT_URL, and dotenv would fill it from
    // apps/api/.env (the developer's database). Pin both to the container.
    const containerUrl = process.env.DATABASE_URL;
    execSync("bunx prisma migrate deploy", {
      cwd: join(__dirname, "..", ".."),
      env: {
        ...process.env,
        DIRECT_URL: containerUrl,
        DATABASE_URL: containerUrl,
      },
      stdio: "pipe",
    });
    prisma = new PrismaService();
    await prisma.$connect();

    const org = await prisma.organization.create({
      data: { name: "Concurrency Org", slug: `concurrency-${Date.now()}` },
    });
    const agent = await prisma.agent.create({
      data: {
        name: "Concurrency Agent",
        publicId: "CONC0001",
        organizationId: org.id,
      },
    });
    agentId = agent.id;
    user = {
      clerkId: "user_concurrency",
      email: "concurrency@test.invalid",
      id: "concurrency-user",
      role: Role.ADMIN,
      accessScope: AccessScope.PLATFORM,
      roleKeys: [],
      organizationId: org.id,
      organization: { id: org.id, name: org.name, slug: org.slug },
    };

    const logger = {
      logThemeUpdated: jest.fn(),
      logThemeReset: jest.fn(),
      logConsentNoticeUpdated: jest.fn(),
    } as unknown as AgentLoggerService;
    const catalog = {
      resolvePermissions: () =>
        new Set(["AgentTheme:UpdateBranding", "AgentTheme:UpdateConsent"]),
    } as unknown as PermissionCatalogService;
    service = new AgentThemesService(prisma, logger, catalog);
  });

  it("does not hold up rows that reference the agent while a theme write is locked", async () => {
    const other = await prisma.agent.create({
      data: {
        name: "FK Agent",
        publicId: "CONC0002",
        organizationId: user.organizationId!,
      },
    });
    let insertedWhileLocked = false;

    await prisma.$transaction(
      async (tx) => {
        await service["lockAgentForThemeWrite"](tx, other.id);
        // Another connection inserts a row with a foreign key to the locked
        // agent, as a new chat session does. It must not wait for the lock.
        await Promise.race([
          prisma.agentTheme
            .create({ data: { agentId: other.id, config: {}, version: 1 } })
            .then(() => {
              insertedWhileLocked = true;
            }),
          new Promise((resolve) => setTimeout(resolve, 3_000)),
        ]);
      },
      { timeout: 10_000 },
    );

    expect(insertedWhileLocked).toBe(true);
  });

  afterAll(async () => {
    await prisma?.$disconnect();
  });

  it("keeps every change from concurrent PATCHes, including the first save", async () => {
    const patches: PartialWidgetTheme[] = [
      { header: { title: "Title A" } },
      { header: { subtitle: "Subtitle B" } },
      { bubble: { text: "Bubble C" } },
      { input: { placeholderText: "Placeholder D" } },
      { botMessage: { backgroundColor: "#111111" } },
      { userMessage: { backgroundColor: "#222222" } },
      { handover: { buttonLabel: "Human G" } },
      { timestamps: { color: "#333333" } },
    ];

    await Promise.all(patches.map((p) => service.patchTheme(agentId, p, user)));

    const stored = await prisma.agentTheme.findUniqueOrThrow({
      where: { agentId },
    });
    const config = stored.config as WidgetTheme;
    expect(stored.version).toBe(patches.length);
    expect(config.header.title).toBe("Title A");
    expect(config.header.subtitle).toBe("Subtitle B");
    expect(config.bubble.text).toBe("Bubble C");
    expect(config.input.placeholderText).toBe("Placeholder D");
    expect(config.botMessage.backgroundColor).toBe("#111111");
    expect(config.userMessage.backgroundColor).toBe("#222222");
    expect(config.handover.buttonLabel).toBe("Human G");
    expect(config.timestamps.color).toBe("#333333");
  });
});
