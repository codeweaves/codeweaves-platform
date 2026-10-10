import { NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { UsageReportService } from "../../../src/modules/usage/usage-report.service";

type Responder = [RegExp, unknown[]];

/**
 * A `$queryRaw` stand-in. It rebuilds the tagged-template call into a real
 * `Prisma.Sql`, records it (so tests can assert on the SQL text and bound
 * values), and answers with the first responder whose pattern matches.
 */
function makePrisma(responders: Responder[]) {
  const calls: Prisma.Sql[] = [];
  const $queryRaw = jest.fn(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = Prisma.sql(strings, ...values);
      calls.push(sql);
      const hit = responders.find(([re]) => re.test(sql.text));
      return Promise.resolve(hit ? hit[1] : []);
    },
  );
  return { prisma: { $queryRaw }, calls };
}

const FX_LATEST = /FROM "fx_rates" f\s+ORDER BY f\."date" DESC\s+LIMIT 1/;
const FX_ROW = [{ date: "2026-10-09", rate: 84 }];
const DAILY = /to_char\(r\."occurredAt"::date/;

const agg = (over: Record<string, unknown> = {}) => ({
  row_count: 0,
  unpriced_count: 0,
  client_rows: 0,
  inr: null,
  usd: null,
  inr_native: null,
  client_inr: null,
  client_usd: null,
  client_inr_native: null,
  ...over,
});

const tracer = () => ({
  logAuditEvent: jest.fn().mockResolvedValue(undefined),
});

const user = { id: "staff-1" } as never;

const range = { from: "2026-10-01", to: "2026-10-03" } as const;

function build(responders: Responder[]) {
  const { prisma, calls } = makePrisma(responders);
  const t = tracer();
  const svc = new UsageReportService(prisma as never, t as never);
  return { svc, calls, tracer: t, prisma };
}

describe("UsageReportService", () => {
  describe("getSummary", () => {
    const responders = (fx: unknown[]): Responder[] => [
      [FX_LATEST, fx],
      [
        /qs_provider/,
        [
          {
            ...agg({
              row_count: 10,
              unpriced_count: 2,
              client_rows: 1,
              inr: 120.5,
              usd: 1.2,
              inr_native: 20,
              client_inr: 0.78,
              client_inr_native: 0.78,
            }),
            conversations: 3,
            qs_provider: 7,
            qs_measured: 2,
            qs_estimated: 1,
          },
        ],
      ],
      [
        /GROUP BY r\."provider", r\."model"/,
        [
          {
            provider: "openai",
            model: "gpt-4.1-mini",
            ...agg({ row_count: 6, inr: 100.5, usd: 1.2 }),
            input_tokens: 5000,
            output_tokens: 700,
            audio_seconds: null,
            characters: null,
            units: null,
          },
        ],
      ],
      [
        /GROUP BY r\."feature"/,
        [
          { feature: "CHAT", ...agg({ row_count: 4, inr: 80 }) },
          { feature: "SUMMARY", ...agg({ row_count: 2, inr: 20.5 }) },
          { feature: "STT", ...agg({ row_count: 1, inr: 12 }) },
          { feature: "VOICE_PREVIEW", ...agg({ row_count: 1, inr: 8 }) },
          {
            feature: "WHATSAPP_MESSAGE",
            ...agg({ row_count: 1, client_rows: 1, client_inr: 0.78 }),
          },
        ],
      ],
      [
        /GROUP BY r\."channel"/,
        [{ channel: "WIDGET", ...agg({ row_count: 9, inr: 120.5 }) }],
      ],
    ];

    it("returns totals, sources and breakdowns with platform and client cost apart", async () => {
      const { svc } = build(responders(FX_ROW));

      const out = await svc.getSummary(range);

      expect(out.range).toEqual({
        from: "2026-10-01T00:00:00.000Z",
        to: "2026-10-04T00:00:00.000Z",
      });
      expect(out.fx).toEqual({
        available: true,
        latestDate: "2026-10-09",
        latestUsdToInr: 84,
      });
      expect(out.totals).toEqual({
        rows: 10,
        unpricedRows: 2,
        costInr: 120.5,
        native: { USD: 1.2, INR: 20 },
        clientRows: 1,
        clientCostInr: 0.78,
        clientNative: { USD: 0, INR: 0.78 },
        conversations: 3,
      });
      expect(out.quantitySources).toEqual({
        PROVIDER_REPORTED: 7,
        MEASURED: 2,
        ESTIMATED: 1,
      });
      expect(out.byProviderModel[0]).toMatchObject({
        provider: "openai",
        model: "gpt-4.1-mini",
        costInr: 100.5,
        native: { USD: 1.2, INR: 0 },
        inputTokens: 5000,
        outputTokens: 700,
        audioSeconds: 0,
      });
      expect(out.byChannel).toEqual([
        expect.objectContaining({ channel: "WIDGET", costInr: 120.5 }),
      ]);
    });

    it("rolls features up into LLM, STT, TTS and other, leaving out client pass-through", async () => {
      const { svc } = build(responders(FX_ROW));

      const { byCategory } = await svc.getSummary(range);

      expect(byCategory).toEqual({
        LLM: { rows: 6, costInr: 100.5 },
        STT: { rows: 1, costInr: 12 },
        // Voice previews are text-to-speech spend.
        TTS: { rows: 1, costInr: 8 },
        // The WhatsApp row is billed to the client, so it adds nothing here.
        OTHER: { rows: 0, costInr: 0 },
      });
    });

    it("returns every INR figure as null with a flag when no exchange rate is stored", async () => {
      const { svc } = build(responders([]));

      const out = await svc.getSummary(range);

      expect(out.fx.available).toBe(false);
      expect(out.totals.costInr).toBeNull();
      expect(out.totals.clientCostInr).toBeNull();
      // Native amounts do not need a rate and are still reported.
      expect(out.totals.native).toEqual({ USD: 1.2, INR: 20 });
      expect(out.byProviderModel[0]!.costInr).toBeNull();
      expect(out.byCategory.LLM.costInr).toBeNull();
    });

    it("converts USD with the stored daily rate, falling back to the earliest one", async () => {
      const { svc, calls } = build(responders(FX_ROW));

      await svc.getSummary(range);

      const sql = calls.find((c) => /qs_provider/.test(c.text))!.text;
      expect(sql).toMatch(
        /x\."date" <= d::date\s+ORDER BY x\."date" DESC LIMIT 1/,
      );
      expect(sql).toMatch(/ORDER BY x\."date" ASC LIMIT 1/);
      expect(sql).toMatch(/WHEN 'USD' THEN u\."cost" \* fx\.rate/);
    });

    it("binds every filter as a parameter and a date-only `to` covers that whole day", async () => {
      const { svc, calls } = build(responders(FX_ROW));

      await svc.getSummary({
        ...range,
        organizationId: "11111111-1111-4111-8111-111111111111",
        agentId: "22222222-2222-4222-8222-222222222222",
        provider: "openai",
        feature: "CHAT",
        channel: "WIDGET",
        billedTo: "PLATFORM",
      });

      const q = calls.find((c) => /qs_provider/.test(c.text))!;
      expect(q.text).toContain('u."organizationId" = $');
      expect(q.text).toContain('u."agentId" = $');
      expect(q.text).toContain('u."provider" = $');
      expect(q.text).toContain('u."feature"::text = $');
      expect(q.text).toContain('u."channel"::text = $');
      expect(q.text).toContain('u."billedTo"::text = $');
      expect(q.values).toEqual(
        expect.arrayContaining([
          "2026-10-01T00:00:00.000Z",
          "2026-10-04T00:00:00.000Z",
          "2026-10-01",
          "2026-10-03",
          "11111111-1111-4111-8111-111111111111",
          "22222222-2222-4222-8222-222222222222",
          "openai",
          "CHAT",
          "WIDGET",
          "PLATFORM",
        ]),
      );
      // No user value is ever spliced into the SQL text.
      expect(q.text).not.toContain("openai");
    });

    it("adds no optional conditions when no filter is given", async () => {
      const { svc, calls } = build(responders(FX_ROW));

      await svc.getSummary(range);

      const q = calls.find((c) => /qs_provider/.test(c.text))!;
      expect(q.text).not.toContain('u."organizationId" =');
      expect(q.text).not.toContain('u."billedTo"::text =');
    });

    it("runs its queries in parallel", async () => {
      const { svc, prisma } = build(responders(FX_ROW));

      let release!: () => void;
      const gate = new Promise<void>((r) => (release = r));
      const original = prisma.$queryRaw.getMockImplementation()!;
      prisma.$queryRaw.mockImplementation((...args: unknown[]) =>
        gate.then(() =>
          original(...(args as [TemplateStringsArray, ...unknown[]])),
        ),
      );

      const pending = svc.getSummary(range);
      await Promise.resolve();
      // All five were issued before any of them resolved.
      expect(prisma.$queryRaw).toHaveBeenCalledTimes(5);
      release();
      await pending;
    });
  });

  describe("getTimeseries", () => {
    it("fills every day of the range and totals each day", async () => {
      const { svc } = build([
        [FX_LATEST, FX_ROW],
        [
          /to_char\(r\."occurredAt"::date/,
          [
            { day: "2026-10-01", feature: "CHAT", inr: 10 },
            { day: "2026-10-01", feature: "STT", inr: 2.5 },
            { day: "2026-10-03", feature: "CHAT", inr: 4 },
          ],
        ],
      ]);

      const out = await svc.getTimeseries({ ...range, granularity: "day" });

      expect(out.features).toEqual(["CHAT", "STT"]);
      expect(out.days).toEqual([
        {
          date: "2026-10-01",
          totalInr: 12.5,
          byFeature: { CHAT: 10, STT: 2.5 },
        },
        { date: "2026-10-02", totalInr: 0, byFeature: {} },
        { date: "2026-10-03", totalInr: 4, byFeature: { CHAT: 4 } },
      ]);
    });

    it("charts our own cost by default and client pass-through only when asked", async () => {
      const a = build([[FX_LATEST, FX_ROW]]);
      await a.svc.getTimeseries({ ...range, granularity: "day" });
      const own = a.calls.find((c) => DAILY.test(c.text))!;
      expect(own.values).toContain("PLATFORM");

      const b = build([[FX_LATEST, FX_ROW]]);
      await b.svc.getTimeseries({
        ...range,
        granularity: "day",
        billedTo: "CLIENT",
      });
      const client = b.calls.find((c) => DAILY.test(c.text))!;
      expect(client.values).toContain("CLIENT");
      expect(client.values).not.toContain("PLATFORM");
    });

    it("returns null totals when no exchange rate is stored", async () => {
      const { svc } = build([
        [FX_LATEST, []],
        [
          /to_char\(r\."occurredAt"::date/,
          [{ day: "2026-10-01", feature: "CHAT", inr: 3 }],
        ],
      ]);

      const out = await svc.getTimeseries({ ...range, granularity: "day" });

      expect(out.days[0]).toEqual({
        date: "2026-10-01",
        totalInr: null,
        byFeature: { CHAT: null },
      });
    });
  });

  describe("rankings", () => {
    const ranked = {
      ...agg({ row_count: 5, inr: 50, usd: 0.5, inr_native: 8 }),
      conversations: 4,
      cost_per_conversation: 12.5,
    };

    it("ranks organizations by INR cost with cost per conversation", async () => {
      const { svc, calls } = build([
        [FX_LATEST, FX_ROW],
        [
          /GROUP BY r\."organizationId", o\."name"/,
          [
            { organization_id: "org-1", organization_name: "Acme", ...ranked },
            {
              organization_id: null,
              organization_name: null,
              ...agg({ row_count: 1, inr: 1 }),
              conversations: 0,
              cost_per_conversation: null,
            },
          ],
        ],
      ]);

      const out = await svc.getOrganizations({ ...range, limit: 25 });

      expect(out.rows[0]).toMatchObject({
        organizationId: "org-1",
        organizationName: "Acme",
        costInr: 50,
        native: { USD: 0.5, INR: 8 },
        conversations: 4,
        costPerConversationInr: 12.5,
      });
      // Platform cost with no organization (e.g. voice previews) is its own row.
      expect(out.rows[1]).toMatchObject({
        organizationId: null,
        conversations: 0,
        costPerConversationInr: null,
      });
      const q = calls.find((c) => /GROUP BY r\."organizationId"/.test(c.text))!;
      expect(q.text).toMatch(/ORDER BY inr DESC NULLS LAST/);
      expect(q.values).toContain(25);
    });

    it("ranks agents with their organization", async () => {
      const { svc } = build([
        [FX_LATEST, FX_ROW],
        [
          /GROUP BY r\."agentId"/,
          [
            {
              agent_id: "agent-1",
              agent_name: "Support",
              organization_id: "org-1",
              organization_name: "Acme",
              ...ranked,
            },
          ],
        ],
      ]);

      const out = await svc.getAgents({ ...range, limit: 50 });

      expect(out.rows).toEqual([
        expect.objectContaining({
          agentId: "agent-1",
          agentName: "Support",
          organizationName: "Acme",
          costPerConversationInr: 12.5,
        }),
      ]);
    });

    it("hides cost per conversation when no exchange rate is stored", async () => {
      const { svc } = build([
        [FX_LATEST, []],
        [
          /GROUP BY r\."agentId"/,
          [
            {
              agent_id: "a",
              agent_name: "A",
              organization_id: null,
              organization_name: null,
              ...ranked,
            },
          ],
        ],
      ]);

      const out = await svc.getAgents({ ...range, limit: 50 });

      expect(out.rows[0]!.costInr).toBeNull();
      expect(out.rows[0]!.costPerConversationInr).toBeNull();
    });
  });

  describe("getConversation", () => {
    const line = (over: Record<string, unknown>) => ({
      id: "l1",
      occurred_at: new Date("2026-10-01T10:00:00Z"),
      organization_id: "org-1",
      organization_name: "Acme",
      agent_id: "agent-1",
      agent_name: "Support",
      channel: "WIDGET",
      feature: "CHAT",
      provider: "openai",
      model: "gpt-4.1-mini",
      quantity_source: "PROVIDER_REPORTED",
      billed_to: "PLATFORM",
      input_tokens: 1000,
      cached_input_tokens: null,
      cache_write_tokens: null,
      output_tokens: 100,
      reasoning_tokens: null,
      audio_seconds: null,
      characters: null,
      units: null,
      cost: 0.01,
      currency: "USD",
      pricing: [
        {
          unit: "INPUT_TOKEN",
          quantity: 1000,
          priceId: "p",
          price: 0.4,
          per: 1e6,
          amount: 0.0004,
        },
      ],
      latency_ms: 900,
      fx_rate: 84,
      fx_date: "2026-10-01",
      inr: 0.84,
      ...over,
    });

    it("lists every line and totals our cost apart from client pass-through", async () => {
      const { svc, calls } = build([
        [FX_LATEST, FX_ROW],
        [
          /WHERE u\."chatSessionId" = /,
          [
            line({}),
            line({
              id: "l2",
              feature: "STT",
              provider: "sarvam",
              currency: "INR",
              cost: 1,
              inr: 1,
              fx_rate: null,
              fx_date: null,
              pricing: null,
            }),
            line({
              id: "l3",
              feature: "WHATSAPP_MESSAGE",
              billed_to: "CLIENT",
              currency: "INR",
              cost: 0.78,
              inr: 0.78,
              fx_rate: null,
            }),
            line({
              id: "l4",
              feature: "CLASSIFIER",
              cost: null,
              inr: null,
              currency: null,
              fx_rate: null,
              pricing: null,
            }),
          ],
        ],
      ]);

      const out = await svc.getConversation(
        "5af6da5e-13fd-4d6c-8f14-58eba2e62115",
      );

      expect(out).toMatchObject({
        chatSessionId: "5af6da5e-13fd-4d6c-8f14-58eba2e62115",
        organizationName: "Acme",
        agentName: "Support",
        clientTotalInr: 0.78,
        unpricedLines: 1,
      });
      // Our cost: the USD line converted plus the INR line; the unpriced line adds nothing.
      expect(out.totalInr).toBeCloseTo(1.84, 10);
      expect(out.lines).toHaveLength(4);
      expect(out.lines[0]).toMatchObject({
        occurredAt: "2026-10-01T10:00:00.000Z",
        cost: 0.01,
        currency: "USD",
        fxRate: 84,
        fxDate: "2026-10-01",
        costInr: 0.84,
      });
      expect(out.lines[0]!.pricing).toHaveLength(1);
      expect(out.lines[1]!.fxRate).toBeNull();
      const q = calls.find((c) => /chatSessionId" = /.test(c.text))!;
      expect(q.values).toContain("5af6da5e-13fd-4d6c-8f14-58eba2e62115");
    });

    it("throws 404 when the conversation has no usage", async () => {
      const { svc } = build([[FX_LATEST, FX_ROW]]);

      await expect(svc.getConversation("missing")).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it("returns null INR when no exchange rate is stored", async () => {
      const { svc } = build([
        [FX_LATEST, []],
        [/WHERE u\."chatSessionId" = /, [line({ inr: null, fx_rate: null })]],
      ]);

      const out = await svc.getConversation("s");

      expect(out.totalInr).toBeNull();
      expect(out.lines[0]!.costInr).toBeNull();
      expect(out.lines[0]!.cost).toBe(0.01);
    });
  });

  describe("getUnitEconomics", () => {
    it("reports per-conversation stats and cost per voice minute", async () => {
      const { svc, calls } = build([
        [FX_LATEST, FX_ROW],
        [
          /per_conv AS/,
          [{ conversations: 40, avg: 3.2, p50: 2.5, p90: 7.75, max: 20 }],
        ],
        [
          /r\."channel" = 'VOICE'/,
          [
            {
              conversations: 5,
              stt_seconds: 600,
              stt_inr: 5,
              tts_inr: 10,
              llm_inr: 15,
              unpriced_count: 1,
            },
          ],
        ],
        [
          /top AS \(/,
          [
            {
              chat_session_id: "s-1",
              organization_name: "Acme",
              agent_name: "Support",
              calls: 9,
              inr: 20,
              last_at: new Date("2026-10-02T09:00:00Z"),
            },
          ],
        ],
      ]);

      const out = await svc.getUnitEconomics(range);

      expect(out.topConversations).toEqual([
        {
          chatSessionId: "s-1",
          organizationName: "Acme",
          agentName: "Support",
          calls: 9,
          costInr: 20,
          lastAt: "2026-10-02T09:00:00.000Z",
        },
      ]);
      const top = calls.find((c) => /top AS \(/.test(c.text))!;
      expect(top.values).toContain(10);

      expect(out.perConversation).toEqual({
        conversations: 40,
        avgInr: 3.2,
        p50Inr: 2.5,
        p90Inr: 7.75,
        maxInr: 20,
      });
      expect(out.voice).toEqual({
        conversations: 5,
        audioMinutes: 10,
        sttInr: 5,
        ttsInr: 10,
        llmInr: 15,
        totalInr: 30,
        costPerMinuteInr: 3,
        unpricedRows: 1,
      });
      const perConv = calls.find((c) => /per_conv AS/.test(c.text))!;
      expect(perConv.text).toMatch(/percentile_cont\(0\.5\)/);
      expect(perConv.text).toMatch(/percentile_cont\(0\.9\)/);
      // Our own cost by default.
      expect(perConv.values).toContain("PLATFORM");
    });

    it("leaves cost per minute empty while no voice audio is metered", async () => {
      const { svc } = build([
        [FX_LATEST, FX_ROW],
        [
          /per_conv AS/,
          [{ conversations: 0, avg: null, p50: null, p90: null, max: null }],
        ],
        [
          /r\."channel" = 'VOICE'/,
          [
            {
              conversations: 0,
              stt_seconds: null,
              stt_inr: null,
              tts_inr: null,
              llm_inr: null,
              unpriced_count: 0,
            },
          ],
        ],
      ]);

      const out = await svc.getUnitEconomics(range);

      expect(out.voice.audioMinutes).toBe(0);
      expect(out.voice.costPerMinuteInr).toBeNull();
      expect(out.voice.totalInr).toBe(0);
      // An empty set has no median; it must not read as zero rupees.
      expect(out.perConversation.p50Inr).toBeNull();
    });

    it("returns null money without exchange rates", async () => {
      const { svc } = build([
        [FX_LATEST, []],
        [/per_conv AS/, [{ conversations: 2, avg: 1, p50: 1, p90: 1, max: 1 }]],
        [
          /r\."channel" = 'VOICE'/,
          [
            {
              conversations: 1,
              stt_seconds: 60,
              stt_inr: 1,
              tts_inr: 1,
              llm_inr: 1,
              unpriced_count: 0,
            },
          ],
        ],
      ]);

      const out = await svc.getUnitEconomics(range);

      expect(out.perConversation.avgInr).toBeNull();
      expect(out.voice.totalInr).toBeNull();
      expect(out.voice.costPerMinuteInr).toBeNull();
      expect(out.voice.audioMinutes).toBe(1);
    });
  });

  describe("prepareExport", () => {
    const csvRowData = (i: number) => ({
      id: `id-${i}`,
      occurred_at: new Date(Date.UTC(2026, 9, 1, 0, 0, i)),
      organization_id: "org-1",
      organization_name: "Acme, Inc",
      agent_id: "agent-1",
      agent_name: "Support",
      chat_session_id: "s-1",
      channel: "WIDGET",
      feature: "CHAT",
      provider: "openai",
      model: "gpt-4.1-mini",
      quantity_source: "PROVIDER_REPORTED",
      billed_to: "PLATFORM",
      input_tokens: 10,
      cached_input_tokens: null,
      cache_write_tokens: null,
      output_tokens: 2,
      reasoning_tokens: null,
      audio_seconds: null,
      characters: null,
      units: null,
      cost: "0.00000480",
      currency: "USD",
      fx_rate: "84.000000",
      inr: "0.000403",
      latency_ms: 700,
    });

    async function drain(stream: AsyncGenerator<string>): Promise<string> {
      let out = "";
      for await (const chunk of stream) out += chunk;
      return out;
    }

    it("streams a header and every row, then audit-logs the export", async () => {
      const { svc, tracer: t } = build([
        [/LIMIT \$\d+\s*$/, [csvRowData(1), csvRowData(2)]],
      ]);

      const { filename, stream } = svc.prepareExport(
        { ...range, organizationId: "11111111-1111-4111-8111-111111111111" },
        user,
      );
      const csv = await drain(stream);

      expect(filename).toBe("usage-2026-10-01-to-2026-10-03.csv");
      const lines = csv.split("\r\n").filter(Boolean);
      expect(lines.length).toBe(3);
      expect(lines[0]).toMatch(/^﻿Occurred at \(UTC\),/);
      // Values with commas are quoted, not split into extra columns.
      expect(lines[1]).toContain('"Acme, Inc"');
      expect(lines[1]).toContain("0.00000480,USD,84.000000,0.000403");
      expect(t.logAuditEvent).toHaveBeenCalledWith(
        "staff-1",
        "USAGE_EXPORTED",
        expect.objectContaining({
          response: { rowCount: 2, truncated: false, userId: "staff-1" },
          request: expect.objectContaining({
            organizationId: "11111111-1111-4111-8111-111111111111",
          }),
        }),
        {
          organizationId: "11111111-1111-4111-8111-111111111111",
          agentId: undefined,
        },
      );
    });

    it("pages with an (occurredAt, id) cursor after a full batch", async () => {
      const full = Array.from({ length: 1000 }, (_, i) => csvRowData(i));
      const { svc, calls } = build([
        [/\(u\."occurredAt", u\."id"\) >/, [csvRowData(5000)]],
        [/LIMIT \$\d+\s*$/, full],
      ]);

      const csv = await drain(svc.prepareExport(range, user).stream);

      expect(csv.split("\r\n").filter(Boolean).length).toBe(1 + 1000 + 1);
      const second = calls[1]!;
      expect(second.text).toMatch(/\(u\."occurredAt", u\."id"\) >/);
      expect(second.values).toEqual(
        expect.arrayContaining([
          full[999]!.occurred_at.toISOString(),
          "id-999",
        ]),
      );
    });

    it("caps a full export at 100,000 rows", () => {
      expect(UsageReportService.EXPORT_MAX_ROWS).toBe(100_000);
    });

    it("stops at the row cap and says so in the file", async () => {
      const cap = UsageReportService.EXPORT_MAX_ROWS;
      UsageReportService.EXPORT_MAX_ROWS = 2500; // keep the test fast
      try {
        const full = Array.from({ length: 1000 }, (_, i) => csvRowData(i));
        const { svc, prisma, tracer: t } = build([[/LIMIT/, full]]);

        const csv = await drain(svc.prepareExport(range, user).stream);

        const lines = csv.split("\r\n").filter(Boolean);
        expect(lines.length).toBe(1 + 2500 + 1);
        expect(lines[lines.length - 1]).toMatch(
          /^Export truncated at 2500 rows/,
        );
        // Stops mid-page: no fourth query after the cap is hit.
        expect(prisma.$queryRaw).toHaveBeenCalledTimes(3);
        expect(t.logAuditEvent.mock.calls[0]![2]).toMatchObject({
          response: { rowCount: 2500, truncated: true },
        });
      } finally {
        UsageReportService.EXPORT_MAX_ROWS = cap;
      }
    });

    it("still audit-logs when the download is abandoned part way", async () => {
      const { svc, tracer: t } = build([[/LIMIT/, [csvRowData(1)]]]);

      const { stream } = svc.prepareExport(range, user);
      await stream.next(); // header only
      await stream.return(undefined);

      expect(t.logAuditEvent).toHaveBeenCalledTimes(1);
      expect(t.logAuditEvent.mock.calls[0]![2]).toMatchObject({
        response: { rowCount: 0, truncated: false },
      });
    });

    it("does not fail the download when the audit write fails", async () => {
      const { svc, tracer: t } = build([[/LIMIT/, [csvRowData(1)]]]);
      t.logAuditEvent.mockRejectedValue(new Error("db down"));

      await expect(
        drain(svc.prepareExport(range, user).stream),
      ).resolves.toContain("Acme, Inc");
    });
  });
});
