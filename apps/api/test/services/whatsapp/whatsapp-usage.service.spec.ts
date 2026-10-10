import type { UsageMeterService } from "../../../src/modules/usage/usage-meter.service";
import type { WhatsappStatus } from "../../../src/modules/whatsapp/interfaces/whatsapp.interfaces";
import {
  WhatsappUsageService,
  priceModel,
} from "../../../src/modules/whatsapp/whatsapp-usage.service";
import type { PrismaService } from "../../../src/services/prisma.service";

const status = (over: Partial<WhatsappStatus> = {}): WhatsappStatus => ({
  id: "wamid.1",
  status: "sent",
  timestamp: "1760000000",
  recipient_id: "919876543210",
  pricing: { billable: true, pricing_model: "PMP", category: "service" },
  ...over,
});

describe("WhatsappUsageService", () => {
  let prisma: {
    whatsappChannel: { findUnique: jest.Mock };
    usageRecord: { findMany: jest.Mock };
  };
  let record: jest.Mock;
  let service: WhatsappUsageService;

  beforeEach(() => {
    prisma = {
      whatsappChannel: {
        findUnique: jest.fn().mockResolvedValue({
          agentId: "agent-1",
          agent: { organizationId: "org-1" },
        }),
      },
      usageRecord: { findMany: jest.fn().mockResolvedValue([]) },
    };
    record = jest.fn();
    service = new WhatsappUsageService(
      prisma as unknown as PrismaService,
      { record } as unknown as UsageMeterService,
    );
  });

  it("records a billable status as one CLIENT-billed message, scoped through the channel", async () => {
    await service.recordStatuses("PNID", [status()]);

    expect(prisma.whatsappChannel.findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { phoneNumberId: "PNID" } }),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith({
      occurredAt: new Date(1760000000 * 1000),
      organizationId: "org-1",
      agentId: "agent-1",
      channel: "WHATSAPP",
      feature: "WHATSAPP_MESSAGE",
      provider: "meta_whatsapp",
      model: "service",
      providerRequestId: "wamid.1",
      quantities: { units: 1 },
      quantitySource: "PROVIDER_REPORTED",
      billedTo: "CLIENT",
    });
  });

  it("records nothing for free (billable=false), unpriced or failed statuses", async () => {
    await service.recordStatuses("PNID", [
      status({
        id: "w.free",
        pricing: {
          billable: false,
          category: "service",
          type: "free_customer_service",
        },
      }),
      status({ id: "w.read", status: "read", pricing: undefined }),
      status({ id: "w.failed", status: "failed" }),
    ]);

    expect(record).not.toHaveBeenCalled();
    expect(prisma.usageRecord.findMany).not.toHaveBeenCalled();
  });

  it("records a message once when Meta repeats pricing on sent, delivered and read", async () => {
    await service.recordStatuses("PNID", [
      status({ status: "sent" }),
      status({ status: "delivered" }),
    ]);
    await service.recordStatuses("PNID", [status({ status: "read" })]);

    expect(record).toHaveBeenCalledTimes(1);
  });

  it("skips messages the ledger already holds (restart or another instance)", async () => {
    prisma.usageRecord.findMany.mockResolvedValue([
      { providerRequestId: "wamid.1" },
    ]);

    await service.recordStatuses("PNID", [
      status(),
      status({
        id: "wamid.2",
        pricing: { billable: true, category: "utility" },
      }),
    ]);

    expect(prisma.usageRecord.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          provider: "meta_whatsapp",
          providerRequestId: { in: ["wamid.1", "wamid.2"] },
        },
      }),
    );
    expect(record).toHaveBeenCalledTimes(1);
    expect(record.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        providerRequestId: "wamid.2",
        model: "utility",
      }),
    );
  });

  it("still records the charge when the channel is gone, with no organization", async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(null);

    await service.recordStatuses("PNID", [status()]);

    expect(record).toHaveBeenCalledWith(
      expect.objectContaining({ organizationId: null, agentId: null }),
    );
  });

  it("never throws, and lets a later status retry after a database error", async () => {
    prisma.usageRecord.findMany.mockRejectedValueOnce(new Error("db down"));

    await expect(
      service.recordStatuses("PNID", [status()]),
    ).resolves.toBeUndefined();
    expect(record).not.toHaveBeenCalled();

    await service.recordStatuses("PNID", [status({ status: "delivered" })]);
    expect(record).toHaveBeenCalledTimes(1);
  });
});

describe("priceModel", () => {
  it("uses the pricing category for India (+91) recipients", () => {
    expect(priceModel(status({ pricing: { category: "MARKETING" } }))).toBe(
      "marketing",
    );
  });

  it("keeps other countries apart so they stay unpriced instead of priced at India's rate", () => {
    expect(priceModel(status({ recipient_id: "15551234567" }))).toBe(
      "service:intl",
    );
  });
});
