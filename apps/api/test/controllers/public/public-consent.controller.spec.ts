import { BadRequestException, HttpException } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import type { Request } from "express";
import { PublicConsentController } from "../../../src/controllers/public/public-consent.controller";
import { ChatService } from "../../../src/services/chat.service";
import { ConsentService } from "../../../src/services/consent.service";
import { MessageRateLimitService } from "../../../src/services/message-rate-limit.service";
import { CryptoService } from "../../../src/common/crypto/crypto.service";

const DEVICE = "3f2b8c1e-4a5d-4e6f-9a7b-1c2d3e4f5a6b";
const HASH = "a".repeat(64);

describe("PublicConsentController", () => {
  let controller: PublicConsentController;

  const mockChatService = { resolveAgent: jest.fn() };
  const mockConsentService = { record: jest.fn() };
  const mockRateLimit = {
    getDeviceIdentifier: jest.fn(),
    getClientIp: jest.fn(),
    checkMessageRateLimit: jest.fn(),
  };
  const mockCrypto = { hashVisitorDevice: jest.fn(), hashVisitorIp: jest.fn() };

  function req(deviceId?: string): Request {
    return {
      headers: deviceId ? { "x-device-id": deviceId } : {},
      ip: "203.0.113.9",
    } as unknown as Request;
  }

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PublicConsentController],
      providers: [
        { provide: ChatService, useValue: mockChatService },
        { provide: ConsentService, useValue: mockConsentService },
        { provide: MessageRateLimitService, useValue: mockRateLimit },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    controller = moduleRef.get(PublicConsentController);
    jest.clearAllMocks();
    mockRateLimit.getDeviceIdentifier.mockReturnValue(DEVICE);
    mockRateLimit.getClientIp.mockReturnValue("203.0.113.9");
    mockRateLimit.checkMessageRateLimit.mockResolvedValue({ allowed: true });
    mockCrypto.hashVisitorDevice.mockImplementation((id?: string) =>
      id === DEVICE ? "vd_abc" : undefined,
    );
    mockCrypto.hashVisitorIp.mockReturnValue("vh_ip");
    mockChatService.resolveAgent.mockResolvedValue({
      id: "agent-1",
      organizationId: "org-1",
    });
  });

  it("records a GRANT for the resolved agent, keyed by the hashed device ID", async () => {
    mockConsentService.record.mockResolvedValue({
      recorded: true,
      consentId: "c-1",
      action: "GRANTED",
      noticeHash: HASH,
    });

    const result = await controller.decide(
      { agentId: "pub-agent", action: "GRANT", noticeHash: HASH },
      req(DEVICE),
    );

    expect(mockChatService.resolveAgent).toHaveBeenCalledWith("pub-agent");
    expect(mockConsentService.record).toHaveBeenCalledWith({
      agentId: "agent-1",
      organizationId: "org-1",
      source: "WIDGET",
      visitor: { visitorId: "vd_abc", ipHash: "vh_ip" },
      action: "GRANTED",
      method: "WIDGET_BUTTON",
      noticeHash: HASH,
    });
    // The internal consent id is not handed to the browser.
    expect(result).toEqual({
      recorded: true,
      action: "GRANTED",
      noticeHash: HASH,
    });
  });

  it("records a WITHDRAW via the withdraw link method", async () => {
    mockConsentService.record.mockResolvedValue({
      recorded: true,
      consentId: "c-2",
      action: "WITHDRAWN",
      noticeHash: HASH,
    });

    await controller.decide(
      { agentId: "pub-agent", action: "WITHDRAW" },
      req(DEVICE),
    );

    expect(mockConsentService.record).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "WITHDRAWN",
        method: "WIDGET_WITHDRAW_LINK",
      }),
    );
  });

  it('passes through "nothing recorded" (notice mode)', async () => {
    mockConsentService.record.mockResolvedValue({ recorded: false });
    await expect(
      controller.decide(
        { agentId: "pub-agent", action: "GRANT", noticeHash: HASH },
        req(DEVICE),
      ),
    ).resolves.toEqual({ recorded: false });
  });

  it("rejects a request without a valid device ID", async () => {
    await expect(
      controller.decide(
        { agentId: "pub-agent", action: "GRANT", noticeHash: HASH },
        req("not-a-uuid"),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mockConsentService.record).not.toHaveBeenCalled();
  });

  it("rejects a GRANT without the notice hash", async () => {
    await expect(
      controller.decide({ agentId: "pub-agent", action: "GRANT" }, req(DEVICE)),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("returns 429 and records nothing when rate limited", async () => {
    mockRateLimit.checkMessageRateLimit.mockResolvedValue({
      allowed: false,
      message: "Slow down",
      retryAfterSeconds: 30,
    });

    const error = await controller
      .decide(
        { agentId: "pub-agent", action: "GRANT", noticeHash: HASH },
        req(DEVICE),
      )
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(429);
    expect(mockChatService.resolveAgent).not.toHaveBeenCalled();
    expect(mockConsentService.record).not.toHaveBeenCalled();
  });
});
