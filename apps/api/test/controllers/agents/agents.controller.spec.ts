import { Test, TestingModule } from "@nestjs/testing";
import { BadRequestException, NotFoundException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AgentsController } from "../../../src/controllers/agents/agents.controller";
import { AgentsService } from "../../../src/services/agents.service";
import { AgentThemesService } from "../../../src/services/agent-themes.service";
import { AgentKnowledgeService } from "../../../src/services/agent-knowledge.service";
import { AgentDataFieldsService } from "../../../src/services/agent-data-fields.service";
import { PermissionGuard } from "../../../src/guards/permission.guard";
import { PermissionCatalogService } from "../../../src/common/rbac/permission-catalog.service";
import { ZodValidationPipe } from "../../../src/pipes/zod-validation.pipe";
import {
  createAgentSchema,
  updateAgentSchema,
  agentListQuerySchema,
} from "../../../src/models/agent.dto";
import type { CurrentUserData } from "../../../src/decorators/current-user.decorator";
import { Role, AccessScope } from "@prisma/client";

describe("AgentsController", () => {
  let controller: AgentsController;

  const mockAgentsService = {
    create: jest.fn(),
    findAll: jest.fn(),
    findById: jest.fn(),
    update: jest.fn(),
    softDelete: jest.fn(),
  };

  const mockThemesService = { getTheme: jest.fn() };
  const mockKnowledgeService = { get: jest.fn() };
  const mockDataFieldsService = { list: jest.fn() };

  /**
   * Just the slice of the real catalog these tests depend on. Mirrors the
   * seeded grants: the two agent sub-resources below are separately grantable
   * editor sections, so `getEditorConfig` must gate them PER PERMISSION rather
   * than on any single role. Keys absent here resolve to no permissions, which
   * is the same fail-closed direction the real catalog takes for unknown roles.
   */
  const CATALOG: Record<string, string[]> = {
    "platform.agent_admin": [
      "AgentSecret:Read",
      "AgentSecret:Update",
      "AgentDataField:Read",
      "AgentDataField:Update",
    ],
    "org.agent_integrations": ["AgentSecret:Read", "AgentSecret:Update"],
    "org.agent_data_capture": ["AgentDataField:Read", "AgentDataField:Update"],
  };

  const mockCatalog = {
    resolvePermissions: jest.fn(
      (roleKeys: string[]) =>
        new Set(roleKeys.flatMap((k) => CATALOG[k] ?? [])),
    ),
  };

  const orgId = "123e4567-e89b-12d3-a456-426614174000";
  const agentId = "333e4567-e89b-12d3-a456-426614174000";

  const mockAgent = {
    id: agentId,
    publicId: "AbCd1234",
    name: "Test Agent",
    status: "ACTIVE",
    organizationId: orgId,
    allowedDomains: [],
    systemPrompt: null,
    welcomeMessage: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
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

  const mockPaginatedResponse = {
    data: [mockAgent],
    meta: { page: 1, limit: 20, total: 1, totalPages: 1 },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [AgentsController],
      providers: [
        { provide: AgentsService, useValue: mockAgentsService },
        // Co-resident services on AgentsController — mocked stubs so the
        // controller can resolve. The tests in this file don't exercise
        // them, so trivial empty mocks suffice.
        { provide: AgentThemesService, useValue: mockThemesService },
        { provide: AgentKnowledgeService, useValue: mockKnowledgeService },
        { provide: AgentDataFieldsService, useValue: mockDataFieldsService },
        { provide: PermissionCatalogService, useValue: mockCatalog },
        Reflector,
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<AgentsController>(AgentsController);
    jest.clearAllMocks();
    // clearAllMocks wipes the implementation too, so restore the catalog stub.
    mockCatalog.resolvePermissions.mockImplementation(
      (roleKeys: string[]) =>
        new Set(roleKeys.flatMap((k) => CATALOG[k] ?? [])),
    );
  });

  it("should be defined", () => {
    expect(controller).toBeDefined();
  });

  describe("create", () => {
    it("should create an agent", async () => {
      const dto = { name: "Test Agent", organizationId: orgId };
      mockAgentsService.create.mockResolvedValue(mockAgent);

      const result = await controller.create(dto, adminUser);

      expect(result).toEqual(mockAgent);
      expect(mockAgentsService.create).toHaveBeenCalledWith(dto, adminUser);
    });
  });

  describe("findAll", () => {
    const defaultQuery = {
      page: 1,
      limit: 20,
      sortBy: "createdAt" as const,
      sortOrder: "desc" as const,
    };

    it("should return paginated agents", async () => {
      mockAgentsService.findAll.mockResolvedValue(mockPaginatedResponse);

      const result = await controller.findAll(defaultQuery, adminUser);

      expect(result).toEqual(mockPaginatedResponse);
      expect(mockAgentsService.findAll).toHaveBeenCalledWith(
        defaultQuery,
        adminUser,
      );
    });

    it("should pass search and filter params to service", async () => {
      const query = {
        ...defaultQuery,
        search: "test",
        status: "ACTIVE" as const,
      };
      mockAgentsService.findAll.mockResolvedValue(mockPaginatedResponse);

      await controller.findAll(query, adminUser);

      expect(mockAgentsService.findAll).toHaveBeenCalledWith(query, adminUser);
    });
  });

  describe("findById", () => {
    it("should return an agent by id", async () => {
      mockAgentsService.findById.mockResolvedValue(mockAgent);

      const result = await controller.findById(agentId, adminUser);

      expect(result).toEqual(mockAgent);
      expect(mockAgentsService.findById).toHaveBeenCalledWith(
        agentId,
        adminUser,
      );
    });

    it("should propagate NotFoundException", async () => {
      mockAgentsService.findById.mockRejectedValue(
        new NotFoundException("Agent not found"),
      );

      await expect(
        controller.findById("nonexistent", adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("getEditorConfig", () => {
    const theme = { config: { primaryColor: "#000" }, version: 1 };
    const knowledge = { id: "k1", content: "kb" };
    const dataFields = [{ id: "df1", key: "email", order: 0 }];

    beforeEach(() => {
      mockAgentsService.findById.mockResolvedValue(mockAgent);
      mockThemesService.getTheme.mockResolvedValue(theme);
      mockKnowledgeService.get.mockResolvedValue(knowledge);
      mockDataFieldsService.list.mockResolvedValue(dataFields);
    });

    it("returns the FULL bundle for an admin (incl. dataFields), with no n8n webhook field", async () => {
      const result = await controller.getEditorConfig(agentId, adminUser);

      expect(result.agent).toEqual(mockAgent);
      expect(result.theme).toEqual(theme);
      expect(result.knowledge).toEqual(knowledge);
      expect(result.dataFields).toEqual(dataFields);
      expect(result).not.toHaveProperty("webhookUrl");
      expect(mockDataFieldsService.list).toHaveBeenCalled();
    });

    it("STRIPS the gated data-fields section from a user without the permission, and never fetches it", async () => {
      const result = await controller.getEditorConfig(agentId, clientUser);

      // Ungated sections still hydrate…
      expect(result.agent).toEqual(mockAgent);
      expect(result.theme).toEqual(theme);
      expect(result.knowledge).toEqual(knowledge);
      // …but the gated field is stripped, and its service is not even called.
      expect(result.dataFields).toEqual([]);
      expect(mockDataFieldsService.list).not.toHaveBeenCalled();
    });

    /**
     * The bug this gating replaced: the two sections were hidden behind the
     * legacy role tier, so an ORG user granted `org.agent_data_capture` opened
     * the Data Capture tab and got an empty list. They are separately grantable
     * roles, so each section must follow its OWN permission.
     */
    it("returns dataFields for an ORG user holding only the data-capture role", async () => {
      const dataCaptureUser: CurrentUserData = {
        ...clientUser,
        roleKeys: ["org.agent_data_capture"],
      };

      const result = await controller.getEditorConfig(agentId, dataCaptureUser);

      expect(result.dataFields).toEqual(dataFields);
      expect(mockDataFieldsService.list).toHaveBeenCalled();
    });

    it("propagates the tenant-scoped 404 from findById (foreign agent)", async () => {
      mockAgentsService.findById.mockRejectedValue(
        new NotFoundException("Agent not found"),
      );

      await expect(
        controller.getEditorConfig(
          "444e4567-e89b-12d3-a456-426614174000",
          clientUser,
        ),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe("update", () => {
    it("should update an agent", async () => {
      const dto = { name: "Updated Agent" };
      const updated = { ...mockAgent, name: "Updated Agent" };
      mockAgentsService.update.mockResolvedValue(updated);

      const result = await controller.update(agentId, dto, adminUser);

      expect(result.name).toBe("Updated Agent");
      expect(mockAgentsService.update).toHaveBeenCalledWith(
        agentId,
        dto,
        adminUser,
      );
    });
  });

  describe("remove", () => {
    it("should soft-delete an agent and return void", async () => {
      mockAgentsService.softDelete.mockResolvedValue({
        ...mockAgent,
        deletedAt: new Date(),
      });

      const result = await controller.remove(agentId, adminUser);

      expect(result).toBeUndefined();
      expect(mockAgentsService.softDelete).toHaveBeenCalledWith(
        agentId,
        adminUser,
      );
    });

    it("should have HttpCode 204 decorator", () => {
      const httpCode = Reflect.getMetadata(
        "__httpCode__",
        AgentsController.prototype.remove,
      );
      expect(httpCode).toBe(204);
    });
  });

  describe("role authorization", () => {
    it("should have @RequirePermission(Agent, Create) on create", () => {
      const permission = Reflect.getMetadata(
        "permission",
        AgentsController.prototype.create,
      );
      expect(permission).toEqual({ resource: "Agent", action: "Create" });
    });

    it("declares a permission on findAll", () => {
      const permission = Reflect.getMetadata(
        "permission",
        AgentsController.prototype.findAll,
      );
      expect(permission).toEqual({ resource: "Agent", action: "Read" });
    });

    it("declares a permission on findById", () => {
      const permission = Reflect.getMetadata(
        "permission",
        AgentsController.prototype.findById,
      );
      expect(permission).toEqual({ resource: "Agent", action: "Read" });
    });

    it("declares a permission on update", () => {
      const permission = Reflect.getMetadata(
        "permission",
        AgentsController.prototype.update,
      );
      expect(permission).toEqual({ resource: "Agent", action: "Update" });
    });

    it("declares a permission on remove", () => {
      const permission = Reflect.getMetadata(
        "permission",
        AgentsController.prototype.remove,
      );
      expect(permission).toEqual({ resource: "Agent", action: "Delete" });
    });

    // n8n is retired (ADR-0014): the webhook endpoints are gone, not just gated.
    it("no longer exposes the n8n webhook endpoints", () => {
      for (const route of ["setWebhook", "getWebhook", "testWebhook"]) {
        expect(AgentsController.prototype).not.toHaveProperty(route);
      }
    });
  });

  describe("validation", () => {
    const createPipe = new ZodValidationPipe(createAgentSchema);
    const updatePipe = new ZodValidationPipe(updateAgentSchema);
    const listQueryPipe = new ZodValidationPipe(agentListQuerySchema);

    it("should reject create with missing name", () => {
      expect(() => createPipe.transform({ organizationId: orgId })).toThrow(
        BadRequestException,
      );
    });

    it("should reject create with missing organizationId", () => {
      expect(() => createPipe.transform({ name: "Test" })).toThrow(
        BadRequestException,
      );
    });

    it("should reject create with invalid organizationId", () => {
      expect(() =>
        createPipe.transform({ name: "Test", organizationId: "not-uuid" }),
      ).toThrow(BadRequestException);
    });

    it("should reject create with name too short", () => {
      expect(() =>
        createPipe.transform({ name: "A", organizationId: orgId }),
      ).toThrow(BadRequestException);
    });

    it("should reject create with name too long", () => {
      expect(() =>
        createPipe.transform({ name: "A".repeat(101), organizationId: orgId }),
      ).toThrow(BadRequestException);
    });

    it("should accept valid create input", () => {
      const result = createPipe.transform({
        name: "Test Agent",
        organizationId: orgId,
      });
      expect(result.name).toBe("Test Agent");
      expect(result.organizationId).toBe(orgId);
    });

    it("should reject update with empty body", () => {
      expect(() => updatePipe.transform({})).toThrow(BadRequestException);
    });

    it("should accept update with name", () => {
      const result = updatePipe.transform({ name: "New Name" });
      expect(result.name).toBe("New Name");
    });

    it("should apply defaults for list query", () => {
      const result = listQueryPipe.transform({});
      expect(result.page).toBe(1);
      expect(result.limit).toBe(20);
      expect(result.sortBy).toBe("createdAt");
      expect(result.sortOrder).toBe("desc");
    });

    it("should accept list query with status filter", () => {
      const result = listQueryPipe.transform({ status: "ACTIVE" });
      expect(result.status).toBe("ACTIVE");
    });

    it("should reject invalid status value", () => {
      expect(() => listQueryPipe.transform({ status: "INVALID" })).toThrow(
        BadRequestException,
      );
    });

    it("should accept list query with organizationId filter", () => {
      const result = listQueryPipe.transform({ organizationId: orgId });
      expect(result.organizationId).toBe(orgId);
    });

    it("should reject invalid sortBy value", () => {
      expect(() => listQueryPipe.transform({ sortBy: "invalid" })).toThrow(
        BadRequestException,
      );
    });

    it("should coerce page and limit to numbers", () => {
      const result = listQueryPipe.transform({ page: "2", limit: "10" });
      expect(result.page).toBe(2);
      expect(result.limit).toBe(10);
    });

    // --- Status validation (Story 3-7) ---
    it("should accept update with status ACTIVE", () => {
      const result = updatePipe.transform({ status: "ACTIVE" });
      expect(result.status).toBe("ACTIVE");
    });

    it("should accept update with status INACTIVE", () => {
      const result = updatePipe.transform({ status: "INACTIVE" });
      expect(result.status).toBe("INACTIVE");
    });

    it("should reject update with invalid status value", () => {
      expect(() => updatePipe.transform({ status: "PAUSED" })).toThrow(
        BadRequestException,
      );
    });

    // --- Domain allowlist validation (Story 3-4) ---
    it("should accept update with allowedDomains array", () => {
      const result = updatePipe.transform({
        allowedDomains: ["example.com", "test.org"],
      });
      expect(result.allowedDomains).toEqual(["example.com", "test.org"]);
    });

    it("should accept update with empty allowedDomains (no restriction)", () => {
      const result = updatePipe.transform({ allowedDomains: [] });
      expect(result.allowedDomains).toEqual([]);
    });

    it("should normalize domains in allowedDomains (lowercase, strip protocol)", () => {
      const result = updatePipe.transform({
        allowedDomains: ["https://Example.COM/path"],
      });
      expect(result.allowedDomains).toEqual(["example.com"]);
    });

    it("should reject allowedDomains exceeding 50 entries", () => {
      const domains = Array.from({ length: 51 }, (_, i) => `domain${i}.com`);
      expect(() => updatePipe.transform({ allowedDomains: domains })).toThrow(
        BadRequestException,
      );
    });

    it("should accept allowedDomains at the 50 entry limit", () => {
      const domains = Array.from({ length: 50 }, (_, i) => `domain${i}.com`);
      const result = updatePipe.transform({ allowedDomains: domains });
      expect(result.allowedDomains).toHaveLength(50);
    });

    it("should accept update with both name and status", () => {
      const result = updatePipe.transform({
        name: "Updated",
        status: "INACTIVE",
      });
      expect(result.name).toBe("Updated");
      expect(result.status).toBe("INACTIVE");
    });

    it("should accept update with name, status, and allowedDomains together", () => {
      const result = updatePipe.transform({
        name: "Updated",
        status: "ACTIVE",
        allowedDomains: ["example.com"],
      });
      expect(result.name).toBe("Updated");
      expect(result.status).toBe("ACTIVE");
      expect(result.allowedDomains).toEqual(["example.com"]);
    });
  });
});
