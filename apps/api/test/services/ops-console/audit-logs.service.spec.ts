import { BadRequestException } from "@nestjs/common";
import { auditLogListQuerySchema } from "@repo/validation";
import { AuditLogsService } from "../../../src/modules/ops-console/audit-logs.service";
import type { PrismaService } from "../../../src/services/prisma.service";

const DAY = 24 * 60 * 60 * 1000;

describe("AuditLogsService", () => {
  const prisma = {
    auditLog: { findMany: jest.fn(), count: jest.fn(), groupBy: jest.fn() },
    user: { findMany: jest.fn() },
    organization: { findMany: jest.fn() },
    agent: { findMany: jest.fn() },
  };
  let service: AuditLogsService;

  const parse = (q: Record<string, string>) => auditLogListQuerySchema.parse(q);

  beforeEach(() => {
    service = new AuditLogsService(prisma as unknown as PrismaService);
    prisma.auditLog.findMany.mockResolvedValue([]);
    prisma.auditLog.count.mockResolvedValue(0);
    prisma.user.findMany.mockResolvedValue([]);
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.agent.findMany.mockResolvedValue([]);
  });

  const whereOf = () => prisma.auditLog.findMany.mock.calls[0][0].where;

  it("defaults to the last 7 days, newest first", async () => {
    const before = Date.now();
    const page = await service.list(parse({}));

    const { AND } = whereOf();
    const { gte, lte } = AND[0].createdAt;
    expect(lte.getTime()).toBeGreaterThanOrEqual(before);
    expect(lte.getTime() - gte.getTime()).toBe(7 * DAY);
    expect(prisma.auditLog.findMany.mock.calls[0][0].orderBy).toEqual([
      { createdAt: "desc" },
      { id: "desc" },
    ]);
    expect(page.meta.from).toBe(gte.toISOString());
  });

  it("applies every filter and keeps the date bound", async () => {
    await service.list(
      parse({
        organizationId: "6a0a9f43-5d0e-4e7a-9a43-1c8d5b2f0a11",
        userId: "7b1b0a54-6e1f-4f8b-8b54-2d9e6c3a1b22",
        agentId: "8c2c1b65-7f2a-4a9c-9c65-3e0f7d4b2c33",
        events: "AGENT_CREATED,AGENT_DELETED",
        search: "agent",
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-05T00:00:00.000Z",
      }),
    );

    expect(whereOf()).toEqual({
      AND: [
        {
          createdAt: {
            gte: new Date("2026-10-01T00:00:00.000Z"),
            lte: new Date("2026-10-05T00:00:00.000Z"),
          },
        },
        { organizationId: "6a0a9f43-5d0e-4e7a-9a43-1c8d5b2f0a11" },
        { userId: "7b1b0a54-6e1f-4f8b-8b54-2d9e6c3a1b22" },
        { agentId: "8c2c1b65-7f2a-4a9c-9c65-3e0f7d4b2c33" },
        { event: { in: ["AGENT_CREATED", "AGENT_DELETED"] } },
        { event: { contains: "agent", mode: "insensitive" } },
      ],
    });
  });

  it("rejects a window wider than 90 days", async () => {
    await expect(
      service.list(
        parse({
          from: "2026-01-01T00:00:00.000Z",
          to: "2026-06-01T00:00:00.000Z",
        }),
      ),
    ).rejects.toThrow(BadRequestException);
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it("caps the count and reports it as capped", async () => {
    prisma.auditLog.count.mockResolvedValue(10_001);

    const page = await service.list(parse({ limit: "50" }));

    expect(prisma.auditLog.count.mock.calls[0][0].take).toBe(10_001);
    expect(page.meta).toEqual(
      expect.objectContaining({
        total: 10_000,
        totalPages: 200,
        totalCapped: true,
      }),
    );
  });

  it("refuses to page past the count cap", async () => {
    await expect(
      service.list(parse({ page: "101", limit: "100" })),
    ).rejects.toThrow(BadRequestException);
  });

  it("joins user, organization and agent names in one batched lookup each", async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        createdAt: new Date(),
        event: "AGENT_UPDATED",
        contextId: "ag-1",
        correlationId: null,
        userId: "u-1",
        organizationId: "org-1",
        agentId: "ag-1",
        data: { field: "name" },
      },
      {
        id: "a2",
        createdAt: new Date(),
        event: "LOGIN",
        contextId: "u-1",
        correlationId: null,
        userId: "u-1",
        organizationId: null,
        agentId: null,
        data: {},
      },
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: "u-1", email: "a@b.test", name: "A" },
    ]);
    prisma.organization.findMany.mockResolvedValue([
      { id: "org-1", name: "Acme" },
    ]);
    prisma.agent.findMany.mockResolvedValue([{ id: "ag-1", name: "Helper" }]);

    const page = await service.list(parse({}));

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany.mock.calls[0][0].where).toEqual({
      id: { in: ["u-1"] },
    });
    expect(page.data[0]).toEqual(
      expect.objectContaining({
        user: { id: "u-1", email: "a@b.test", name: "A" },
        organization: { id: "org-1", name: "Acme" },
        agent: { id: "ag-1", name: "Helper" },
      }),
    );
    expect(page.data[1]!.organization).toBeNull();
    expect(page.data[1]!.agent).toBeNull();
  });

  it("skips the name lookups when the page is empty", async () => {
    await service.list(parse({}));

    expect(prisma.user.findMany).not.toHaveBeenCalled();
    expect(prisma.organization.findMany).not.toHaveBeenCalled();
    expect(prisma.agent.findMany).not.toHaveBeenCalled();
  });

  it("re-redacts secrets inside data before returning it", async () => {
    prisma.auditLog.findMany.mockResolvedValue([
      {
        id: "a1",
        createdAt: new Date(),
        event: "AGENT_SECRET_CREATED",
        contextId: "ag-1",
        correlationId: null,
        userId: null,
        organizationId: null,
        agentId: null,
        data: {
          name: "HUBSPOT",
          apiKey: "sk-live-123",
          nested: { password: "p" },
        },
      },
    ]);

    const page = await service.list(parse({}));

    expect(page.data[0]!.data).toEqual({
      name: "HUBSPOT",
      apiKey: "[REDACTED]",
      nested: { password: "[REDACTED]" },
    });
  });

  it("lists distinct event names from the last 30 days via GROUP BY", async () => {
    prisma.auditLog.groupBy.mockResolvedValue([
      { event: "AGENT_CREATED" },
      { event: "LOGIN" },
    ]);

    const before = Date.now();
    await expect(service.eventNames()).resolves.toEqual({
      events: ["AGENT_CREATED", "LOGIN"],
    });

    const args = prisma.auditLog.groupBy.mock.calls[0][0];
    expect(args.by).toEqual(["event"]);
    expect(before - args.where.createdAt.gte.getTime()).toBeGreaterThanOrEqual(
      30 * DAY - 1000,
    );
  });
});
