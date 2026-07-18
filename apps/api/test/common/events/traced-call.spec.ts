import { tracedCall } from '../../../src/common/events/traced-call';
import type { TracerService } from '../../../src/common/tracer/tracer.service';

describe('tracedCall', () => {
  const logEvent = jest.fn();
  const tracer = { logEvent } as unknown as TracerService;

  beforeEach(() => jest.clearAllMocks());

  it('emits <base>_COMPLETED with latency + extracted response on success', async () => {
    const result = await tracedCall(
      tracer,
      {
        channel: 'WHATSAPP',
        provider: 'META_WHATSAPP',
        eventBase: 'META_WHATSAPP_SEND_TEXT',
        requestUrl: 'https://graph/…/messages',
        requestPayload: { to: '***4567' },
        extract: (r: string) => ({ responsePayload: { wamid: r } }),
      },
      async () => 'wamid-123',
    );

    expect(result).toBe('wamid-123');
    expect(logEvent).toHaveBeenCalledTimes(1);
    const arg = logEvent.mock.calls[0][0];
    expect(arg.eventName).toBe('META_WHATSAPP_SEND_TEXT_COMPLETED');
    expect(arg.direction).toBe('OUTBOUND');
    expect(arg.success).toBe(true);
    expect(typeof arg.latencyMs).toBe('number');
    expect(arg.responsePayload).toEqual({ wamid: 'wamid-123' });
  });

  it('emits <base>_FAILED and RE-THROWS the original business error', async () => {
    const boom = new Error('429 rate limited');
    await expect(
      tracedCall(
        tracer,
        { channel: 'WIDGET', provider: 'ANTHROPIC', eventBase: 'LLM_STREAM' },
        async () => {
          throw boom;
        },
      ),
    ).rejects.toBe(boom);

    const arg = logEvent.mock.calls[0][0];
    expect(arg.eventName).toBe('LLM_STREAM_FAILED');
    expect(arg.success).toBe(false);
    expect(arg.errorMessage).toBe('429 rate limited');
  });

  it('a throwing extract callback never fails the call nor logs FAILED', async () => {
    const result = await tracedCall(
      tracer,
      {
        channel: 'VOICE',
        provider: 'SARVAM',
        eventBase: 'SARVAM_STT',
        extract: () => {
          throw new Error('extract boom');
        },
      },
      async () => 'ok',
    );
    // The successful call still returns; the event is COMPLETED, not FAILED.
    expect(result).toBe('ok');
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent.mock.calls[0][0].eventName).toBe('SARVAM_STT_COMPLETED');
    expect(logEvent.mock.calls[0][0].success).toBe(true);
  });

  it('does not await the log write — a slow logger never blocks the call', async () => {
    // logEvent's promise never settles; tracedCall must still return promptly
    // because it `void`s the write rather than awaiting it.
    logEvent.mockReturnValue(new Promise<void>(() => undefined));

    const result = await tracedCall(
      tracer,
      { channel: 'VOICE', provider: 'SARVAM', eventBase: 'SARVAM_TTS' },
      async () => 'ok',
    );
    expect(result).toBe('ok');
  });
});
