import { FxRateService } from "../../../src/modules/usage/fx-rate.service";

describe("FxRateService", () => {
  const upsert = jest.fn();
  const internalLog = { logCompleted: jest.fn(), logFailed: jest.fn() };
  // traced() runs the call; the real one also writes an event_logs row.
  const providerLog = { traced: jest.fn() };
  const svc = () =>
    new FxRateService(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { fxRate: { upsert } } as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      providerLog as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      internalLog as any,
    );
  let originalFetch: typeof fetch;

  beforeEach(() => {
    jest.clearAllMocks();
    providerLog.traced.mockImplementation(
      (_opts: unknown, fn: () => Promise<unknown>) => fn(),
    );
    originalFetch = global.fetch;
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  const respond = (body: unknown, ok = true, status = 200) => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      json: jest.fn().mockResolvedValue(body),
    }) as unknown as typeof fetch;
  };

  it("stores the day's USD→INR rate, keyed by the rate's own date", async () => {
    respond({ date: "2026-10-10", base: "USD", quote: "INR", rate: 96.64 });
    upsert.mockResolvedValue({});

    await expect(svc().refresh()).resolves.toEqual({
      date: "2026-10-10",
      usdToInr: 96.64,
    });

    const date = new Date("2026-10-10T00:00:00Z");
    expect(upsert).toHaveBeenCalledWith({
      where: { date },
      create: { date, usdToInr: 96.64, source: "frankfurter" },
      update: expect.objectContaining({
        usdToInr: 96.64,
        source: "frankfurter",
      }),
    });
    expect(internalLog.logCompleted).toHaveBeenCalledWith(
      "FX_RATE_RUN_COMPLETED",
      expect.anything(),
    );
  });

  it("rejects a payload that is not USD→INR, and writes nothing", async () => {
    respond({ date: "2026-10-10", base: "EUR", quote: "INR", rate: 100 });
    await expect(svc().refresh()).rejects.toThrow("unexpected FX payload");
    expect(upsert).not.toHaveBeenCalled();
    expect(internalLog.logFailed).toHaveBeenCalled();
  });

  it("fails loudly on an HTTP error so the cron run shows as failed", async () => {
    respond({}, false, 503);
    await expect(svc().refresh()).rejects.toThrow("FX rate HTTP 503");
    expect(upsert).not.toHaveBeenCalled();
  });
});
