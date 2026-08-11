import type { CryptoService } from '../../../src/common/crypto/crypto.service';
import type { DirectChatService } from '../../../src/modules/ai/direct-chat.service';
import type { VoiceService } from '../../../src/modules/voice/voice.service';
import { WhatsappInboundService } from '../../../src/modules/whatsapp/whatsapp-inbound.service';
import type { WhatsappSendService } from '../../../src/modules/whatsapp/whatsapp-send.service';
import type { ChatService } from '../../../src/services/chat.service';
import type { PrismaService } from '../../../src/services/prisma.service';

describe('WhatsappInboundService', () => {
  let prisma: {
    whatsappChannel: { findUnique: jest.Mock };
    agent: { findFirst: jest.Mock };
  };
  let crypto: { decrypt: jest.Mock };
  let chat: {
    resolveOrCreateVisitorSession: jest.Mock;
    saveUserMessage: jest.Mock;
    saveAssistantMessage: jest.Mock;
    updateSessionTimestamp: jest.Mock;
    isPausedForHuman: jest.Mock;
    recordPausedInbound: jest.Mock;
    maybeEscalateToHuman: jest.Mock;
    publishHandoverBotTurn: jest.Mock;
    handoverStallInstruction: jest.Mock;
    buildHumanConnectTool: jest.Mock;
    humanOfferInstruction: jest.Mock;
  };
  let direct: { send: jest.Mock };
  let send: {
    sendText: jest.Mock;
    markReadAndShowTyping: jest.Mock;
    downloadMedia: jest.Mock;
    uploadMedia: jest.Mock;
    sendAudio: jest.Mock;
  };
  let voice: { transcribe: jest.Mock; synthesize: jest.Mock };
  let service: WhatsappInboundService;

  const channel = {
    id: 'c1',
    agentId: 'a1',
    phoneNumberId: 'p1',
    status: 'CONNECTED',
    accessTokenEnc: 'enc',
  };
  const agent = { id: 'a1', status: 'ACTIVE', deletedAt: null, aiConfig: {}, organizationId: 'org-1' };
  const job = {
    phoneNumberId: 'p1',
    from: '15551234567',
    messageId: 'wamid.in',
    type: 'text' as const,
    text: 'hello',
  };
  const okResult = {
    text: 'Hi there!',
    traceId: 't',
    model: 'm',
    cost: 0.01,
    usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
    finishReason: 'stop',
    latencyMs: 100,
  };

  beforeEach(() => {
    prisma = {
      whatsappChannel: { findUnique: jest.fn() },
      agent: { findFirst: jest.fn() },
    };
    crypto = { decrypt: jest.fn().mockReturnValue('token') };
    chat = {
      resolveOrCreateVisitorSession: jest
        .fn()
        .mockResolvedValue({ id: 'sess-db', sessionId: 'wa:p1:15551234567' }),
      saveUserMessage: jest.fn().mockResolvedValue(undefined),
      saveAssistantMessage: jest.fn().mockResolvedValue(undefined),
      updateSessionTimestamp: jest.fn().mockResolvedValue(undefined),
      isPausedForHuman: jest.fn().mockReturnValue(false),
      recordPausedInbound: jest.fn().mockResolvedValue(undefined),
      maybeEscalateToHuman: jest.fn().mockResolvedValue(false),
      publishHandoverBotTurn: jest.fn().mockResolvedValue(undefined),
      handoverStallInstruction: jest.fn().mockReturnValue('A teammate is joining.'),
      buildHumanConnectTool: jest.fn().mockReturnValue({}),
      humanOfferInstruction: jest.fn().mockReturnValue('Offer a human if needed.'),
    };
    direct = { send: jest.fn() };
    send = {
      sendText: jest.fn().mockResolvedValue('wamid.out'),
      markReadAndShowTyping: jest.fn().mockResolvedValue(undefined),
      downloadMedia: jest
        .fn()
        .mockResolvedValue({ buffer: Buffer.from('audio'), mimeType: 'audio/ogg' }),
      uploadMedia: jest.fn().mockResolvedValue('media-out'),
      sendAudio: jest.fn().mockResolvedValue('wamid.aud'),
    };
    voice = {
      transcribe: jest.fn(),
      synthesize: jest
        .fn()
        .mockResolvedValue({ audio: Buffer.from('mp3'), audioFormat: 'audio/mpeg' }),
    };
    service = new WhatsappInboundService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      chat as unknown as ChatService,
      direct as unknown as DirectChatService,
      send as unknown as WhatsappSendService,
      voice as unknown as VoiceService,
      {
        logMessageReceived: () => undefined,
        logReplySent: () => undefined,
        logInboundException: () => undefined,
        logWebhookVerified: () => undefined,
      } as unknown as import('../../../src/common/events/whatsapp.logger').WhatsappEventLogger,
    );
  });

  it('happy path: routes by phoneNumberId, runs the agent, replies, persists', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    direct.send.mockResolvedValue(okResult);

    await service.handleInbound(job);

    expect(send.markReadAndShowTyping).toHaveBeenCalledWith('p1', 'token', 'wamid.in');
    expect(chat.resolveOrCreateVisitorSession).toHaveBeenCalledWith(
      'a1',
      'WHATSAPP',
      '15551234567',
    );
    // 4th arg = organizationId (PII redaction on by default → storage vaults).
    expect(chat.saveUserMessage).toHaveBeenCalledWith('sess-db', 'hello', undefined, 'org-1');
    expect(direct.send).toHaveBeenCalledTimes(1);
    expect(send.sendText).toHaveBeenCalledWith('p1', 'token', '15551234567', 'Hi there!');
    expect(chat.saveAssistantMessage).toHaveBeenCalledTimes(1);
    expect(chat.updateSessionTimestamp).toHaveBeenCalledWith('sess-db');
  });

  it('human handover: suppresses the AI reply when a teammate is handling', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    chat.isPausedForHuman.mockReturnValue(true);

    await service.handleInbound(job);

    // Inbound captured + pushed to the dashboard, but the AI never runs and no
    // WhatsApp reply goes out (no double-reply with the human).
    expect(chat.recordPausedInbound).toHaveBeenCalledTimes(1);
    expect(direct.send).not.toHaveBeenCalled();
    expect(send.sendText).not.toHaveBeenCalled();
    expect(chat.saveUserMessage).not.toHaveBeenCalled();
  });

  it('escalation: when the visitor asks for a human, stalls the bot + pings the dashboard', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    direct.send.mockResolvedValue(okResult);
    // Keyword matched → session raised NONE → REQUESTED this turn.
    chat.maybeEscalateToHuman.mockResolvedValue(true);

    await service.handleInbound({ ...job, text: 'I want to talk to a human' });

    // Bot still answers, but with the "a teammate is joining" stall instruction,
    // and the dashboard is pinged so the WhatsApp turn shows in the live thread.
    expect(chat.maybeEscalateToHuman).toHaveBeenCalledTimes(1);
    expect(direct.send).toHaveBeenCalledWith(
      expect.objectContaining({ extraSystemInstruction: 'A teammate is joining.' }),
    );
    expect(chat.publishHandoverBotTurn).toHaveBeenCalledTimes(1);
  });

  describe('voice notes (audio)', () => {
    const audioJob = {
      phoneNumberId: 'p1',
      from: '15551234567',
      messageId: 'wamid.audio',
      type: 'audio' as const,
      mediaId: 'media-123',
    };

    beforeEach(() => {
      prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
      prisma.agent.findFirst.mockResolvedValue(agent);
      direct.send.mockResolvedValue(okResult);
    });

    it('downloads, transcribes, runs the agent on the transcript, and replies', async () => {
      voice.transcribe.mockResolvedValue({ transcript: 'what are your hours?' });

      await service.handleInbound(audioJob);

      expect(send.downloadMedia).toHaveBeenCalledWith('media-123', 'token');
      expect(voice.transcribe).toHaveBeenCalledWith(
        expect.objectContaining({ audioFormat: 'audio/ogg', agentId: 'a1' }),
      );
      expect(chat.saveUserMessage).toHaveBeenCalledWith(
        'sess-db',
        'what are your hours?',
        undefined,
        'org-1',
      );
      expect(direct.send).toHaveBeenCalledWith(
        expect.objectContaining({ newUserMessage: 'what are your hours?' }),
      );
      expect(send.sendText).toHaveBeenCalledWith(
        'p1',
        'token',
        '15551234567',
        'Hi there!',
      );
    });

    it('asks the user to retry when transcription throws', async () => {
      voice.transcribe.mockRejectedValue(new Error('stt down'));

      await service.handleInbound(audioJob);

      expect(send.sendText).toHaveBeenCalledWith(
        'p1',
        'token',
        '15551234567',
        expect.stringMatching(/voice note/i),
      );
      expect(direct.send).not.toHaveBeenCalled();
      expect(chat.saveUserMessage).not.toHaveBeenCalled();
    });

    it('asks the user to retry when the transcript is empty', async () => {
      voice.transcribe.mockResolvedValue({ transcript: '   ' });

      await service.handleInbound(audioJob);

      expect(send.sendText).toHaveBeenCalledWith(
        'p1',
        'token',
        '15551234567',
        expect.stringMatching(/voice note/i),
      );
      expect(direct.send).not.toHaveBeenCalled();
    });

    it('replies with a voice note when voiceReplyEnabled and inbound is audio', async () => {
      prisma.whatsappChannel.findUnique.mockResolvedValue({
        ...channel,
        voiceReplyEnabled: true,
      });
      voice.transcribe.mockResolvedValue({
        transcript: 'hello',
        detectedLanguage: 'en',
      });

      await service.handleInbound(audioJob);

      expect(voice.synthesize).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'en', agentId: 'a1' }),
      );
      expect(send.uploadMedia).toHaveBeenCalled();
      expect(send.sendAudio).toHaveBeenCalledWith(
        'p1',
        'token',
        '15551234567',
        'media-out',
      );
      expect(send.sendText).not.toHaveBeenCalled();
      const meta = chat.saveAssistantMessage.mock.calls[0][2];
      expect(meta.replyMode).toBe('voice');
      // Tagged like the widget so the conversations UI shows the "Voice" badge.
      expect(meta.inputType).toBe('voice');
      // Detected language from STT is persisted (matches widget voice metadata).
      expect(meta.detectedLanguage).toBe('en');
    });

    it('falls back to text when the voice reply path fails', async () => {
      prisma.whatsappChannel.findUnique.mockResolvedValue({
        ...channel,
        voiceReplyEnabled: true,
      });
      voice.transcribe.mockResolvedValue({
        transcript: 'hello',
        detectedLanguage: 'en',
      });
      voice.synthesize.mockRejectedValue(new Error('tts down'));

      await service.handleInbound(audioJob);

      expect(send.sendText).toHaveBeenCalled();
      const meta = chat.saveAssistantMessage.mock.calls[0][2];
      expect(meta.replyMode).toBe('text');
    });
  });

  it('drops the message when no channel matches the phoneNumberId', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(null);

    await service.handleInbound(job);

    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
    expect(send.sendText).not.toHaveBeenCalled();
  });

  it('drops the message when the channel is not CONNECTED', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue({
      ...channel,
      status: 'DISCONNECTED',
    });

    await service.handleInbound(job);

    expect(prisma.agent.findFirst).not.toHaveBeenCalled();
  });

  it('drops the message when the agent is missing or inactive', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(null);

    await service.handleInbound(job);

    expect(direct.send).not.toHaveBeenCalled();
    expect(send.sendText).not.toHaveBeenCalled();
  });

  it('sends a fallback reply (and does not persist) when orchestration throws', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    direct.send.mockRejectedValue(new Error('llm down'));

    await service.handleInbound(job);

    expect(send.sendText).toHaveBeenCalledWith(
      'p1',
      'token',
      '15551234567',
      expect.stringMatching(/trouble/i),
    );
    expect(chat.saveAssistantMessage).not.toHaveBeenCalled();
  });

  it('skips sending + persisting when the reply is empty', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    direct.send.mockResolvedValue({ ...okResult, text: '   ' });

    await service.handleInbound(job);

    expect(send.sendText).not.toHaveBeenCalled();
    expect(chat.saveAssistantMessage).not.toHaveBeenCalled();
  });

  it('still persists the reply when WhatsApp delivery fails', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channel);
    prisma.agent.findFirst.mockResolvedValue(agent);
    direct.send.mockResolvedValue(okResult);
    send.sendText.mockRejectedValue(new Error('graph 500'));

    await service.handleInbound(job);

    expect(chat.saveAssistantMessage).toHaveBeenCalledTimes(1);
    expect(chat.updateSessionTimestamp).toHaveBeenCalledWith('sess-db');
  });
});
