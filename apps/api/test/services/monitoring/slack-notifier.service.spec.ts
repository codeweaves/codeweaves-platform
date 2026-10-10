import { ConfigService } from "@nestjs/config";

import { ProviderEventLogger } from "../../../src/common/events/provider.logger";
import type { TracerService } from "../../../src/common/tracer/tracer.service";
import {
  escapeSlack,
  SlackNotifierService,
} from "../../../src/modules/monitoring/slack-notifier.service";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xoxSecretPath";

describe("SlackNotifierService", () => {
  const logEvent = jest.fn();
  let originalFetch: typeof fetch;

  const make = (url: string | undefined) =>
    new SlackNotifierService(
      {
        get: (key: string) =>
          key === "SLACK_ALERTS_WEBHOOK_URL" ? url : undefined,
      } as unknown as ConfigService,
      new ProviderEventLogger({ logEvent } as unknown as TracerService),
    );

  const respond = (ok: boolean, status = ok ? 200 : 400, text = "ok") => {
    global.fetch = jest.fn().mockResolvedValue({
      ok,
      status,
      text: jest.fn().mockResolvedValue(text),
    }) as unknown as typeof fetch;
  };

  const sentBody = () =>
    JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body as string) as {
      text: string;
      blocks: Array<{ fields?: Array<{ text: string }> }>;
    };

  beforeEach(() => {
    originalFetch = global.fetch;
    logEvent.mockResolvedValue(undefined);
  });
  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("is a no-op when the webhook is not set", async () => {
    respond(true);
    const svc = make(undefined);

    expect(svc.isConfigured()).toBe(false);
    await expect(svc.send({ text: "hello" })).resolves.toBe(false);
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("posts text and a fields block, and logs an OUTBOUND SLACK row without the secret path", async () => {
    respond(true);
    const svc = make(WEBHOOK);

    await expect(
      svc.send({
        text: "*Alert*",
        fields: [{ label: "Provider", value: "OPENAI" }],
      }),
    ).resolves.toBe(true);

    expect(global.fetch).toHaveBeenCalledWith(
      WEBHOOK,
      expect.objectContaining({ method: "POST", signal: expect.anything() }),
    );
    const body = sentBody();
    expect(body.text).toBe("*Alert*");
    expect(body.blocks[1]?.fields?.[0]?.text).toBe("*Provider*\nOPENAI");

    const row = logEvent.mock.calls[0][0];
    expect(row).toMatchObject({
      eventName: "SLACK_WEBHOOK_POST_COMPLETED",
      direction: "OUTBOUND",
      provider: "SLACK",
      success: true,
    });
    expect(JSON.stringify(row)).not.toContain("xoxSecretPath");
  });

  it("escapes field labels and values so a name cannot ping the channel", async () => {
    respond(true);
    await make(WEBHOOK).send({
      text: "x",
      fields: [{ label: "Org", value: "<!channel> & co" }],
    });

    expect(sentBody().blocks[1]?.fields?.[0]?.text).toBe(
      "*Org*\n&lt;!channel&gt; &amp; co",
    );
  });

  it("caps the fields block at Slack's limit of 10", async () => {
    respond(true);
    await make(WEBHOOK).send({
      text: "x",
      fields: Array.from({ length: 14 }, (_, i) => ({
        label: `f${i}`,
        value: "v",
      })),
    });

    expect(sentBody().blocks[1]?.fields).toHaveLength(10);
  });

  it("returns false on an HTTP error instead of throwing, and logs the failure", async () => {
    respond(false, 404, "no_service");

    await expect(make(WEBHOOK).send({ text: "x" })).resolves.toBe(false);
    expect(logEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        eventName: "SLACK_WEBHOOK_POST_FAILED",
        success: false,
        errorMessage: expect.stringContaining("Slack HTTP 404"),
      }),
    );
  });

  it("returns false on a network failure or timeout", async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new Error("timeout")) as unknown as typeof fetch;

    await expect(make(WEBHOOK).send({ text: "x" })).resolves.toBe(false);
  });

  it("escapeSlack escapes the three mrkdwn control characters", () => {
    expect(escapeSlack("a<b>&c")).toBe("a&lt;b&gt;&amp;c");
  });
});
