import { Test, TestingModule } from "@nestjs/testing";
import { ConfigService } from "@nestjs/config";
import { EmailService } from "../../../src/services/email.service";
import { EmailLoggerService } from "../../../src/common/logger/email.logger";
import { ProviderEventLogger } from "../../../src/common/events/provider.logger";
import { UsageMeterService } from "../../../src/modules/usage/usage-meter.service";

// Mock Resend with a class so `new Resend()` works correctly
jest.mock("resend", () => ({
  Resend: class MockResend {
    emails = { send: jest.fn() };
  },
}));

describe("EmailService", () => {
  let service: EmailService;
  let mockSend: jest.Mock;
  const mockUsageMeter = { record: jest.fn() };

  const configValues: Record<string, string> = {
    RESEND_API_KEY: "re_test_key",
    EMAIL_FROM: "Test <test@example.com>",
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) =>
              configValues[key] ?? defaultValue,
          },
        },
        {
          provide: EmailLoggerService,
          useValue: {
            logEmailSent: jest.fn(),
            logEmailFailed: jest.fn(),
            logEmailException: jest.fn(),
          },
        },
        { provide: ProviderEventLogger, useValue: { log: jest.fn() } },
        { provide: UsageMeterService, useValue: mockUsageMeter },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    // Access the mock send via the service's internal resend instance
    mockSend = (
      service as unknown as { resend: { emails: { send: jest.Mock } } }
    ).resend.emails.send;
    mockSend.mockReset();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  it("should send email successfully", async () => {
    mockSend.mockResolvedValue({
      data: { id: "email-123" },
      error: null,
    });

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });

    expect(result).toEqual({ id: "email-123" });
    expect(mockSend).toHaveBeenCalledWith({
      from: "Test <test@example.com>",
      to: ["recipient@example.com"],
      subject: "Test Subject",
      html: "<p>Hello</p>",
    });
  });

  describe("usage metering", () => {
    it("records one EMAIL row per send with one unit per recipient", async () => {
      mockSend.mockResolvedValue({ data: { id: "email-9" }, error: null });

      await service.send({
        to: ["a@example.com", "b@example.com", "c@example.com"],
        subject: "Handover",
        html: "<p>x</p>",
        organizationId: "org-1",
      });

      expect(mockUsageMeter.record).toHaveBeenCalledTimes(1);
      expect(mockUsageMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-1",
          channel: "INTERNAL",
          feature: "EMAIL",
          provider: "resend",
          model: "email",
          providerRequestId: "email-9",
          quantities: { units: 3 },
          quantitySource: "MEASURED",
        }),
      );
    });

    it("records a single recipient as one unit, with no organization when none is given", async () => {
      mockSend.mockResolvedValue({ data: { id: "email-1" }, error: null });

      await service.send({ to: "x@example.com", subject: "s", html: "h" });

      expect(mockUsageMeter.record).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: null,
          quantities: { units: 1 },
        }),
      );
    });

    it("records nothing when Resend rejects or the call throws (nothing was sent)", async () => {
      mockSend.mockResolvedValueOnce({ data: null, error: { message: "bad" } });
      await service.send({ to: "x@example.com", subject: "s", html: "h" });
      mockSend.mockRejectedValueOnce(new Error("network"));
      await service.send({ to: "x@example.com", subject: "s", html: "h" });

      expect(mockUsageMeter.record).not.toHaveBeenCalled();
    });
  });

  it("should return null when Resend returns an error", async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: "Invalid API key" },
    });

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result).toBeNull();
  });

  it("should return null and not throw on send failure", async () => {
    mockSend.mockRejectedValue(new Error("Network error"));

    const result = await service.send({
      to: "recipient@example.com",
      subject: "Test",
      html: "<p>Hello</p>",
    });

    expect(result).toBeNull();
  });
});
