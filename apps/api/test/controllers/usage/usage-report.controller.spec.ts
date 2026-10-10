import { EventEmitter } from "events";
import { BadRequestException } from "@nestjs/common";

import { PERMISSION_KEY } from "../../../src/decorators/require-permission.decorator";
import { UsageReportController } from "../../../src/modules/usage/usage-report.controller";
import {
  usageQuerySchema,
  usageRankQuerySchema,
} from "../../../src/models/usage.dto";
import { ZodValidationPipe } from "../../../src/pipes/zod-validation.pipe";

const user = { id: "staff-1" } as never;
const query = { from: "2026-10-01", to: "2026-10-31" };

function build() {
  const reports = {
    getSummary: jest.fn().mockResolvedValue({ kind: "summary" }),
    getTimeseries: jest.fn().mockResolvedValue({ kind: "timeseries" }),
    getOrganizations: jest.fn().mockResolvedValue({ kind: "orgs" }),
    getAgents: jest.fn().mockResolvedValue({ kind: "agents" }),
    getUnitEconomics: jest.fn().mockResolvedValue({ kind: "unit" }),
    getConversation: jest.fn().mockResolvedValue({ kind: "conversation" }),
    prepareExport: jest.fn(),
  };
  const controller = new UsageReportController(reports as never);
  return { controller, reports };
}

/** A minimal express Response: records writes, can simulate backpressure. */
function fakeResponse(opts: { backpressure?: boolean } = {}) {
  const res = new EventEmitter() as EventEmitter & Record<string, unknown>;
  const headers: Record<string, string> = {};
  const chunks: string[] = [];
  Object.assign(res, {
    writableEnded: false,
    destroyed: false,
    setHeader: (k: string, v: string) => (headers[k] = v),
    write: jest.fn((chunk: string) => {
      chunks.push(chunk);
      if (opts.backpressure) {
        setImmediate(() => res.emit("drain"));
        return false;
      }
      return true;
    }),
    end: jest.fn(() => (res.writableEnded = true)),
    destroy: jest.fn(() => (res.destroyed = true)),
  });
  return { res, headers, chunks };
}

async function* gen(chunks: string[], fail?: Error): AsyncGenerator<string> {
  for (const c of chunks) yield c;
  if (fail) throw fail;
}

