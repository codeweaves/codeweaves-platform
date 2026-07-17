import { Test } from '@nestjs/testing';

import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { PiiDetectionService } from '../../../src/modules/pii/pii-detection.service';
import { PiiTokenizerService } from '../../../src/modules/pii/pii-tokenizer.service';
import { SummarizationService } from '../../../src/modules/ai/summarization.service';
import { SummaryRefreshService } from '../../../src/modules/ai/summary-refresh.service';
import { PrismaService } from '../../../src/services/prisma.service';

describe('SummaryRefreshService', () => {
  let service: SummaryRefreshService;
  const mockPrisma = {
    chatMessage: { count: jest.fn(), findMany: jest.fn() },
    chatSession: { findUnique: jest.fn(), update: jest.fn() },
    piiToken: { findMany: jest.fn(), createMany: jest.fn() },
  };
  const mockSummarization = { summarize: jest.fn() };
  const mockCrypto = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    hmacKey: jest.fn(),
  };

  const req = {
    chatSessionId: 'sess-1',
    organizationId: 'org-1',
    agentId: 'agent-1',
    maxContextMessages: 20,
  };

  /** schedule() is fire-and-forget; flush microtasks so the refresh finishes. */
  const settle = () => new Promise((r) => setTimeout(r, 0));

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.hmacKey.mockReturnValue(Buffer.from('k'));
    mockCrypto.encrypt.mockImplementation((v: string) => v);
    mockCrypto.decrypt.mockImplementation((v: string) => v);
    mockPrisma.piiToken.findMany.mockResolvedValue([]);
    mockPrisma.piiToken.createMany.mockResolvedValue({ count: 0 });
    mockPrisma.chatSession.update.mockResolvedValue({});
    mockSummarization.summarize.mockResolvedValue({
      summary: 'User asked about pricing; assistant explained tiers.',
      tokensUsed: 50,
    });
    const moduleRef = await Test.createTestingModule({
      providers: [
        SummaryRefreshService,
        PiiDetectionService,
        PiiTokenizerService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: SummarizationService, useValue: mockSummarization },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    service = moduleRef.get(SummaryRefreshService);
  });

  it('summarizes older messages and persists summary + generation marker', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'ASSISTANT', content: 'Sure, we have three tiers.' },
      { role: 'USER', content: 'What are your prices?' },
    ]);

    service.schedule(req);
    await settle();

    // Older rows: skip the window, chronological order for the summarizer.
    expect(mockPrisma.chatMessage.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, orderBy: { createdAt: 'desc' } }),
    );
    const summarizeArg = mockSummarization.summarize.mock.calls[0]![0];
    expect(summarizeArg.messages[0]).toEqual({
      role: 'user',
      content: 'What are your prices?',
    });
    expect(mockPrisma.chatSession.update).toHaveBeenCalledWith({
      where: { id: 'sess-1' },
      data: {
        summary: 'User asked about pricing; assistant explained tiers.',
        summaryMessageCount: 25,
      },
    });
  });

  it('skips when the conversation fits the window', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(10);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });

    service.schedule(req);
    await settle();

    expect(mockSummarization.summarize).not.toHaveBeenCalled();
    expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
  });

  it('skips when the summary is already current (generation marker)', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: 25 });

    service.schedule(req);
    await settle();

    expect(mockSummarization.summarize).not.toHaveBeenCalled();
  });

  it('does not persist the sentinel empty-conversation summary', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'hi' },
    ]);
    mockSummarization.summarize.mockResolvedValue({
      summary: 'No substantive conversation yet.',
      tokensUsed: 5,
    });

    service.schedule(req);
    await settle();

    expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
  });

  it('masks HARD_DROP identifiers from the summarizer input', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      // Verhoeff-valid Aadhaar-format number (test value, not a real Aadhaar).
      { role: 'USER', content: 'my aadhaar is 234123412346 ok?' },
    ]);

    service.schedule(req);
    await settle();

    const summarizeArg = mockSummarization.summarize.mock.calls[0]![0];
    expect(summarizeArg.messages[0].content).toContain('[AADHAAR REDACTED]');
    expect(summarizeArg.messages[0].content).not.toContain('234123412346');
  });

  it('tokenizes TOKENIZE-tier values when the agent toggle is on', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'my account number is 123456789012' },
    ]);

    service.schedule({ ...req, piiRedactionEnabled: true });
    await settle();

    const summarizeArg = mockSummarization.summarize.mock.calls[0]![0];
    expect(summarizeArg.messages[0].content).toBe(
      'my account number is [BANK_ACCOUNT_1]',
    );
  });

  it('swallows summarization failures (never throws to the caller)', async () => {
    mockPrisma.chatMessage.count.mockResolvedValue(25);
    mockPrisma.chatSession.findUnique.mockResolvedValue({ summaryMessageCount: null });
    mockPrisma.chatMessage.findMany.mockResolvedValue([
      { role: 'USER', content: 'hello' },
    ]);
    mockSummarization.summarize.mockRejectedValue(new Error('LLM down'));

    expect(() => service.schedule(req)).not.toThrow();
    await settle();
    expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
  });
});
