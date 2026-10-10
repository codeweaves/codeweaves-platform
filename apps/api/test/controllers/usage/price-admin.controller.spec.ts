import { BadRequestException } from "@nestjs/common";

import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import { PriceAdminController } from "../../../src/modules/usage/price-admin.controller";
import { createProviderPriceSchema } from "../../../src/models/usage.dto";
import { ZodValidationPipe } from "../../../src/pipes/zod-validation.pipe";

const user = { id: "staff-1" } as never;

const valid = {
  provider: "openai",
  model: "gpt-4.1-mini",
  unit: "INPUT_TOKEN",
  price: 0.4,
  per: 1_000_000,
  currency: "USD",
  effectiveFrom: "2026-11-01",
  sourceUrl: "https://openai.com/api/pricing",
};

describe("PriceAdminController", () => {
  const prices = { list: jest.fn(), create: jest.fn() };
  const controller = new PriceAdminController(prices as never);

  // resetMocks wipes implementations between tests, so set them per test.
  beforeEach(() => {
    prices.list.mockResolvedValue({ groups: [], missing: [] });
    prices.create.mockResolvedValue({ id: "new" });
  });

  it("lets usage readers see prices but only Price:Create add one", () => {
    expect(
      Reflect.getMetadata(PERMISSION_KEY, PriceAdminController.prototype.list),
    ).toEqual({ resource: "Usage", action: "Read" });
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        PriceAdminController.prototype.create,
      ),
    ).toEqual({ resource: "Price", action: "Create" });
  });

  it("exposes no way to edit or delete a price row", () => {
    const methods = Object.getOwnPropertyNames(PriceAdminController.prototype);
    expect(methods.sort()).toEqual(["constructor", "create", "list"]);
  });

  it("delegates list and create", async () => {
    await expect(controller.list()).resolves.toEqual({
      groups: [],
      missing: [],
    });
    await expect(controller.create(valid as never, user)).resolves.toEqual({
      id: "new",
    });
    expect(prices.create).toHaveBeenCalledWith(valid, user);
  });

  describe("body validation", () => {
    const pipe = new ZodValidationPipe(createProviderPriceSchema);

    it("accepts a valid row, normalising the provider and allowing * as model", () => {
      expect(
        pipe.transform({
          ...valid,
          provider: " Deepgram ",
          model: "*",
          note: "x",
        }),
      ).toMatchObject({ provider: "deepgram", model: "*", note: "x" });
    });

    it.each([
      ["no source URL", { sourceUrl: undefined }],
      ["a non-URL source", { sourceUrl: "pricing page" }],
      ["a non-http source", { sourceUrl: "javascript:alert(1)" }],
      ["a negative price", { price: -1 }],
      ["a price sent as text", { price: "0.4" }],
      ["a zero per-quantity", { per: 0 }],
      ["a fractional per-quantity", { per: 1.5 }],
      ["an unknown unit", { unit: "TOKEN" }],
      ["an unknown currency", { currency: "EUR" }],
      ["a bad date", { effectiveFrom: "next week" }],
      ["a model with spaces", { model: "gpt 4" }],
      ["a provider with symbols", { provider: "open ai!" }],
    ])("rejects %s", (_label, patch) => {
      expect(() => pipe.transform({ ...valid, ...patch })).toThrow(
        BadRequestException,
      );
    });
  });
});
