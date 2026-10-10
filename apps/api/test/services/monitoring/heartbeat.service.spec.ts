import { ConfigService } from "@nestjs/config";

import { ProviderEventLogger } from "../../../src/common/events/provider.logger";
import type { TracerService } from "../../../src/common/tracer/tracer.service";
import { HeartbeatService } from "../../../src/modules/monitoring/heartbeat.service";

const SECRET_URL =
  "https://uptime.betterstack.com/api/v1/heartbeat/s3cretT0ken";

const flush = () => new Promise((r) => setImmediate(r));

describe("HeartbeatService", () => {
  const logEvent = jest.fn();
  let originalFetch: typeof fetch;

  const make = (env: Record<string, string | undefined>) =>
    new HeartbeatService(
      { get: (key: string) => env[key] } as unknown as ConfigService,
      new ProviderEventLogger({ logEvent } as unknown as TracerService),
    );

  const respond = (ok: boolean, status = ok ? 200 : 500) => {
    global.fetch = jest
      .fn()
      .mockResolvedValue({ ok, status }) as unknown as typeof fetch;
  };

  beforeEach(() => {
    originalFetch = global.fetch;
    logEvent.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is a no-op when the job has no heartbeat URL", async () => {
    respond(true);
    make({}).ping("CLASSIFIER");
    await flush();

    expect(global.fetch).not.toHaveBeenCalled();
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("GETs the job's own URL with a timeout and logs an OUTBOUND row without the secret", async () => {
    respond(true);
    make({
      HEARTBEAT_URL_FX: SECRET_URL,
      HEARTBEAT_URL_CLASSIFIER: "https://example.com/other",
    }).ping("FX");
    await flush();

    expect(global.fetch).toHaveBeenCalledTimes(1);
    expect(global.fetch).toHaveBeenCalledWith(
      SECRET_URL,
      expect.objectContaining({ method: "GET", signal: expect.anything() }),
    );
    const row = logEvent.mock.calls[0][0];
    expect(row).toMatchObject({
      eventName: "BETTER_STACK_HEARTBEAT_COMPLETED",
      direction: "OUTBOUND",
      provider: "BETTER_STACK",
      success: true,
      requestPayload: { job: "FX" },
    });
    expect(JSON.stringify(row)).not.toContain("s3cretT0ken");
  });

  it("swallows an HTTP error: never throws, records a failed row", async () => {
    respond(false, 503);
    const svc = make({ HEARTBEAT_URL_ALERTS: SECRET_URL });

    expect(() => svc.ping("ALERTS")).not.toThrow();
    await flush();

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "BETTER_STACK_HEARTBEAT_FAILED",
        success: false,
        errorMessage: "heartbeat HTTP 503",
      }),
    );
  });

  it("swallows a network failure or timeout", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;
    const svc = make({ HEARTBEAT_URL_RETENTION: SECRET_URL });

    expect(() => svc.ping("RETENTION")).not.toThrow();
    await flush();

    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, errorMessage: "timeout" }),
    );
  });

  it("treats a blank env value as unset", async () => {
    respond(true);
    make({ HEARTBEAT_URL_HANDOVER_SWEEP: "   " }).ping("HANDOVER_SWEEP");
    await flush();

    expect(global.fetch).not.toHaveBeenCalled();
  });
});
