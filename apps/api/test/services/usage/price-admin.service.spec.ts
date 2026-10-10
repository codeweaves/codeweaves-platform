import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PriceAdminService } from "../../../src/modules/usage/price-admin.service";

const price = (over: Record<string, unknown>) => ({
  id: "p",
  provider: "openai",
  model: "gpt-4.1-mini",
  unit: "INPUT_TOKEN",
  price: new Prisma.Decimal("0.4"),
  per: 1_000_000,
  currency: "USD",
  effectiveFrom: new Date("2026-01-01T00:00:00Z"),
  sourceUrl: "https://openai.com/pricing",
  note: null,
  createdById: null,
  createdAt: new Date("2026-01-01T00:00:00Z"),
  ...over,
});

const user = { id: "staff-1" } as never;

const dto = {
  provider: "openai",
  model: "gpt-4.1-mini",
  unit: "INPUT_TOKEN" as const,
  price: 0.00000012,
  per: 1_000_000,
  currency: "USD" as const,
  effectiveFrom: "2026-11-01",
  sourceUrl: "https://openai.com/pricing",
  note: "New list price",
};

function build() {
  const prisma = {
    providerPrice: { findMany: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn().mockResolvedValue([]),
  };
  const catalog = { invalidate: jest.fn() };
  const tracer = { logAuditEvent: jest.fn().mockResolvedValue(undefined) };
  const svc = new PriceAdminService(
    prisma as never,
    catalog as never,
    tracer as never,
  );
  return { svc, prisma, catalog, tracer };
}

describe("PriceAdminService", () => {
  describe("list", () => {
    it("splits each provider/model/unit into current, upcoming and previous rows", async () => {
      const { svc, prisma } = build();
      // The query orders newest first within a group, as the service asks.
      prisma.providerPrice.findMany.mockResolvedValue([
        price({
          id: "future-2",
          effectiveFrom: new Date("2027-03-01T00:00:00Z"),
        }),
        price({
          id: "future-1",
          effectiveFrom: new Date("2027-01-01T00:00:00Z"),
        }),
        price({
          id: "now",
          effectiveFrom: new Date("2026-06-01T00:00:00Z"),
          price: new Prisma.Decimal("0.35"),
        }),
        price({ id: "old", effectiveFrom: new Date("2026-01-01T00:00:00Z") }),
        price({
          id: "out",
          unit: "OUTPUT_TOKEN",
          price: new Prisma.Decimal("1.6"),
        }),
      ]);

      const out = await svc.list(new Date("2026-10-10T00:00:00Z"));

      expect(prisma.providerPrice.findMany).toHaveBeenCalledWith({
        orderBy: [
          { provider: "asc" },
          { model: "asc" },
          { unit: "asc" },
          { effectiveFrom: "desc" },
        ],
      });
      expect(out.groups).toHaveLength(2);
      const input = out.groups[0]!;
      expect(input.current?.id).toBe("now");
      expect(input.current?.price).toBe("0.35");
      // Soonest upcoming first.
      expect(input.upcoming.map((r) => r.id)).toEqual(["future-1", "future-2"]);
      expect(input.previous.map((r) => r.id)).toEqual(["old"]);
      expect(out.groups[1]).toMatchObject({
        unit: "OUTPUT_TOKEN",
        current: { id: "out", price: "1.6" },
      });
    });

    it("has no current row when every row starts in the future", async () => {
      const { svc, prisma } = build();
      prisma.providerPrice.findMany.mockResolvedValue([
        price({ id: "f", effectiveFrom: new Date("2030-01-01T00:00:00Z") }),
      ]);

      const out = await svc.list(new Date("2026-10-10T00:00:00Z"));

      expect(out.groups[0]!.current).toBeNull();
      expect(out.groups[0]!.upcoming).toHaveLength(1);
    });

    it("keeps tiny prices exact, never in exponent notation", async () => {
      const { svc, prisma } = build();
      prisma.providerPrice.findMany.mockResolvedValue([
        price({ price: new Prisma.Decimal("0.00000012") }),
      ]);

      const out = await svc.list(new Date("2026-10-10T00:00:00Z"));

      expect(out.groups[0]!.current?.price).toBe("0.00000012");
    });

    it("lists recent calls that had no price, counted in SQL", async () => {
      const { svc, prisma } = build();
      prisma.providerPrice.findMany.mockResolvedValue([]);
      prisma.$queryRaw.mockResolvedValue([
        {
          provider: "groq",
          model: "llama",
          feature: "CLASSIFIER",
          row_count: 12,
          last_seen: new Date("2026-10-09T08:00:00Z"),
        },
      ]);

      const out = await svc.list();

      expect(out.missing).toEqual([
        {
          provider: "groq",
          model: "llama",
          feature: "CLASSIFIER",
          rows: 12,
          lastSeen: "2026-10-09T08:00:00.000Z",
        },
      ]);
      const sql = Prisma.sql(
        ...(prisma.$queryRaw.mock.calls[0] as [
          TemplateStringsArray,
          ...unknown[],
        ]),
      );
      expect(sql.text).toMatch(/WHERE u\."cost" IS NULL/);
      expect(sql.text).toMatch(
        /GROUP BY u\."provider", u\."model", u\."feature"/,
      );
      expect(sql.values).toContain(30);
    });
  });

  describe("create", () => {
    it("inserts a new row, audit-logs it and reloads the price cache", async () => {
      const { svc, prisma, catalog, tracer } = build();
      prisma.providerPrice.create.mockImplementation(({ data }) =>
        Promise.resolve(
          price({
            ...data,
            id: "new-id",
            createdAt: new Date("2026-10-10T00:00:00Z"),
          }),
        ),
      );

      const out = await svc.create(dto, user);

      const data = prisma.providerPrice.create.mock.calls[0]![0].data;
      expect(data).toMatchObject({
        provider: "openai",
        model: "gpt-4.1-mini",
        unit: "INPUT_TOKEN",
        per: 1_000_000,
        currency: "USD",
        sourceUrl: "https://openai.com/pricing",
        note: "New list price",
        createdById: "staff-1",
      });
      // A date-only effective date is the start of that UTC day.
      expect(data.effectiveFrom).toEqual(new Date("2026-11-01T00:00:00Z"));
      expect(data.price).toBeInstanceOf(Prisma.Decimal);
      expect(data.price.toFixed()).toBe("0.00000012");

      expect(out).toMatchObject({
        id: "new-id",
        price: "0.00000012",
        effectiveFrom: "2026-11-01T00:00:00.000Z",
      });
      expect(tracer.logAuditEvent).toHaveBeenCalledWith(
        "new-id",
        "PRICE_ADDED",
        expect.objectContaining({
          request: expect.objectContaining({
            provider: "openai",
            price: "0.00000012",
            effectiveFrom: "2026-11-01T00:00:00.000Z",
          }),
          response: { priceId: "new-id", userId: "staff-1" },
        }),
      );
      expect(catalog.invalidate).toHaveBeenCalledTimes(1);
    });

    it("stores an empty note as null", async () => {
      const { svc, prisma } = build();
      prisma.providerPrice.create.mockImplementation(({ data }) =>
        Promise.resolve(price(data)),
      );

      await svc.create({ ...dto, note: "" }, user);

      expect(
        prisma.providerPrice.create.mock.calls[0]![0].data.note,
      ).toBeNull();
    });

    it("answers 409 for a duplicate start and changes nothing else", async () => {
      const { svc, prisma, catalog, tracer } = build();
      prisma.providerPrice.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
          code: "P2002",
          clientVersion: "7.3.0",
        }),
      );

      await expect(svc.create(dto, user)).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(tracer.logAuditEvent).not.toHaveBeenCalled();
      expect(catalog.invalidate).not.toHaveBeenCalled();
    });

    it("rethrows any other database error", async () => {
      const { svc, prisma, catalog } = build();
      prisma.providerPrice.create.mockRejectedValue(
        new Error("connection lost"),
      );

      await expect(svc.create(dto, user)).rejects.toThrow("connection lost");
      expect(catalog.invalidate).not.toHaveBeenCalled();
    });
  });
});
