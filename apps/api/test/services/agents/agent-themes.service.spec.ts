import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AgentThemesService } from "../../../src/services/agent-themes.service";
import { PermissionCatalogService } from "../../../src/common/rbac/permission-catalog.service";
import { PrismaService } from "../../../src/services/prisma.service";
import { AgentLoggerService } from "../../../src/common/logger/agent.logger";
import { Role, AccessScope } from "@prisma/client";
import type { CurrentUserData } from "../../../src/decorators/current-user.decorator";
import {
  defaultWidgetTheme,
  widgetThemeSchema,
  partialWidgetThemeSchema,
} from "../../../src/models/agent-theme.dto";
import { ZodValidationPipe } from "../../../src/pipes/zod-validation.pipe";
import type { WidgetTheme } from "../../../src/models/agent-theme.dto";

describe("AgentThemesService", () => {
  let service: AgentThemesService;

  const mockPrismaService = {
    agent: {
      findFirst: jest.fn(),
    },
    agentTheme: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    $transaction: jest.fn(),
  };

  const mockAgentLogger = {
    logThemeUpdated: jest.fn(),
    logThemeReset: jest.fn(),
    logConsentNoticeUpdated: jest.fn(),
  };

  const orgId = "123e4567-e89b-12d3-a456-426614174000";
  const otherOrgId = "223e4567-e89b-12d3-a456-426614174000";
  const agentId = "333e4567-e89b-12d3-a456-426614174000";

  const mockAgent = {
    id: agentId,
    organizationId: orgId,
    deletedAt: null,
  };

  const adminUser: CurrentUserData = {
    clerkId: "user_admin",
    email: "admin@test.com",
    id: "admin-user-id",
    role: Role.ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: [
      "platform.support",
      "platform.ops",
      "platform.privacy",
      "platform.agent_admin",
    ],
    organizationId: orgId,
    organization: { id: orgId, name: "Test Org", slug: "test-org" },
  };

  const superAdminUser: CurrentUserData = {
    clerkId: "user_superadmin",
    email: "superadmin@test.com",
    id: "super-admin-user-id",
    role: Role.SUPER_ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ["platform.super_admin"],
    organizationId: null,
    organization: null,
  };

  const clientUser: CurrentUserData = {
    clerkId: "user_client",
    email: "client@test.com",
    id: "client-user-id",
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ["org.owner"],
    organizationId: orgId,
    organization: { id: orgId, name: "Test Org", slug: "test-org" },
  };

  const otherOrgClient: CurrentUserData = {
    clerkId: "user_other",
    email: "other@test.com",
    id: "other-user-id",
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ["org.owner"],
    organizationId: otherOrgId,
    organization: { id: otherOrgId, name: "Other Org", slug: "other-org" },
  };

  const customTheme: WidgetTheme = {
    ...defaultWidgetTheme,
    header: { ...defaultWidgetTheme.header, title: "Custom Title" },
  };

  /** Permissions the caller holds. Reset each test; narrowed where relevant. */
  const ALL_SECTIONS = [
    "AgentTheme:Update",
    "AgentTheme:UpdateBranding",
    "AgentTheme:UpdateConsent",
  ];
  let granted = new Set<string>(ALL_SECTIONS);

  beforeEach(async () => {
    granted = new Set<string>(ALL_SECTIONS);

    // Default: $transaction executes the callback with the mock prisma service itself
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        cb(mockPrismaService),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgentThemesService,
        {
          provide: PermissionCatalogService,
          // Reads the mutable set below, so a test can revoke branding to
          // exercise the withheld path.
          useValue: { resolvePermissions: () => granted },
        },
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: AgentLoggerService, useValue: mockAgentLogger },
      ],
    }).compile();

    service = module.get<AgentThemesService>(AgentThemesService);
    jest.clearAllMocks();

    // Re-apply $transaction default after clearAllMocks
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        cb(mockPrismaService),
    );
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("getTheme", () => {
    it("should return default theme with version 0 when no theme record exists (AC9)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, adminUser).then((result) => {
        expect(result).toEqual({ config: defaultWidgetTheme, version: 0 });
      });
    });

    it("should return existing theme when record exists (AC1)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: customTheme,
        version: 3,
      });

      return service.getTheme(agentId, adminUser).then((result) => {
        expect(result).toEqual({ config: customTheme, version: 3 });
      });
    });

    it("should throw NotFoundException when agent does not exist", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.getTheme(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it("should scope CLIENT users to their own org (AC7)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return service.getTheme(agentId, otherOrgClient).catch(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
            organizationId: otherOrgId,
          },
        });
      });
    });

    it("should not scope ADMIN users by org", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, adminUser).then(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
          },
        });
      });
    });

    it("should not scope SUPER_ADMIN users by org (AC7)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, superAdminUser).then(() => {
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
          },
        });
      });
    });
  });

  describe("updateTheme", () => {
    it("should create theme record if none exists via upsert (AC2, AC5)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: customTheme,
        version: 1,
      });

      return service
        .updateTheme(agentId, customTheme, adminUser)
        .then((result) => {
          expect(result).toEqual({ config: customTheme, version: 1 });
          expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              where: { agentId },
              create: expect.objectContaining({ agentId, version: 1 }),
              update: expect.objectContaining({ version: { increment: 1 } }),
            }),
          );
          expect(mockAgentLogger.logThemeUpdated).toHaveBeenCalledWith(
            agentId,
            adminUser.id,
          );
        });
    });

    it("should replace full config and increment version (AC2, AC5)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: customTheme,
        version: 4,
      });

      return service
        .updateTheme(agentId, customTheme, adminUser)
        .then((result) => {
          expect(result.version).toBe(4);
          expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              update: expect.objectContaining({ version: { increment: 1 } }),
            }),
          );
        });
    });

    it("should throw NotFoundException for non-existent agent", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(
        service.updateTheme(agentId, customTheme, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("patchTheme", () => {
    it("should deep merge partial config into existing theme within a transaction (AC3)", () => {
      const existingConfig = { ...defaultWidgetTheme };
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: existingConfig,
        version: 2,
      });

      const mergedConfig = {
        ...existingConfig,
        header: { ...existingConfig.header, title: "Patched Title" },
      };

      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: mergedConfig,
        version: 3,
      });

      return service
        .patchTheme(agentId, { header: { title: "Patched Title" } }, adminUser)
        .then((result) => {
          expect(result.version).toBe(3);
          expect(mockPrismaService.$transaction).toHaveBeenCalled();
          const upsertCall =
            mockPrismaService.agentTheme.upsert.mock.calls[0][0];
          const savedConfig = upsertCall.update.config as WidgetTheme;
          expect(savedConfig.header.title).toBe("Patched Title");
          expect(savedConfig.header.backgroundColor).toBe(
            defaultWidgetTheme.header.backgroundColor,
          );
        });
    });

    it("should merge into default theme when no record exists (AC3, AC9)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: {
          ...defaultWidgetTheme,
          header: { ...defaultWidgetTheme.header, title: "New" },
        },
        version: 1,
      });

      return service
        .patchTheme(agentId, { header: { title: "New" } }, adminUser)
        .then(() => {
          const upsertCall =
            mockPrismaService.agentTheme.upsert.mock.calls[0][0];
          const savedConfig = upsertCall.create.config as WidgetTheme;
          expect(savedConfig.header.title).toBe("New");
          expect(savedConfig.icon).toEqual(defaultWidgetTheme.icon);
        });
    });

    it("should increment version on patch (AC5)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: defaultWidgetTheme,
        version: 5,
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: defaultWidgetTheme,
        version: 6,
      });

      return service
        .patchTheme(agentId, { body: { backgroundColor: "#000" } }, adminUser)
        .then(() => {
          expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
            expect.objectContaining({
              update: expect.objectContaining({ version: { increment: 1 } }),
            }),
          );
        });
    });
  });

  /**
   * Branding is the "Powered by Klivo" footer. It shares the theme's single JSONB
   * column with appearance and chat interface, so no permission can separate
   * them — one endpoint writes the whole value. This is the field-level rule
   * that stands in for that, and the reason it must be tested at the service
   * rather than trusted to the editor hiding the section.
   */
  describe("branding is withheld without AgentTheme:UpdateBranding", () => {
    // The permission is what decides now, not the access scope.
    beforeEach(() => {
      granted.delete("AgentTheme:UpdateBranding");
    });

    const storedBranding = {
      enabled: true,
      text: "Powered by Klivo",
      logoUrl: null,
    };

    it("keeps the stored branding when the caller lacks the permission", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { ...customTheme, branding: storedBranding },
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: customTheme,
        version: 2,
      });

      await service.updateTheme(
        agentId,
        {
          ...customTheme,
          branding: { enabled: false, text: "Removed", logoUrl: null },
        } as never,
        clientUser,
      );

      const written = mockPrismaService.agentTheme.upsert.mock.calls[0][0];
      expect(written.update.config.branding).toEqual(storedBranding);
      expect(written.create.config.branding).toEqual(storedBranding);
    });

    it("lets a holder of the permission change branding", async () => {
      granted.add("AgentTheme:UpdateBranding");
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: customTheme,
        version: 2,
      });

      const newBranding = {
        enabled: false,
        text: "White label",
        logoUrl: null,
      };
      await service.updateTheme(
        agentId,
        { ...customTheme, branding: newBranding } as never,
        adminUser,
      );

      const written = mockPrismaService.agentTheme.upsert.mock.calls[0][0];
      expect(written.update.config.branding).toEqual(newBranding);
      // The one read is the consent-notice audit comparison, not a branding
      // read-back: the caller's own branding was written as sent.
      expect(mockPrismaService.agentTheme.findUnique).toHaveBeenCalledTimes(1);
    });

    it("ignores a branding patch from a caller without the permission", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { ...customTheme, branding: storedBranding },
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: customTheme,
        version: 2,
      });

      await service.patchTheme(
        agentId,
        { branding: { enabled: false } } as never,
        clientUser,
      );

      const written = mockPrismaService.agentTheme.upsert.mock.calls[0][0];
      expect(written.update.config.branding).toEqual(storedBranding);
    });
  });

  describe("consent notice", () => {
    const liveConsent = {
      ...defaultWidgetTheme.consent,
      enabled: true,
      privacyPolicyUrl: "https://acme.test/privacy",
    };

    beforeEach(() => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
    });

    it("refuses to turn the notice on without a privacy policy link (PUT)", async () => {
      await expect(
        service.updateTheme(
          agentId,
          { ...customTheme, consent: { ...liveConsent, privacyPolicyUrl: "" } },
          adminUser,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrismaService.agentTheme.upsert).not.toHaveBeenCalled();
    });

    it("judges a PATCH on the merged result: enabling alone fails when no link is stored", async () => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        agentId,
        config: defaultWidgetTheme,
        version: 1,
      });

      await expect(
        service.patchTheme(agentId, { consent: { enabled: true } }, adminUser),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(mockPrismaService.agentTheme.upsert).not.toHaveBeenCalled();
    });

    it("a partial consent PATCH keeps the stored wording (no field defaults leak in)", async () => {
      const stored = {
        ...customTheme,
        consent: { ...liveConsent, noticeText: "Our own lawyer text." },
      };
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        agentId,
        config: stored,
        version: 4,
      });
      mockPrismaService.agentTheme.upsert.mockImplementation(
        (args: { update: { config: unknown } }) =>
          Promise.resolve({ agentId, config: args.update.config, version: 5 }),
      );

      // Parse exactly as the controller's ZodValidationPipe does.
      const body = partialWidgetThemeSchema.parse({
        consent: { mode: "notice" },
      });
      await service.patchTheme(agentId, body, adminUser);

      const saved = mockPrismaService.agentTheme.upsert.mock.calls[0][0].update
        .config as WidgetTheme;
      expect(saved.consent.mode).toBe("notice");
      expect(saved.consent.noticeText).toBe("Our own lawyer text.");
      expect(saved.consent.privacyPolicyUrl).toBe("https://acme.test/privacy");
      expect(saved.consent.enabled).toBe(true);
    });

    it("audits a notice change with the before and after wording", async () => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: defaultWidgetTheme,
      });
      const saved = { ...customTheme, consent: liveConsent };
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: saved,
        version: 2,
      });

      await service.updateTheme(agentId, saved, adminUser);

      expect(mockAgentLogger.logConsentNoticeUpdated).toHaveBeenCalledWith(
        agentId,
        adminUser.id,
        expect.objectContaining({ enabled: false, privacyPolicyUrl: "" }),
        expect.objectContaining({
          enabled: true,
          privacyPolicyUrl: "https://acme.test/privacy",
          noticeText: liveConsent.noticeText,
          noticeHash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
        // The agent's org, not the actor's.
        mockAgent.organizationId,
      );
    });

    it("writes no notice audit when only other theme sections change", async () => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: defaultWidgetTheme,
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: customTheme,
        version: 2,
      });

      await service.updateTheme(agentId, customTheme, adminUser);

      expect(mockAgentLogger.logThemeUpdated).toHaveBeenCalled();
      expect(mockAgentLogger.logConsentNoticeUpdated).not.toHaveBeenCalled();
    });

    it("treats a stored theme without the consent key like the default (no spurious audit)", async () => {
      const { consent: _omit, ...legacy } = defaultWidgetTheme;
      void _omit;
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: legacy,
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: defaultWidgetTheme,
        version: 2,
      });

      await service.updateTheme(agentId, defaultWidgetTheme, adminUser);

      expect(mockAgentLogger.logConsentNoticeUpdated).not.toHaveBeenCalled();
    });

    describe("without AgentTheme:UpdateConsent", () => {
      const storedConsent = {
        ...liveConsent,
        noticeText: "Our own lawyer text.",
      };
      const stored = { ...customTheme, consent: storedConsent };

      beforeEach(() => {
        granted.delete("AgentTheme:UpdateConsent");
        mockPrismaService.agentTheme.findUnique.mockResolvedValue({
          agentId,
          config: stored,
          version: 4,
        });
        mockPrismaService.agentTheme.upsert.mockImplementation(
          (args: { update: { config: unknown } }) =>
            Promise.resolve({
              agentId,
              config: args.update.config,
              version: 5,
            }),
        );
      });

      it("PUT that changes the notice is refused with 403, not dropped silently", async () => {
        await expect(
          service.updateTheme(
            agentId,
            {
              ...customTheme,
              consent: { ...defaultWidgetTheme.consent, enabled: false },
            },
            adminUser,
          ),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockPrismaService.agentTheme.upsert).not.toHaveBeenCalled();
      });

      it("PUT that sends the stored notice back unchanged still saves the rest", async () => {
        await service.updateTheme(
          agentId,
          {
            ...customTheme,
            header: { ...customTheme.header, title: "New" },
            consent: storedConsent,
          },
          adminUser,
        );

        const saved = mockPrismaService.agentTheme.upsert.mock.calls[0][0]
          .update.config as WidgetTheme;
        expect(saved.header.title).toBe("New");
        expect(saved.consent).toEqual(storedConsent);
        expect(mockAgentLogger.logConsentNoticeUpdated).not.toHaveBeenCalled();
      });

      it("PATCH that changes the notice is refused with 403", async () => {
        const body = partialWidgetThemeSchema.parse({
          consent: { noticeText: "Hijacked" },
        });
        await expect(
          service.patchTheme(agentId, body, adminUser),
        ).rejects.toBeInstanceOf(ForbiddenException);
        expect(mockPrismaService.agentTheme.upsert).not.toHaveBeenCalled();
      });

      it("reset resets the theme but keeps the notice live", async () => {
        await service.resetTheme(agentId, adminUser);

        const saved = mockPrismaService.agentTheme.upsert.mock.calls[0][0]
          .update.config as WidgetTheme;
        expect(saved.header.title).toBe(defaultWidgetTheme.header.title);
        expect(saved.consent).toEqual(storedConsent);
        expect(mockAgentLogger.logConsentNoticeUpdated).not.toHaveBeenCalled();
      });

      it("a legacy stored theme without the consent key equals the editor defaults", async () => {
        const { consent: _omit, ...legacy } = customTheme;
        void _omit;
        mockPrismaService.agentTheme.findUnique.mockResolvedValue({
          agentId,
          config: legacy,
          version: 4,
        });

        await expect(
          service.updateTheme(agentId, customTheme, adminUser),
        ).resolves.toBeDefined();
      });
    });

    it("audits a reset that turns a live notice off", async () => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { ...customTheme, consent: liveConsent },
      });
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        agentId,
        config: defaultWidgetTheme,
        version: 3,
      });

      await service.resetTheme(agentId, adminUser);

      expect(mockAgentLogger.logConsentNoticeUpdated).toHaveBeenCalledWith(
        agentId,
        adminUser.id,
        expect.objectContaining({ enabled: true }),
        expect.objectContaining({ enabled: false }),
        mockAgent.organizationId,
      );
    });
  });

  describe("resetTheme", () => {
    it("should set config to defaults and increment version (AC4, AC5)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.upsert.mockResolvedValue({
        id: "theme-id",
        agentId,
        config: defaultWidgetTheme,
        version: 4,
      });

      return service.resetTheme(agentId, adminUser).then((result) => {
        expect(result.config).toEqual(defaultWidgetTheme);
        expect(result.version).toBe(4);
        expect(mockPrismaService.agentTheme.upsert).toHaveBeenCalledWith(
          expect.objectContaining({
            where: { agentId },
            create: expect.objectContaining({ agentId, version: 1 }),
            update: expect.objectContaining({ version: { increment: 1 } }),
          }),
        );
        expect(mockAgentLogger.logThemeReset).toHaveBeenCalledWith(
          agentId,
          adminUser.id,
        );
      });
    });

    it("should throw NotFoundException for non-existent agent", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.resetTheme(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("ensureAgentAccess (via CLIENT scoping)", () => {
    it("should allow CLIENT to access own org agent (AC7)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);

      return service.getTheme(agentId, clientUser).then((result) => {
        expect(result).toBeDefined();
        expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
          where: {
            id: agentId,
            deletedAt: null,
            organizationId: orgId,
          },
        });
      });
    });

    it("should reject CLIENT accessing another org agent (AC7)", () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      return expect(service.getTheme(agentId, otherOrgClient)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe("validation (AC8)", () => {
    it("should reject invalid config via ZodValidationPipe on PUT", () => {
      const pipe = new ZodValidationPipe(widgetThemeSchema);
      const invalidConfig = { header: { title: "only header" } };

      expect(() => pipe.transform(invalidConfig)).toThrow(BadRequestException);
    });
  });
});
