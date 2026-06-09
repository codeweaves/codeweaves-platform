import type { WhatsappConfigService } from '../../../src/modules/whatsapp/whatsapp-config.service';
import {
  WhatsappSendService,
  toWhatsappAudioMime,
} from '../../../src/modules/whatsapp/whatsapp-send.service';

describe('toWhatsappAudioMime', () => {
  it('maps audio/mp3 -> audio/mpeg (the ElevenLabs label bug)', () => {
    expect(toWhatsappAudioMime('audio/mp3')).toBe('audio/mpeg');
    expect(toWhatsappAudioMime('audio/mpeg')).toBe('audio/mpeg');
  });

  it('maps opus -> audio/ogg and keeps ogg/aac', () => {
    expect(toWhatsappAudioMime('audio/opus')).toBe('audio/ogg');
    expect(toWhatsappAudioMime('audio/ogg')).toBe('audio/ogg');
    expect(toWhatsappAudioMime('audio/aac')).toBe('audio/aac');
  });
});

describe('WhatsappSendService', () => {
  const config = {
    graphBaseUrl: 'https://graph.facebook.com/v21.0',
  } as unknown as WhatsappConfigService;

  let service: WhatsappSendService;
  const originalFetch = global.fetch;

  beforeEach(() => {
    service = new WhatsappSendService(config);
  });

  afterEach(() => {
    global.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  describe('sendText', () => {
    it('posts the right payload and returns the sent message id', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.out' }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const id = await service.sendText('PNID', 'token', '15551234567', 'hello');

      expect(id).toBe('wamid.out');
      expect(fetchMock).toHaveBeenCalledWith(
        'https://graph.facebook.com/v21.0/PNID/messages',
        expect.objectContaining({ method: 'POST' }),
      );
      const opts = fetchMock.mock.calls[0][1];
      expect(opts.headers.Authorization).toBe('Bearer token');
      expect(JSON.parse(opts.body)).toMatchObject({
        messaging_product: 'whatsapp',
        to: '15551234567',
        type: 'text',
        text: { body: 'hello' },
      });
    });

    it('throws on a non-2xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      }) as unknown as typeof fetch;

      await expect(
        service.sendText('PNID', 'token', '15551234567', 'hi'),
      ).rejects.toThrow(/401/);
    });

    it('returns null when the response omits a message id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      expect(await service.sendText('PNID', 'token', '1555', 'hi')).toBeNull();
    });
  });

  describe('markReadAndShowTyping', () => {
    it('swallows network errors (best-effort)', async () => {
      global.fetch = jest
        .fn()
        .mockRejectedValue(new Error('network')) as unknown as typeof fetch;

      await expect(
        service.markReadAndShowTyping('PNID', 'token', 'wamid.in'),
      ).resolves.toBeUndefined();
    });

    it('sends a read + typing_indicator payload', async () => {
      const fetchMock = jest.fn().mockResolvedValue({ ok: true });
      global.fetch = fetchMock as unknown as typeof fetch;

      await service.markReadAndShowTyping('PNID', 'token', 'wamid.in');

      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: 'wamid.in',
        typing_indicator: { type: 'text' },
      });
    });
  });

  describe('uploadMedia', () => {
    it('posts multipart to /media and returns the media id', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ id: 'media-99' }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const id = await service.uploadMedia(
        'PNID',
        'token',
        Buffer.from('audiobytes'),
        'audio/mpeg',
      );

      expect(id).toBe('media-99');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://graph.facebook.com/v21.0/PNID/media',
      );
      const opts = fetchMock.mock.calls[0][1];
      expect(opts.method).toBe('POST');
      expect(opts.headers.Authorization).toBe('Bearer token');
      // Multipart body — Content-Type must NOT be set manually (fetch adds boundary).
      expect(opts.headers['Content-Type']).toBeUndefined();
    });

    it('throws when the upload returns no id', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      await expect(
        service.uploadMedia('PNID', 'token', Buffer.from('x'), 'audio/mpeg'),
      ).rejects.toThrow(/no id/i);
    });
  });

  describe('sendAudio', () => {
    it('sends an audio message with the media id and returns the wamid', async () => {
      const fetchMock = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.aud' }] }),
      });
      global.fetch = fetchMock as unknown as typeof fetch;

      const id = await service.sendAudio('PNID', 'token', '15551234567', 'media-99');

      expect(id).toBe('wamid.aud');
      const body = JSON.parse(fetchMock.mock.calls[0][1].body);
      expect(body).toMatchObject({
        messaging_product: 'whatsapp',
        to: '15551234567',
        type: 'audio',
        audio: { id: 'media-99' },
      });
    });

    it('throws on a non-2xx response', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 401,
        text: async () => 'no',
      }) as unknown as typeof fetch;

      await expect(
        service.sendAudio('PNID', 'token', '1555', 'media-1'),
      ).rejects.toThrow(/401/);
    });
  });

  describe('downloadMedia', () => {
    it('resolves the media URL then downloads the bytes (both authed)', async () => {
      const fetchMock = jest
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            url: 'https://lookaside/x',
            mime_type: 'audio/ogg',
          }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => new TextEncoder().encode('OGGDATA').buffer,
        });
      global.fetch = fetchMock as unknown as typeof fetch;

      const result = await service.downloadMedia('media-1', 'token');

      expect(result.mimeType).toBe('audio/ogg');
      expect(result.buffer.toString()).toBe('OGGDATA');
      expect(fetchMock.mock.calls[0][0]).toBe(
        'https://graph.facebook.com/v21.0/media-1',
      );
      expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe('Bearer token');
      expect(fetchMock.mock.calls[1][0]).toBe('https://lookaside/x');
      expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer token');
    });

    it('throws when the media lookup fails', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 404,
        text: async () => 'nope',
      }) as unknown as typeof fetch;

      await expect(service.downloadMedia('media-1', 'token')).rejects.toThrow(/404/);
    });

    it('throws when the lookup returns no URL', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({}),
      }) as unknown as typeof fetch;

      await expect(service.downloadMedia('media-1', 'token')).rejects.toThrow(
        /no URL/i,
      );
    });
  });
});
