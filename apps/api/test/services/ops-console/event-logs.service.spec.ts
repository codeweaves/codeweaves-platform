import { BadRequestException, NotFoundException } from "@nestjs/common";
import { eventLogListQuerySchema } from "@repo/validation";
import {
  EventLogsService,
  stripHeaders,
} from "../../../src/modules/ops-console/event-logs.service";
import type { PrismaService } from "../../../src/services/prisma.service";

const HOUR = 60 * 60 * 1000;

describe("EventLogsService", () => {
  const prisma = {
    eventLog: { findMany: jest.fn(), count: jest.fn(), findUnique: jest.fn() },
    organization: { findMany: jest.fn(), findUnique: jest.fn() },
    user: { findUnique: jest.fn() },
  };
  let service: EventLogsService;

  const parse = (q: Record<string, string>) => eventLogListQuerySchema.parse(q);

  beforeEach(() => {
    service = new EventLogsService(prisma as unknown as PrismaService);
    prisma.eventLog.findMany.mockResolvedValue([]);
    prisma.eventLog.count.mockResolvedValue(0);
    prisma.organization.findMany.mockResolvedValue([]);
    prisma.organization.findUnique.mockResolvedValue(null);
    prisma.user.findUnique.mockResolvedValue(null);
  });

  const listArgs = () => prisma.eventLog.findMany.mock.calls[0][0];

  describe("list", () => {
    it("defaults to the last 24 hours", async () => {
      await service.list(parse({}));

      const { gte, lte } = listArgs().where.AND[0].createdAt;
      expect(lte.getTime() - gte.getTime()).toBe(24 * HOUR);
    });

    it("never selects payloads, headers or metadata", async () => {
      await service.list(parse({}));

      const select = listArgs().select;
      for (const heavy of [
        "requestHeaders",
        "requestPayload",
        "responsePayload",
        "metadata",
      ]) {
        expect(select).not.toHaveProperty(heavy);
      }
    });

    it("applies channel, provider, success and scope filters", async () => {
      await service.list(
        parse({
          channels: "WIDGET,VOICE",
          providers: "OPENAI,SARVAM",
          success: "false",
          eventName: "OPENAI_CHAT_FAILED",
          organizationId: "6a0a9f43-5d0e-4e7a-9a43-1c8d5b2f0a11",
          agentId: "8c2c1b65-7f2a-4a9c-9c65-3e0f7d4b2c33",
          sessionId: "sess-1",
        }),
      );

      expect(listArgs().where.AND.slice(1)).toEqual([
        { channel: { in: ["WIDGET", "VOICE"] } },
        { provider: { in: ["OPENAI", "SARVAM"] } },
        { eventName: "OPENAI_CHAT_FAILED" },
        { success: false },
        { organizationId: "6a0a9f43-5d0e-4e7a-9a43-1c8d5b2f0a11" },
        { agentId: "8c2c1b65-7f2a-4a9c-9c65-3e0f7d4b2c33" },
        { sessionId: "sess-1" },
      ]);
    });

    it("search matches an event name fragment or an exact session / correlation id", async () => {
      await service.list(parse({ search: "abc-123" }));

      expect(listArgs().where.AND[1]).toEqual({
        OR: [
          { eventName: { contains: "abc-123", mode: "insensitive" } },
          { sessionId: "abc-123" },
          { correlationId: "abc-123" },
        ],
      });
    });

    it("rejects a window wider than 30 days", async () => {
      await expect(
        service.list(
          parse({
            from: "2026-08-01T00:00:00.000Z",
            to: "2026-10-01T00:00:00.000Z",
          }),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it("scrubs credentials from URLs, truncates errors and names the org", async () => {
      prisma.eventLog.findMany.mockResolvedValue([
        {
          id: "e1",
          organizationId: "org-1",
          requestUrl:
            "https://generativelanguage.googleapis.com/v1/models?key=AIza-secret&alt=sse",
          errorMessage: "x".repeat(500),
          success: false,
        },
      ]);
      prisma.organization.findMany.mockResolvedValue([
        { id: "org-1", name: "Acme" },
      ]);

      const page = await service.list(parse({}));
      const row = page.data[0]!;

      expect(row.requestUrl).not.toContain("AIza-secret");
      expect(row.requestUrl).toContain("alt=sse");
      expect(row.errorMessage).toHaveLength(301);
      expect(row.organization).toEqual({ id: "org-1", name: "Acme" });
    });
  });

  describe("get", () => {
    const id = "0b5c1f8e-3a52-4c1e-9d43-1f1b2a3c4d5e";

    it("404s an unknown id", async () => {
      prisma.eventLog.findUnique.mockResolvedValue(null);

      await expect(service.get(id)).rejects.toThrow(NotFoundException);
    });

    it("strips credential headers and redacts payload secrets", async () => {
      prisma.eventLog.findUnique.mockResolvedValue({
        id,
        organizationId: "org-1",
        actorUserId: "u-1",
        requestUrl: "/api/klivo/v1/internal/classifier/run",
        errorMessage: null,
        requestHeaders: {
          Authorization: "Bearer eyJ.secret",
          cookie: "__session=abc",
          "x-internal-secret": "cron-secret",
          "x-api-key": "k",
          "x-webhook-secret": "whsec",
          "x-session-token": "tok",
          "content-type": "application/json",
          "x-correlation-id": "c-1",
        },
        requestPayload: { message: "hi", accessToken: "at-1" },
        responsePayload: { ok: true, refresh_token: "rt-1" },
        metadata: { inputTokens: 12, headers: { authorization: "Bearer z" } },
      });
      prisma.organization.findUnique.mockResolvedValue({
        id: "org-1",
        name: "Acme",
      });
      prisma.user.findUnique.mockResolvedValue({
        id: "u-1",
        email: "ops@test.com",
        name: null,
      });

      const detail = await service.get(id);

      expect(detail.requestHeaders).toEqual({
        "content-type": "application/json",
        "x-correlation-id": "c-1",
      });
      const json = JSON.stringify(detail);
      for (const secret of [
        "eyJ.secret",
        "__session",
        "cron-secret",
        "whsec",
        "at-1",
        "rt-1",
        "Bearer z",
      ]) {
        expect(json).not.toContain(secret);
      }
      expect(detail.metadata).toEqual({
        inputTokens: 12,
        headers: { authorization: "[REDACTED]" },
      });
      expect(detail.organization).toEqual({ id: "org-1", name: "Acme" });
      expect(detail.actor).toEqual({
        id: "u-1",
        email: "ops@test.com",
        name: null,
      });
    });

    it("skips lookups for rows with no org or actor", async () => {
      prisma.eventLog.findUnique.mockResolvedValue({
        id,
        organizationId: null,
        actorUserId: null,
        requestUrl: null,
        errorMessage: null,
        requestHeaders: null,
        requestPayload: null,
        responsePayload: null,
        metadata: null,
      });

      const detail = await service.get(id);

      expect(prisma.organization.findUnique).not.toHaveBeenCalled();
      expect(prisma.user.findUnique).not.toHaveBeenCalled();
      expect(detail.requestHeaders).toBeNull();
    });
  });

  describe("stripHeaders", () => {
    it("drops non-object header values", () => {
      expect(stripHeaders(["authorization", "x"])).toBeNull();
      expect(stripHeaders("authorization: x")).toBeNull();
    });

    it("returns null when only credential headers were stored", () => {
      expect(stripHeaders({ authorization: "Bearer x" })).toBeNull();
    });
  });
});