describe("UsageReportController", () => {
  it("guards every route with Usage:Read", () => {
    const routes = [
      "getSummary",
      "getTimeseries",
      "getOrganizations",
      "getAgents",
      "getUnitEconomics",
      "getConversation",
      "exportCsv",
    ] as const;
    for (const route of routes) {
      const handler = UsageReportController.prototype[
        route
      ] as unknown as object;
      expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toEqual({
        resource: "Usage",
        action: "Read",
      });
    }
  });

  it("delegates each report to the service with the parsed query", async () => {
    const { controller, reports } = build();

    await expect(controller.getSummary(query)).resolves.toEqual({
      kind: "summary",
    });
    await expect(
      controller.getTimeseries({ ...query, granularity: "day" }),
    ).resolves.toEqual({ kind: "timeseries" });
    await expect(
      controller.getOrganizations({ ...query, limit: 10 }),
    ).resolves.toEqual({ kind: "orgs" });
    await expect(
      controller.getAgents({ ...query, limit: 10 }),
    ).resolves.toEqual({
      kind: "agents",
    });
    await expect(controller.getUnitEconomics(query)).resolves.toEqual({
      kind: "unit",
    });
    await expect(controller.getConversation("s-1")).resolves.toEqual({
      kind: "conversation",
    });

    expect(reports.getSummary).toHaveBeenCalledWith(query);
    expect(reports.getOrganizations).toHaveBeenCalledWith({
      ...query,
      limit: 10,
    });
    expect(reports.getConversation).toHaveBeenCalledWith("s-1");
  });

  describe("query validation", () => {
    const pipe = new ZodValidationPipe(usageQuerySchema);

    it("requires a date range", () => {
      expect(() => pipe.transform({})).toThrow(BadRequestException);
      expect(() => pipe.transform({ from: "2026-10-01" })).toThrow(
        BadRequestException,
      );
    });

    it("rejects a range that ends before it starts or spans over a year", () => {
      expect(() =>
        pipe.transform({ from: "2026-10-05", to: "2026-10-01" }),
      ).toThrow(BadRequestException);
      expect(() =>
        pipe.transform({ from: "2025-01-01", to: "2026-10-01" }),
      ).toThrow(BadRequestException);
    });

    it("rejects a local time with no offset and unknown enum values", () => {
      expect(() =>
        pipe.transform({ from: "2026-10-01T00:00", to: "2026-10-02" }),
      ).toThrow(BadRequestException);
      expect(() => pipe.transform({ ...query, feature: "DROP" })).toThrow(
        BadRequestException,
      );
      expect(() => pipe.transform({ ...query, organizationId: "x" })).toThrow(
        BadRequestException,
      );
    });

    it("accepts a full filter set and lower-cases the provider", () => {
      expect(
        pipe.transform({
          from: "2026-10-01T00:00:00Z",
          to: "2026-10-02T00:00:00+05:30",
          provider: " OpenAI ",
          feature: "STT",
          channel: "VOICE",
          billedTo: "CLIENT",
        }),
      ).toMatchObject({
        provider: "openai",
        feature: "STT",
        billedTo: "CLIENT",
      });
    });

    it("defaults and caps the ranking limit", () => {
      const rank = new ZodValidationPipe(usageRankQuerySchema);
      expect(rank.transform(query)).toMatchObject({ limit: 50 });
      expect(() => rank.transform({ ...query, limit: "500" })).toThrow(
        BadRequestException,
      );
    });
  });

  describe("exportCsv", () => {
    it("sends a no-store CSV attachment and every chunk", async () => {
      const { controller, reports } = build();
      reports.prepareExport.mockReturnValue({
        filename: "usage-2026-10-01-to-2026-10-31.csv",
        stream: gen(["header\r\n", "row\r\n"]),
      });
      const { res, headers, chunks } = fakeResponse();

      await controller.exportCsv(query, user, res as never);

      expect(reports.prepareExport).toHaveBeenCalledWith(query, user);
      expect(headers["Content-Type"]).toBe("text/csv; charset=utf-8");
      expect(headers["Content-Disposition"]).toBe(
        'attachment; filename="usage-2026-10-01-to-2026-10-31.csv"',
      );
      expect(headers["Cache-Control"]).toBe("no-store");
      expect(chunks).toEqual(["header\r\n", "row\r\n"]);
      expect(res.end).toHaveBeenCalled();
    });

    it("waits for drain under backpressure", async () => {
      const { controller, reports } = build();
      reports.prepareExport.mockReturnValue({
        filename: "u.csv",
        stream: gen(["a", "b", "c"]),
      });
      const { res, chunks } = fakeResponse({ backpressure: true });

      await controller.exportCsv(query, user, res as never);

      expect(chunks).toEqual(["a", "b", "c"]);
      expect(res.end).toHaveBeenCalled();
    });

    it("stops reading when the client has gone, so the stream can close and audit", async () => {
      const { controller, reports } = build();
      let closed = false;
      async function* stream(): AsyncGenerator<string> {
        try {
          yield "a";
          yield "b";
          yield "c";
        } finally {
          closed = true;
        }
      }
      reports.prepareExport.mockReturnValue({
        filename: "u.csv",
        stream: stream(),
      });
      const { res, chunks } = fakeResponse();
      (res.write as jest.Mock).mockImplementation((chunk: string) => {
        chunks.push(chunk);
        res.destroyed = true; // hung up after the first chunk
        return true;
      });

      await controller.exportCsv(query, user, res as never);

      expect(chunks).toEqual(["a"]);
      expect(closed).toBe(true);
    });

    it("does not hang when the client hangs up during backpressure", async () => {
      const { controller, reports } = build();
      reports.prepareExport.mockReturnValue({
        filename: "u.csv",
        stream: gen(["a", "b"]),
      });
      const { res, chunks } = fakeResponse();
      (res.write as jest.Mock).mockImplementation((chunk: string) => {
        chunks.push(chunk);
        setImmediate(() => {
          res.destroyed = true;
          res.emit("close");
        });
        return false; // no 'drain' will ever come
      });

      await controller.exportCsv(query, user, res as never);

      expect(chunks).toEqual(["a"]);
    });

    it("cuts the connection when the stream fails after headers were sent", async () => {
      const { controller, reports } = build();
      reports.prepareExport.mockReturnValue({
        filename: "u.csv",
        stream: gen(["header"], new Error("db gone")),
      });
      const { res } = fakeResponse();

      await controller.exportCsv(query, user, res as never);

      expect(res.destroy).toHaveBeenCalled();
      expect(res.end).not.toHaveBeenCalled();
    });
  });
});
