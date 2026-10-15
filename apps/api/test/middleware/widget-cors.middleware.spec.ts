import { ForbiddenException } from "@nestjs/common";
import { Request, Response } from "express";
import { WidgetCorsMiddleware } from "../../src/middleware/widget-cors.middleware";
import { PrismaService } from "../../src/services/prisma.service";
import { WidgetCorsCacheService } from "../../src/common/cache/widget-cors-cache.service";

const DASHBOARD = "https://app.klivo.test";
const AGENT = {
  id: "11111111-1111-4111-8111-111111111111",
  publicId: "abcd1234",
  allowedDomains: ["customer.example"],
};

describe("WidgetCorsMiddleware", () => {
  let middleware: WidgetCorsMiddleware;
  let prisma: { agent: { findFirst: jest.Mock } };
  let cache: { get: jest.Mock; set: jest.Mock };
  const prevOrigin = process.env.CORS_ORIGIN;

  beforeEach(() => {
    process.env.CORS_ORIGIN = DASHBOARD;
    prisma = { agent: { findFirst: jest.fn().mockResolvedValue(AGENT) } };
    cache = { get: jest.fn().mockReturnValue(null), set: jest.fn() };
    middleware = new WidgetCorsMiddleware(
      prisma as unknown as PrismaService,
      cache as unknown as WidgetCorsCacheService,
    );
  });

  afterAll(() => {
    if (prevOrigin === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = prevOrigin;
  });

  function run(opts: {
    method: string;
    url: string;
    origin?: string;
    body?: Record<string, unknown>;
    query?: Record<string, string>;
  }) {
    const headers: Record<string, string> = {};
    const status = jest.fn().mockReturnValue({ end: jest.fn() });
    const req = {
      method: opts.method,
      originalUrl: opts.url,
      url: opts.url,
      headers: opts.origin ? { origin: opts.origin } : {},
      body: opts.body ?? {},
      query: opts.query ?? {},
    } as unknown as Request;
    const res = {
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      status,
    } as unknown as Response;
    const next = jest.fn();
    return middleware
      .use(req, res, next)
      .then(() => ({ headers, next, status }));
  }

  it("always allows the dashboard origin, with credentials", async () => {
    const { headers, next } = await run({
      method: "POST",
      url: "/api/klivo/v1/public/voice/conversation",
      origin: DASHBOARD,
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(DASHBOARD);
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
    expect(next).toHaveBeenCalled();
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it("allows a voice POST from an allowlisted origin when ?agentId is present", async () => {
    const { headers, next } = await run({
      method: "POST",
      url: `/api/klivo/v1/public/voice/conversation?agentId=${AGENT.id}`,
      origin: "https://customer.example",
      query: { agentId: AGENT.id },
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://customer.example",
    );
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  // Regression: this used to be treated as a preflight and got ACAO for ANY origin,
  // and later still reached the controller, which read the agent from the
  // multipart body and ran the call on the agent's credits.
  it("rejects a voice POST that omits agentId from a foreign origin", async () => {
    await expect(
      run({
        method: "POST",
        url: "/api/klivo/v1/public/voice/conversation",
        origin: "https://attacker.example",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it("lets a foreign GET that names no agent through to the controller", async () => {
    const { headers, next } = await run({
      method: "GET",
      url: "/api/klivo/v1/public/voice/providers",
      origin: "https://attacker.example",
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(next).toHaveBeenCalled();
  });

  it("answers a blocked origin's preflight without CORS headers", async () => {
    const { headers, next, status } = await run({
      method: "OPTIONS",
      url: `/api/klivo/v1/public/voice/conversation?agentId=${AGENT.id}`,
      origin: "https://attacker.example",
      query: { agentId: AGENT.id },
    });
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("still lets a voice OPTIONS preflight through when the agent is unknown", async () => {
    const { headers, next, status } = await run({
      method: "OPTIONS",
      url: "/api/klivo/v1/public/voice/conversation",
      origin: "https://customer.example",
    });
    // Preflight cannot carry a body; the real POST is re-checked with the agent.
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://customer.example",
    );
    expect(status).toHaveBeenCalledWith(204);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a chat POST whose origin is not in allowedDomains", async () => {
    await expect(
      run({
        method: "POST",
        url: "/api/klivo/v1/public/chat/message",
        origin: "https://attacker.example",
        body: { agentId: AGENT.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("matches a wildcard entry against subdomains", async () => {
    prisma.agent.findFirst.mockResolvedValue({
      ...AGENT,
      allowedDomains: ["*.customer.example"],
    });
    const { headers } = await run({
      method: "POST",
      url: "/api/klivo/v1/public/chat/message",
      origin: "https://shop.customer.example",
      body: { agentId: AGENT.id },
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "https://shop.customer.example",
    );
  });

  it("rejects every origin when the agent has no allowed domains", async () => {
    prisma.agent.findFirst.mockResolvedValue({ ...AGENT, allowedDomains: [] });
    await expect(
      run({
        method: "POST",
        url: "/api/klivo/v1/public/chat/message",
        origin: "https://anyone.example",
        body: { agentId: AGENT.id },
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("rejects the config endpoint for an agent with no allowed domains", async () => {
    prisma.agent.findFirst.mockResolvedValue({ ...AGENT, allowedDomains: [] });
    await expect(
      run({
        method: "GET",
        url: `/api/klivo/v1/public/agents/${AGENT.publicId}/config`,
        origin: "https://anyone.example",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("still allows the dashboard origin for an agent with no allowed domains", async () => {
    prisma.agent.findFirst.mockResolvedValue({ ...AGENT, allowedDomains: [] });
    const { headers } = await run({
      method: "POST",
      url: "/api/klivo/v1/public/chat/message",
      origin: DASHBOARD,
      body: { agentId: AGENT.id },
    });
    expect(headers["Access-Control-Allow-Origin"]).toBe(DASHBOARD);
  });

  describe("local development hosts", () => {
    const prevEnv = process.env.NODE_ENV;
    afterEach(() => {
      process.env.NODE_ENV = prevEnv;
    });

    it("allows localhost outside production, even with no allowed domains", async () => {
      process.env.NODE_ENV = "development";
      prisma.agent.findFirst.mockResolvedValue({
        ...AGENT,
        allowedDomains: [],
      });
      const { headers } = await run({
        method: "POST",
        url: "/api/klivo/v1/public/chat/message",
        origin: "http://localhost:5173",
        body: { agentId: AGENT.id },
      });
      expect(headers["Access-Control-Allow-Origin"]).toBe(
        "http://localhost:5173",
      );
    });

    it("blocks localhost in production unless it is in allowed domains", async () => {
      process.env.NODE_ENV = "production";
      await expect(
        run({
          method: "POST",
          url: "/api/klivo/v1/public/chat/message",
          origin: "http://localhost:5173",
          body: { agentId: AGENT.id },
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  it("serves the allowlist from cache and stores it under both identifiers", async () => {
    cache.get.mockReturnValue(["customer.example"]);
    await run({
      method: "GET",
      url: `/api/klivo/v1/public/agents/${AGENT.publicId}/config`,
      origin: "https://customer.example",
    });
    expect(prisma.agent.findFirst).not.toHaveBeenCalled();

    cache.get.mockReturnValue(null);
    await run({
      method: "GET",
      url: `/api/klivo/v1/public/agents/${AGENT.publicId}/config`,
      origin: "https://customer.example",
    });
    expect(cache.set).toHaveBeenCalledWith(
      { publicId: AGENT.publicId, id: AGENT.id },
      AGENT.allowedDomains,
    );
  });
});
