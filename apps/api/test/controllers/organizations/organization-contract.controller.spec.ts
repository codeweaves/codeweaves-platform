import { BadRequestException } from "@nestjs/common";
import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import { OrganizationContractController } from "../../../src/controllers/organizations/organization-contract.controller";
import { updateOrganizationContractSchema } from "../../../src/models/organization.dto";
import { ZodValidationPipe } from "../../../src/pipes/zod-validation.pipe";

const ORG_ID = "123e4567-e89b-12d3-a456-426614174000";

const contract = {
  contractStartDate: "2026-04-01",
  conversationLimit: 17000,
  conversationLimitSetAt: "2026-11-14T12:00:00.000Z",
  conversationsUsed: 8500,
  conversationsRemaining: 8500,
  percentUsed: 50,
  alerts: [{ threshold: 50, sentAt: "2026-11-14T13:00:00.000Z" }],
};

describe("OrganizationContractController", () => {
  const service = { getContract: jest.fn(), updateContract: jest.fn() };
  const controller = new OrganizationContractController(service as never);

  // resetMocks wipes implementations between tests, so set them per test.
  beforeEach(() => {
    service.getContract.mockResolvedValue(contract);
    service.updateContract.mockResolvedValue(contract);
  });

  // Contract data is platform-only. A route without a permission would be
  // open to any signed-in org user.
  it("gates read and update on the OrganizationContract permissions", () => {
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        OrganizationContractController.prototype.get,
      ),
    ).toEqual({ resource: "OrganizationContract", action: "Read" });
    expect(
      Reflect.getMetadata(
        PERMISSION_KEY,
        OrganizationContractController.prototype.update,
      ),
    ).toEqual({ resource: "OrganizationContract", action: "Update" });
  });

  it("exposes only get and update", () => {
    const methods = Object.getOwnPropertyNames(
      OrganizationContractController.prototype,
    );
    expect(methods.sort()).toEqual(["constructor", "get", "update"]);
  });

  it("returns the contract from the service", async () => {
    await expect(controller.get(ORG_ID)).resolves.toEqual(contract);
    expect(service.getContract).toHaveBeenCalledWith(ORG_ID);
  });

  it("passes the validated body to the service", async () => {
    const dto = { conversationLimit: 17000 };
    await expect(controller.update(ORG_ID, dto)).resolves.toEqual(contract);
    expect(service.updateContract).toHaveBeenCalledWith(ORG_ID, dto);
  });

  describe("body validation", () => {
    const pipe = new ZodValidationPipe(updateOrganizationContractSchema);

    it.each([
      ["a limit", { conversationLimit: 17000 }],
      ["the lowest limit", { conversationLimit: 1 }],
      ["the highest limit", { conversationLimit: 100_000_000 }],
      ["a null limit (remove it)", { conversationLimit: null }],
      ["a start date", { contractStartDate: "2026-04-01" }],
      ["a leap day", { contractStartDate: "2028-02-29" }],
      ["a null start date", { contractStartDate: null }],
      [
        "both fields",
        { contractStartDate: "2026-04-01", conversationLimit: 500 },
      ],
    ])("accepts %s", (_label, body) => {
      expect(pipe.transform(body)).toEqual(body);
    });

    it.each([
      ["an empty body", {}],
      ["only unknown keys", { conversationLimitSetAt: "2026-01-01T00:00:00Z" }],
      ["a zero limit", { conversationLimit: 0 }],
      ["a negative limit", { conversationLimit: -5 }],
      ["a fractional limit", { conversationLimit: 1.5 }],
      ["a limit above the cap", { conversationLimit: 100_000_001 }],
      ["a limit sent as text", { conversationLimit: "17000" }],
      ["a day that does not exist", { contractStartDate: "2026-02-30" }],
      ["February 29 in a non-leap year", { contractStartDate: "2026-02-29" }],
      ["a short month", { contractStartDate: "2026-4-01" }],
      ["a date-time", { contractStartDate: "2026-04-01T00:00:00Z" }],
      ["free text", { contractStartDate: "April 1st" }],
    ])("rejects %s", (_label, body) => {
      expect(() => pipe.transform(body)).toThrow(BadRequestException);
    });

    it("drops keys the client may not set", () => {
      expect(
        pipe.transform({
          conversationLimit: 10,
          conversationLimitSetAt: "2020-01-01T00:00:00Z",
        }),
      ).toEqual({ conversationLimit: 10 });
    });
  });
});
