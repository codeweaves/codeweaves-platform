import { Test, TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { Role, AccessScope } from "@prisma/client";
import { FilesService } from "../../../src/services/files.service";
import { PrismaService } from "../../../src/services/prisma.service";
import { ObjectStorageService } from "../../../src/services/object-storage.service";
import { TracerService } from "../../../src/common/tracer/tracer.service";
import { InternalEventLogger } from "../../../src/common/events/internal.logger";
import type { CurrentUserData } from "../../../src/decorators/current-user.decorator";

describe("FilesService", () => {
  let service: FilesService;

  const mockPrismaService = {
    agent: { findFirst: jest.fn() },
    agentTheme: { findUnique: jest.fn() },
    file: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      delete: jest.fn(),
      deleteMany: jest.fn(),
      updateMany: jest.fn(),
    },
    $queryRaw: jest.fn(),
    $transaction: jest.fn(),
  };

  const mockStorageService = {
    upload: jest.fn(),
    remove: jest.fn(),
    bucket: "klivo-assets",
    publicBase: "https://cdn.example.com",
  };

  const mockTracer = { logAuditEvent: jest.fn() };
  const mockInternalLog = { logCompleted: jest.fn(), logFailed: jest.fn() };

  const orgId = "123e4567-e89b-12d3-a456-426614174000";
  const agentId = "333e4567-e89b-12d3-a456-426614174000";
  const themeId = "444e4567-e89b-12d3-a456-426614174000";
  const fileId = "555e4567-e89b-12d3-a456-426614174000";

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

  const mockFile: Express.Multer.File = {
    fieldname: "file",
    originalname: "test-image.png",
    encoding: "7bit",
    mimetype: "image/png",
    // Valid PNG magic bytes so content-sniffing (detectImageMime) accepts it —
    // the service no longer trusts the declared mimetype.
    buffer: Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52,
    ]),
    size: 1024,
    stream: null as unknown as import("stream").Readable,
    destination: "",
    filename: "",
    path: "",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FilesService,
        { provide: PrismaService, useValue: mockPrismaService },
        { provide: ObjectStorageService, useValue: mockStorageService },
        { provide: TracerService, useValue: mockTracer },
        { provide: InternalEventLogger, useValue: mockInternalLog },
      ],
    }).compile();

    service = module.get<FilesService>(FilesService);
    jest.clearAllMocks();
    // Default: no earlier file in the slot being uploaded to.
    mockPrismaService.file.findMany.mockResolvedValue([]);
    // Storage deletes succeed unless a test says otherwise.
    mockStorageService.remove.mockImplementation(
      async (_bucket: string, keys: string[]) => ({
        removed: keys,
        failed: [],
      }),
    );
    // Interactive transactions run against the same mock.
    mockPrismaService.$transaction.mockImplementation(
      (cb: (tx: typeof mockPrismaService) => Promise<unknown>) =>
        cb(mockPrismaService),
    );
  });

  /** Route $queryRaw by the SQL it runs: the agent lock, or a cleanup batch. */
  function routeRawQueries(batches: { id: string; agentId: string }[][] = []) {
    const queue = [...batches];
    mockPrismaService.$queryRaw.mockImplementation(
      async (strings: TemplateStringsArray) => {
        const sql = strings.join("?");
        if (sql.includes("FOR NO KEY UPDATE")) return [];
        if (sql.includes("WITH used")) return queue.shift() ?? [];
        throw new Error(`unexpected query: ${sql}`);
      },
    );
  }

  /** SQL text of every $queryRaw call that matches. */
  const rawCalls = (needle: string) =>
    mockPrismaService.$queryRaw.mock.calls.filter((c) =>
      (c[0] as TemplateStringsArray).join("?").includes(needle),
    );

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  describe("uploadAgentAsset", () => {
    it("should upload file and create record", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: themeId,
      });
      mockStorageService.upload.mockResolvedValue(
        "https://storage.example.com/file.png",
      );
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: "https://storage.example.com/file.png",
        fileName: "test-image.png",
        purpose: "header-logo",
      });

      const result = await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: "header-logo",
        user: adminUser,
      });

      expect(result).toEqual({
        id: fileId,
        publicUrl: "https://storage.example.com/file.png",
        fileName: "test-image.png",
        purpose: "header-logo",
      });
      expect(mockStorageService.upload).toHaveBeenCalledWith(
        expect.stringMatching(
          new RegExp(
            `^agent-assets/${orgId}/${agentId}/header-logo/\\d+-test-image\\.png$`,
          ),
        ),
        mockFile.buffer,
        "image/png",
      );
      expect(mockPrismaService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          fileName: "test-image.png",
          mimeType: "image/png",
          sizeBytes: 1024,
          entityType: "agent-theme",
          entityId: themeId,
          purpose: "header-logo",
          organizationId: orgId,
          uploadedById: adminUser.id,
          bucket: "klivo-assets",
          publicUrl: "https://storage.example.com/file.png",
        }),
      });
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        "AGENT_FILE_UPLOADED",
        expect.anything(),
        { organizationId: orgId, agentId },
      );
    });

    it("does not delete the previous file on upload (the saved theme still shows it)", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: themeId,
      });
      mockStorageService.upload.mockResolvedValue(
        "https://storage.example.com/new-file.png",
      );
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: "https://storage.example.com/new-file.png",
        fileName: "test-image.png",
        purpose: "header-logo",
      });

      await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: "header-logo",
        user: adminUser,
      });

      expect(mockStorageService.remove).not.toHaveBeenCalled();
      expect(mockPrismaService.file.findMany).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
    });

    it("records nothing when the storage upload fails", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: themeId,
      });
      mockStorageService.upload.mockRejectedValue(
        new Error("Storage upload failed: timeout"),
      );

      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: "header-logo",
          user: adminUser,
        }),
      ).rejects.toThrow("Storage upload failed: timeout");

      expect(mockPrismaService.file.create).not.toHaveBeenCalled();
      expect(mockStorageService.remove).not.toHaveBeenCalled();
    });

    it("should reject invalid purpose", async () => {
      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: "invalid-purpose",
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject file exceeding 2MB", async () => {
      const largeFile = { ...mockFile, size: 3 * 1024 * 1024 };

      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.uploadAgentAsset(largeFile as Express.Multer.File, {
          agentId,
          purpose: "header-logo",
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject unsupported mime type", async () => {
      // Real PDF magic bytes ("%PDF-1.") — content sniffing, not the declared
      // mimetype, is what the service now trusts, so the fixture must carry
      // genuinely non-image bytes to exercise rejection.
      const pdfFile = {
        ...mockFile,
        mimetype: "application/pdf",
        buffer: Buffer.from([
          0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0x25, 0x00,
          0x00,
        ]),
      };

      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);

      await expect(
        service.uploadAgentAsset(pdfFile as Express.Multer.File, {
          agentId,
          purpose: "header-logo",
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should reject when no file is provided", async () => {
      await expect(
        service.uploadAgentAsset(undefined as unknown as Express.Multer.File, {
          agentId,
          purpose: "header-logo",
          user: adminUser,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it("should throw NotFoundException when agent does not exist", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: "header-logo",
          user: adminUser,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it("should scope CLIENT users to their org", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.uploadAgentAsset(mockFile, {
          agentId,
          purpose: "header-logo",
          user: clientUser,
        }),
      ).rejects.toThrow(NotFoundException);

      expect(mockPrismaService.agent.findFirst).toHaveBeenCalledWith({
        where: {
          id: agentId,
          deletedAt: null,
          organizationId: orgId,
        },
      });
    });

    it("should use agentId as entityId when no theme exists", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockStorageService.upload.mockResolvedValue(
        "https://storage.example.com/file.png",
      );
      mockPrismaService.file.create.mockResolvedValue({
        id: fileId,
        publicUrl: "https://storage.example.com/file.png",
        fileName: "test-image.png",
        purpose: "header-logo",
      });

      await service.uploadAgentAsset(mockFile, {
        agentId,
        purpose: "header-logo",
        user: adminUser,
      });

      expect(mockPrismaService.file.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          entityId: agentId,
        }),
      });
    });
  });

  describe("deleteFile", () => {
    it("refuses a file in a bucket the current storage cannot reach", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findFirst.mockResolvedValue({
        id: fileId,
        bucket: "agent_assets",
        storageKey: "path/to/file.png",
      });

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(ConflictException);
      expect(mockStorageService.remove).not.toHaveBeenCalled();
    });

    it("refuses to delete a file the saved theme still shows", async () => {
      const url = "https://cdn.example.com/agent-assets/live.png";
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findFirst.mockResolvedValue({
        id: fileId,
        bucket: "klivo-assets",
        storageKey: "agent-assets/live.png",
      });
      mockPrismaService.file.findMany.mockResolvedValue([
        {
          id: fileId,
          bucket: "klivo-assets",
          storageKey: "agent-assets/live.png",
          publicUrl: url,
        },
      ]);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { header: { logoUrl: url } },
      });
      mockPrismaService.file.findUnique.mockResolvedValue({ id: fileId });
      routeRawQueries();

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(mockStorageService.remove).not.toHaveBeenCalled();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
    });

    const storedFile = {
      id: fileId,
      bucket: "klivo-assets",
      storageKey: "path/to/file.png",
      publicUrl: "https://cdn.example.com/path/to/file.png",
    };
    const unusedFileSetup = () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findFirst.mockResolvedValue(storedFile);
      mockPrismaService.file.findMany.mockResolvedValue([storedFile]);
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        config: { header: {} },
      });
      mockPrismaService.file.deleteMany.mockResolvedValue({ count: 1 });
      routeRawQueries();
    };

    it("should delete an unused file from storage, then its row, under the agent lock", async () => {
      unusedFileSetup();

      await service.deleteFile(fileId, agentId, adminUser);

      expect(rawCalls("FOR NO KEY UPDATE")[0]?.[1]).toBe(agentId);
      expect(mockStorageService.remove).toHaveBeenCalledWith(
        "klivo-assets",
        ["path/to/file.png"],
        "DASHBOARD",
      );
      expect(mockPrismaService.file.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: [fileId] } },
      });
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        "AGENT_FILE_DELETED",
        expect.anything(),
        { organizationId: orgId, agentId },
      );
    });

    it("should scope the file lookup to the verified agent org (cross-tenant IDOR guard)", async () => {
      unusedFileSetup();

      await service.deleteFile(fileId, agentId, clientUser);

      // The file must be looked up by BOTH id AND the caller's org — never by
      // id alone (which would let a client delete another tenant's file).
      expect(mockPrismaService.file.findFirst).toHaveBeenCalledWith({
        where: { id: fileId, organizationId: orgId },
      });
    });

    it("should NOT delete a file belonging to another org", async () => {
      // Caller owns an agent in their org (access check passes)…
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      // …but the fileId belongs to a different org, so the org-scoped lookup
      // returns nothing.
      mockPrismaService.file.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteFile(fileId, agentId, clientUser),
      ).rejects.toThrow(NotFoundException);

      // Crucially, no destructive side-effects ran on the foreign file.
      expect(mockStorageService.remove).not.toHaveBeenCalled();
      expect(mockPrismaService.file.delete).not.toHaveBeenCalled();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
      expect(mockPrismaService.$transaction).not.toHaveBeenCalled();
    });

    it("should throw NotFoundException when file does not exist", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(mockAgent);
      mockPrismaService.file.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });

    it("should throw NotFoundException when agent does not exist", async () => {
      mockPrismaService.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.deleteFile(fileId, agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });
  describe("assertNewUploadsExist", () => {
    const tx = mockPrismaService as never;
    const upload =
      "https://cdn.example.com/agent-assets/o/a/header-logo/2-new.png";
    const check = (previousConfig: unknown, newConfig: unknown) =>
      service.assertNewUploadsExist(tx, {
        agentId,
        organizationId: orgId,
        previousConfig,
        newConfig,
      });

    beforeEach(() => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue({
        id: themeId,
      });
    });

    it("accepts a new upload this agent owns", async () => {
      mockPrismaService.file.findMany.mockResolvedValue([
        { publicUrl: upload },
      ]);

      await expect(
        check({}, { header: { logoUrl: upload } }),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.file.findMany).toHaveBeenCalledWith({
        where: {
          organizationId: orgId,
          entityType: "agent-theme",
          entityId: { in: [themeId, agentId] },
          publicUrl: { in: [upload] },
        },
        select: { publicUrl: true },
      });
    });

    it("refuses a new upload with no file record (deleted by the cleanup, or another agent's)", async () => {
      mockPrismaService.file.findMany.mockResolvedValue([]);

      await expect(check({}, { header: { logoUrl: upload } })).rejects.toThrow(
        BadRequestException,
      );
    });

    it("never blocks a reference the theme already had", async () => {
      await expect(
        check({ header: { logoUrl: upload } }, { header: { logoUrl: upload } }),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.file.findMany).not.toHaveBeenCalled();
    });

    it("ignores URLs that are not ours (external images)", async () => {
      await expect(
        check({}, { header: { logoUrl: "https://example.org/logo.png" } }),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.file.findMany).not.toHaveBeenCalled();
    });
  });

  describe("removeFilesDroppedFromTheme", () => {
    const oldUrl =
      "https://cdn.example.com/agent-assets/o/a/header-logo/1-old.png";
    const newUrl =
      "https://cdn.example.com/agent-assets/o/a/header-logo/2-new.png";
    const oldRow = {
      id: "old-file-id",
      bucket: "klivo-assets",
      storageKey: "agent-assets/o/a/header-logo/1-old.png",
      publicUrl: oldUrl,
      entityId: themeId,
      fileName: "old.png",
      purpose: "header-logo",
    };
    let storedConfig: unknown;
    const run = (previousConfig: unknown, newConfig: unknown) =>
      service.removeFilesDroppedFromTheme({
        agentId,
        organizationId: orgId,
        previousConfig,
        newConfig,
        userId: adminUser.id,
      });

    beforeEach(() => {
      storedConfig = { header: { logoUrl: newUrl } };
      // The theme-id lookup selects id; the locked re-check selects config.
      mockPrismaService.agentTheme.findUnique.mockImplementation(
        async ({ select }: { select: { config?: boolean } }) =>
          select.config ? { config: storedConfig } : { id: themeId },
      );
      // First findMany: candidate ids. Second: full rows inside the lock.
      mockPrismaService.file.findMany
        .mockResolvedValueOnce([{ id: oldRow.id }])
        .mockResolvedValueOnce([oldRow]);
      mockPrismaService.file.deleteMany.mockResolvedValue({ count: 1 });
      routeRawQueries();
    });

    it("under the agent lock: deletes the object, then the row, and audits it", async () => {
      await run(
        { header: { logoUrl: oldUrl, title: "Chat" } },
        { header: { logoUrl: newUrl, title: "Chat" } },
      );

      // Only URLs the save dropped are candidates, scoped to this org/agent.
      expect(mockPrismaService.file.findMany).toHaveBeenNthCalledWith(1, {
        where: {
          organizationId: orgId,
          entityType: "agent-theme",
          entityId: { in: [themeId, agentId] },
          publicUrl: { in: [oldUrl] },
        },
        select: { id: true },
      });
      expect(rawCalls("FOR NO KEY UPDATE")[0]?.[1]).toBe(agentId);
      expect(mockStorageService.remove).toHaveBeenCalledWith(
        "klivo-assets",
        [oldRow.storageKey],
        "DASHBOARD",
      );
      expect(mockPrismaService.file.deleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["old-file-id"] } },
      });
      // Object first, row after: a crash in between leaves a row, never an
      // object nothing tracks.
      expect(
        mockStorageService.remove.mock.invocationCallOrder[0],
      ).toBeLessThan(
        mockPrismaService.file.deleteMany.mock.invocationCallOrder[0]!,
      );
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        "AGENT_FILE_DELETED",
        {
          response: expect.objectContaining({
            fileId: "old-file-id",
            userId: adminUser.id,
            reason: "removed_from_theme",
          }),
        },
        { organizationId: orgId, agentId },
      );
    });

    it("does nothing when the save dropped no value", async () => {
      mockPrismaService.file.findMany.mockReset();
      await run(
        { header: { logoUrl: oldUrl } },
        { header: { logoUrl: oldUrl } },
      );

      expect(mockPrismaService.file.findMany).not.toHaveBeenCalled();
      expect(mockStorageService.remove).not.toHaveBeenCalled();
    });

    it("does nothing on the first save (no previous theme)", async () => {
      mockPrismaService.file.findMany.mockReset();
      await run(undefined, { header: { logoUrl: newUrl } });

      expect(mockPrismaService.file.findMany).not.toHaveBeenCalled();
      expect(mockStorageService.remove).not.toHaveBeenCalled();
    });

    it("keeps a file a later save put back (re-checked under the lock)", async () => {
      storedConfig = { header: { logoUrl: oldUrl } };

      await run({ header: { logoUrl: oldUrl } }, { header: {} });

      expect(mockStorageService.remove).not.toHaveBeenCalled();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
    });

    it("finds files uploaded before the theme existed (recorded against the agent id)", async () => {
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockPrismaService.file.findMany.mockReset();
      mockPrismaService.file.findMany.mockResolvedValue([]);

      await run({ header: { logoUrl: oldUrl } }, {});

      expect(mockPrismaService.file.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ entityId: { in: [agentId] } }),
        }),
      );
    });

    it("keeps the row (to the back of the queue) when storage could not delete the object", async () => {
      mockStorageService.remove.mockResolvedValue({
        removed: [],
        failed: [oldRow.storageKey],
      });

      await run(
        { header: { logoUrl: oldUrl } },
        { header: { logoUrl: newUrl } },
      );

      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
      expect(mockPrismaService.file.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["old-file-id"] } },
        data: { updatedAt: expect.any(Date) },
      });
      expect(mockTracer.logAuditEvent).not.toHaveBeenCalled();
    });

    it("never throws, and keeps the row, when storage is not configured", async () => {
      mockStorageService.remove.mockRejectedValue(
        new Error("Object storage is not configured"),
      );

      await expect(
        run({ header: { logoUrl: oldUrl } }, { header: { logoUrl: newUrl } }),
      ).resolves.toBeUndefined();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
    });
  });

  describe("cleanupOrphanedFiles", () => {
    const row = (id: string) => ({
      id,
      bucket: "klivo-assets",
      storageKey: `k/${id}.png`,
      publicUrl: `https://cdn.example.com/k/${id}.png`,
      entityId: "theme-x",
      fileName: `${id}.png`,
      purpose: "header-logo",
    });

    beforeEach(() => {
      mockPrismaService.file.findMany.mockImplementation(
        async ({ where }: { where: { id: { in: string[] } } }) =>
          where.id.in.map((id) => row(id)),
      );
      mockPrismaService.agentTheme.findUnique.mockResolvedValue(null);
      mockPrismaService.file.deleteMany.mockResolvedValue({ count: 1 });
    });

    it("deletes unused old uploads, per agent under its lock, and logs the run", async () => {
      routeRawQueries([
        [
          { id: "a", agentId: "agent-1" },
          { id: "b", agentId: "agent-2" },
        ],
      ]);

      const result = await service.cleanupOrphanedFiles();

      expect(result).toEqual({ scanned: 2, deleted: 2, failed: 0 });
      expect(rawCalls("FOR NO KEY UPDATE").map((c) => c[1])).toEqual([
        "agent-1",
        "agent-2",
      ]);
      expect(mockStorageService.remove).toHaveBeenCalledWith(
        "klivo-assets",
        ["k/a.png"],
        "INTERNAL",
      );
      expect(mockInternalLog.logCompleted).toHaveBeenCalledWith(
        "FILE_CLEANUP_RUN_COMPLETED",
        expect.objectContaining({
          metadata: { scanned: 2, deleted: 2, failed: 0 },
        }),
      );
    });

    it("collects used URLs once per batch, only for the configured bucket, oldest-touched first", async () => {
      routeRawQueries([]);

      await service.cleanupOrphanedFiles();

      const [call] = rawCalls("WITH used");
      const sql = (call![0] as TemplateStringsArray).join("?");
      expect(sql).toContain("jsonb_path_query");
      expect(sql).toContain("starts_with(v #>> '{}', ?)");
      expect(call![1]).toBe("https://cdn.example.com");
      expect(sql).toContain("f.bucket = ?");
      expect(call![2]).toBe("klivo-assets");
      expect(sql).toContain('ORDER BY f."updatedAt"');
    });

    it("keeps going past a full batch, skipping this run's failures in later batches", async () => {
      const full = Array.from({ length: 200 }, (_, i) => ({
        id: `f${i}`,
        agentId: "agent-1",
      }));
      routeRawQueries([full, [{ id: "last", agentId: "agent-1" }]]);
      mockStorageService.remove.mockImplementation(
        async (_b: string, keys: string[]) => ({
          removed: keys.filter((k) => k !== "k/f0.png"),
          failed: keys.filter((k) => k === "k/f0.png"),
        }),
      );

      const result = await service.cleanupOrphanedFiles();

      expect(result).toEqual({ scanned: 201, deleted: 200, failed: 1 });
      const batches = rawCalls("WITH used");
      expect(batches).toHaveLength(2);
      // The second batch excludes the id that failed in the first.
      expect(batches[1]).toContainEqual(["f0"]);
      expect(mockPrismaService.file.updateMany).toHaveBeenCalledWith({
        where: { id: { in: ["f0"] } },
        data: { updatedAt: expect.any(Date) },
      });
    });

    it("skips one agent that fails (e.g. lock timeout) and still cleans the others", async () => {
      routeRawQueries([
        [
          { id: "a", agentId: "agent-1" },
          { id: "b", agentId: "agent-2" },
        ],
      ]);
      let calls = 0;
      mockPrismaService.$transaction.mockImplementation(
        (cb: (tx: typeof mockPrismaService) => Promise<unknown>) => {
          calls++;
          if (calls === 1)
            return Promise.reject(new Error("P2028 lock timeout"));
          return cb(mockPrismaService);
        },
      );

      const result = await service.cleanupOrphanedFiles();

      expect(result).toEqual({ scanned: 2, deleted: 1, failed: 1 });
      expect(mockInternalLog.logCompleted).toHaveBeenCalled();
      expect(mockInternalLog.logFailed).not.toHaveBeenCalled();
    });

    it("logs an idle run and touches nothing when there is nothing to clean", async () => {
      routeRawQueries([]);

      const result = await service.cleanupOrphanedFiles();

      expect(result).toEqual({ scanned: 0, deleted: 0, failed: 0 });
      expect(mockStorageService.remove).not.toHaveBeenCalled();
      expect(mockPrismaService.file.deleteMany).not.toHaveBeenCalled();
      expect(mockInternalLog.logCompleted).toHaveBeenCalledWith(
        "FILE_CLEANUP_RUN_COMPLETED",
        expect.anything(),
      );
    });

    it("fails the run, touching nothing, when storage is not configured", async () => {
      const original = mockStorageService.bucket;
      mockStorageService.bucket = "";
      try {
        await expect(service.cleanupOrphanedFiles()).rejects.toThrow(
          "Object storage is not configured",
        );
      } finally {
        mockStorageService.bucket = original;
      }
      expect(mockPrismaService.$queryRaw).not.toHaveBeenCalled();
      expect(mockInternalLog.logFailed).toHaveBeenCalledWith(
        "FILE_CLEANUP_RUN_FAILED",
        expect.any(Error),
        expect.anything(),
      );
    });

    it("trigger: starts one run in the background and refuses a second meanwhile", async () => {
      let finish!: () => void;
      const spy = jest.spyOn(service, "cleanupOrphanedFiles").mockReturnValue(
        new Promise((r) => {
          finish = () => r({ scanned: 0, deleted: 0, failed: 0 });
        }),
      );

      expect(service.triggerOrphanCleanup()).toBe(true);
      expect(service.triggerOrphanCleanup()).toBe(false);
      finish();
      await new Promise((r) => setImmediate(r));
      expect(service.triggerOrphanCleanup()).toBe(true);
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });
});
