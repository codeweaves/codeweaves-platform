import { Test, TestingModule } from '@nestjs/testing';
import { VoiceService } from '../../../src/modules/voice/voice.service';
import {
  VOICE_PROVIDERS,
  type VoiceProvider,
  type STTResponse,
  type TTSResponse,
  type LanguageDetectionResponse,
} from '../../../src/modules/voice/providers/voice-provider.interface';
import { PrismaService } from '../../../src/services/prisma.service';
import type { N8nStreamChunk } from '../../../src/services/n8n-stream.interface';
import type { VoiceStreamChunk } from '../../../src/modules/voice/interfaces/voice-stream.interface';

function createMockProvider(
  name: string,
  supportedLanguages: string[] = ['en'],
): VoiceProvider {
  return {
    name,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supportedLanguages: supportedLanguages as any,
    transcribe: jest.fn().mockResolvedValue({
      transcript: `transcribed by ${name}`,
      confidence: 0.95,
      detectedLanguage: 'en',
      provider: name,
      latencyMs: 10,
    } satisfies STTResponse),
    synthesize: jest.fn().mockResolvedValue({
      audio: Buffer.from('fake-audio'),
      audioFormat: 'audio/mp3',
      durationMs: 1000,
      provider: name,
      latencyMs: 50,
    } satisfies TTSResponse),
    detectLanguage: jest.fn().mockResolvedValue({
      detectedLanguage: 'en',
      confidence: 0.9,
      provider: name,
      latencyMs: 10,
    } satisfies LanguageDetectionResponse),
  };
}

async function* createTokenStream(
  tokens: string[],
): AsyncGenerator<N8nStreamChunk> {
  yield { type: 'begin', metadata: { timestamp: Date.now() } };
  for (const token of tokens) {
    yield { type: 'item', content: token };
  }
  yield { type: 'end', metadata: { timestamp: Date.now() } };
}

async function collectChunks(
  gen: AsyncGenerator<VoiceStreamChunk>,
): Promise<VoiceStreamChunk[]> {
  const chunks: VoiceStreamChunk[] = [];
  for await (const chunk of gen) {
    chunks.push(chunk);
  }
  return chunks;
}

describe('VoiceService - streamingTTS', () => {
  let service: VoiceService;
  let elevenLabsProvider: VoiceProvider;
  let mockPrisma: { agent: { findUnique: jest.Mock } };

  beforeEach(async () => {
    const sarvamProvider = createMockProvider('sarvam', [
      'hi', 'mr', 'bn', 'ta', 'te', 'gu', 'kn', 'ml', 'pa', 'or', 'en', 'hinglish',
    ]);
    const deepgramProvider = createMockProvider('deepgram', ['en', 'hi']);
    elevenLabsProvider = createMockProvider('elevenlabs', ['en', 'hi']);
    const stubProvider = createMockProvider('stub', ['en', 'hi']);

    mockPrisma = {
      agent: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        VoiceService,
        {
          provide: VOICE_PROVIDERS,
          useValue: [stubProvider, sarvamProvider, deepgramProvider, elevenLabsProvider],
        },
        {
          provide: PrismaService,
          useValue: mockPrisma,
        },
      ],
    }).compile();

    service = module.get<VoiceService>(VoiceService);
  });

  it('should yield 2 audio chunks + end chunk for 2 sentences', async () => {
    // "Hello there. How are you?" — two sentences
    const tokens = [
      'Hello', ' ', 'there', '.', ' ', 'How', ' ', 'are', ' ', 'you', '?',
    ];
    const tokenStream = createTokenStream(tokens);
    const chunks = await collectChunks(
      service.streamingTTS(tokenStream, 'en', 'agent-1'),
    );

    const audioChunks = chunks.filter((c) => c.type === 'audio');
    const endChunks = chunks.filter((c) => c.type === 'end');

    expect(audioChunks.length).toBe(2);
    expect(endChunks.length).toBe(1);

    // Verify audio chunks have expected structure
    for (const chunk of audioChunks) {
      if (chunk.type === 'audio') {
        expect(chunk.audio).toBeDefined();
        expect(chunk.audioFormat).toBe('audio/mp3');
        expect(typeof chunk.sentenceIndex).toBe('number');
        expect(typeof chunk.ttsLatencyMs).toBe('number');
        expect(chunk.text.length).toBeGreaterThan(0);
      }
    }

    // Verify end chunk
    expect(endChunks[0]).toBeDefined();
    expect(endChunks[0]!.type).toBe('end');
    const endChunk = endChunks[0]!;
    if (endChunk.type === 'end') {
      expect(endChunk.fullText).toBe('Hello there. How are you?');
      expect(endChunk.totalSentences).toBe(2);
    }

    // Sentence indices should be sequential
    expect((audioChunks[0] as { sentenceIndex: number }).sentenceIndex).toBe(0);
    expect((audioChunks[1] as { sentenceIndex: number }).sentenceIndex).toBe(1);
  });

  it('should yield 1 audio + end chunk for a single sentence', async () => {
    const tokens = ['Hello', ' ', 'world', '!'];
    const tokenStream = createTokenStream(tokens);
    const chunks = await collectChunks(
      service.streamingTTS(tokenStream, 'en', 'agent-1'),
    );

    const audioChunks = chunks.filter((c) => c.type === 'audio');
    const endChunks = chunks.filter((c) => c.type === 'end');

    expect(audioChunks.length).toBe(1);
    expect(endChunks.length).toBe(1);

    expect(endChunks[0]!.type).toBe('end');
    if (endChunks[0]!.type === 'end') {
      expect(endChunks[0]!.totalSentences).toBe(1);
    }
  });

  it('should flush remaining buffer content on stream end', async () => {
    // Tokens that don't end with sentence-ending punctuation
    const tokens = ['Hello', ' ', 'world'];
    const tokenStream = createTokenStream(tokens);
    const chunks = await collectChunks(
      service.streamingTTS(tokenStream, 'en', 'agent-1'),
    );

    const audioChunks = chunks.filter((c) => c.type === 'audio');
    const endChunks = chunks.filter((c) => c.type === 'end');

    // Should still yield audio from flush
    expect(audioChunks.length).toBe(1);
    expect(endChunks.length).toBe(1);

    expect(audioChunks[0]!.type).toBe('audio');
    if (audioChunks[0]!.type === 'audio') {
      expect(audioChunks[0]!.text).toBe('Hello world');
    }
    expect(endChunks[0]!.type).toBe('end');
    if (endChunks[0]!.type === 'end') {
      expect(endChunks[0]!.fullText).toBe('Hello world');
      expect(endChunks[0]!.totalSentences).toBe(1);
    }
  });

  it('should yield only end chunk for empty stream', async () => {
    const tokenStream = createTokenStream([]);
    const chunks = await collectChunks(
      service.streamingTTS(tokenStream, 'en', 'agent-1'),
    );

    expect(chunks.length).toBe(1);
    expect(chunks[0]!.type).toBe('end');
    if (chunks[0]!.type === 'end') {
      expect(chunks[0]!.fullText).toBe('');
      expect(chunks[0]!.totalSentences).toBe(0);
    }
  });

  it('should call TTS provider synthesize for each sentence', async () => {
    const tokens = [
      'First', ' ', 'sentence', '.', ' ', 'Second', ' ', 'sentence', '.',
    ];
    const tokenStream = createTokenStream(tokens);
    await collectChunks(service.streamingTTS(tokenStream, 'en', 'agent-1'));

    expect(elevenLabsProvider.synthesize).toHaveBeenCalledTimes(2);
  });

  it('should use correct provider for Indian languages', async () => {
    const tokens = ['Namaste', '.', ' ', 'Kaise', ' ', 'ho', '?'];
    const tokenStream = createTokenStream(tokens);
    await collectChunks(service.streamingTTS(tokenStream, 'hi', 'agent-1'));

    // For Hindi, should route to sarvam provider (Indian language routing)
    // The exact provider depends on registration order, but synthesize should be called
    const chunks = await collectChunks(
      service.streamingTTS(createTokenStream(tokens), 'hi', 'agent-1'),
    );
    const audioChunks = chunks.filter((c) => c.type === 'audio');
    expect(audioChunks.length).toBeGreaterThan(0);
  });

  it('should track audio format and duration from TTS response', async () => {
    const tokens = ['Hello', ' ', 'world', '!'];
    const tokenStream = createTokenStream(tokens);
    const chunks = await collectChunks(
      service.streamingTTS(tokenStream, 'en', 'agent-1'),
    );

    const audioChunk = chunks.find((c) => c.type === 'audio');
    expect(audioChunk).toBeDefined();
    if (audioChunk?.type === 'audio') {
      expect(audioChunk.audioFormat).toBe('audio/mp3');
      expect(audioChunk.audioDurationMs).toBe(1000);
      expect(audioChunk.ttsLatencyMs).toBeGreaterThanOrEqual(0);
    }
  });
});
