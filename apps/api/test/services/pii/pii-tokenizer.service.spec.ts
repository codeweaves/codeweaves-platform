import { Test } from '@nestjs/testing';

import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { PiiDetectionService } from '../../../src/modules/pii/pii-detection.service';
import { PiiTokenizerService } from '../../../src/modules/pii/pii-tokenizer.service';
import { StreamDetokenizer } from '../../../src/modules/pii/stream-detokenizer';
import { PrismaService } from '../../../src/services/prisma.service';

describe('PiiTokenizerService', () => {
  let service: PiiTokenizerService;
  const mockPrisma = {
    piiToken: {
      findMany: jest.fn(),
      createMany: jest.fn(),
    },
  };
  const mockCrypto = {
    encrypt: jest.fn(),
    decrypt: jest.fn(),
    hmacKey: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.encrypt.mockImplementation((v: string) => `enc(${v})`);
    mockCrypto.decrypt.mockImplementation((v: string) => v.slice(4, -1));
    mockCrypto.hmacKey.mockReturnValue(Buffer.from('test-hmac-key'));
    mockPrisma.piiToken.findMany.mockResolvedValue([]);
    mockPrisma.piiToken.createMany.mockResolvedValue({ count: 0 });
    const moduleRef = await Test.createTestingModule({
      providers: [
        PiiTokenizerService,
        PiiDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    service = moduleRef.get(PiiTokenizerService);
  });

  it('tokenizes TOKENIZE-tier values with stable per-session placeholders', async () => {
    const ctx = await service.forSession('org-1', 'sess-1');
    const first = ctx.tokenize('my dob is 12/08/1994 thanks');
    expect(first).toBe('my dob is [DOB_1] thanks');
    // Same value again → same token, no new counter.
    const second = ctx.tokenize('confirm dob 12/08/1994?');
    expect(second).toBe('confirm dob [DOB_1]?');
    // Different value → next index.
    const third = ctx.tokenize('my dob is 01/01/1990');
    expect(third).toBe('my dob is [DOB_2]');
  });

  it('leaves ALLOW-tier values (emails, phones) untouched', async () => {
    const ctx = await service.forSession('org-1', 'sess-1');
    const input = 'email me at a@b.com';
    expect(ctx.tokenize(input)).toBe(input);
  });

  it('detokenizes placeholders back to real values', async () => {
    const ctx = await service.forSession('org-1', 'sess-1');
    ctx.tokenize('account number 123456789012 for my bank');
    const out = ctx.detokenize('I will use [BANK_ACCOUNT_1] as reference');
    expect(out).toBe('I will use 123456789012 as reference');
  });

  it('leaves unknown placeholders alone', async () => {
    const ctx = await service.forSession('org-1', 'sess-1');
    ctx.tokenize('dob 12/08/1994');
    expect(ctx.detokenize('see [BANK_ACCOUNT_9]')).toBe('see [BANK_ACCOUNT_9]');
  });

  it('flush persists minted tokens once, encrypted', async () => {
    const ctx = await service.forSession('org-1', 'sess-1');
    ctx.tokenize('dob 12/08/1994');
    await ctx.flush();
    expect(mockPrisma.piiToken.createMany).toHaveBeenCalledTimes(1);
    const arg = mockPrisma.piiToken.createMany.mock.calls[0]![0];
    expect(arg.data[0]).toMatchObject({
      organizationId: 'org-1',
      chatSessionId: 'sess-1',
      category: 'DOB',
      token: '[DOB_1]',
      valueEncrypted: 'enc(12/08/1994)',
    });
    expect(arg.skipDuplicates).toBe(true);
    // Second flush with nothing new is a no-op.
    await ctx.flush();
    expect(mockPrisma.piiToken.createMany).toHaveBeenCalledTimes(1);
  });

  it('seeds from persisted rows so counters continue, not restart', async () => {
    mockPrisma.piiToken.findMany.mockResolvedValue([
      {
        category: 'DOB',
        token: '[DOB_3]',
        valueEncrypted: 'enc(05/05/1985)',
        valueHash: 'somehash',
      },
    ]);
    const ctx = await service.forSession('org-1', 'sess-1');
    expect(ctx.detokenize('born [DOB_3]')).toBe('born 05/05/1985');
    // New value continues after the highest persisted index.
    expect(ctx.tokenize('dob is 02/02/1992')).toBe('dob is [DOB_4]');
  });

  it('degrades to an empty map (still redacts) when the DB read fails', async () => {
    mockPrisma.piiToken.findMany.mockRejectedValue(new Error('db down'));
    const ctx = await service.forSession('org-1', 'sess-1');
    expect(ctx.tokenize('my dob is 12/08/1994')).toBe('my dob is [DOB_1]');
  });

  it('flush failure is swallowed (fire-and-forget contract)', async () => {
    mockPrisma.piiToken.createMany.mockRejectedValue(new Error('db down'));
    const ctx = await service.forSession('org-1', 'sess-1');
    ctx.tokenize('dob 12/08/1994');
    await expect(ctx.flush()).resolves.toBeUndefined();
  });

  describe('redactForStorage (transcript storage path)', () => {
    it('destroys DESTROY-tier, tokenises VAULT-tier, and durably vaults with last4', async () => {
      const out = await service.redactForStorage(
        'org-1',
        'sess-1',
        'card 4111111111111111, pan ABCDE1234F, account 123456789012 bank',
      );
      expect(out).toContain('[CARD REDACTED ****1111]'); // destroyed, last-4 kept
      expect(out).toContain('[PAN_1]');
      expect(out).toContain('[BANK_ACCOUNT_1]');
      expect(out).not.toContain('ABCDE1234F');
      expect(out).not.toContain('123456789012');

      expect(mockPrisma.piiToken.createMany).toHaveBeenCalledTimes(1);
      const rows = mockPrisma.piiToken.createMany.mock.calls[0]![0].data as Array<{
        category: string;
        valueEncrypted: string;
        last4: string;
      }>;
      expect(rows.find((r) => r.category === 'BANK_ACCOUNT')).toMatchObject({
        valueEncrypted: 'enc(123456789012)',
        last4: '9012',
      });
      expect(rows.find((r) => r.category === 'PAN')).toMatchObject({ last4: '234F' });
    });

    it('masks VAULT-tier (no dangling token) when the durable vault write fails', async () => {
      mockPrisma.piiToken.createMany.mockRejectedValue(new Error('db down'));
      const out = await service.redactForStorage(
        'org-1',
        'sess-1',
        'account 123456789012 bank and pan ABCDE1234F',
      );
      // No token whose value we could not persist — masked instead, never raw.
      expect(out).toContain('[BANK_ACCOUNT REDACTED]');
      expect(out).toContain('[PAN REDACTED]');
      expect(out).not.toContain('123456789012');
      expect(out).not.toContain('ABCDE1234F');
      expect(out).not.toContain('[BANK_ACCOUNT_1]');
    });

    it('writes nothing for a message with no VAULT-tier PII', async () => {
      const out = await service.redactForStorage('org-1', 'sess-1', 'hello, a pricing question');
      expect(out).toBe('hello, a pricing question');
      expect(mockPrisma.piiToken.createMany).not.toHaveBeenCalled();
    });
  });
});

describe('StreamDetokenizer', () => {
  async function makeCtx() {
    const mockPrisma = {
      piiToken: { findMany: jest.fn().mockResolvedValue([]), createMany: jest.fn() },
    };
    const mockCrypto = {
      encrypt: jest.fn((v: string) => v),
      decrypt: jest.fn((v: string) => v),
      hmacKey: jest.fn(() => Buffer.from('k')),
    };
    const moduleRef = await Test.createTestingModule({
      providers: [
        PiiTokenizerService,
        PiiDetectionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: CryptoService, useValue: mockCrypto },
      ],
    }).compile();
    const svc = moduleRef.get(PiiTokenizerService);
    const ctx = await svc.forSession('org-1', 'sess-1');
    ctx.tokenize('account no 123456789012 bank');
    return ctx;
  }

  it('re-hydrates a placeholder split across chunks', async () => {
    const detok = new StreamDetokenizer(await makeCtx());
    let out = '';
    out += detok.push('Your account [BANK_');
    out += detok.push('ACCOUNT_1] is verified');
    out += detok.end();
    expect(out).toBe('Your account 123456789012 is verified');
  });

  it('passes text through unchanged when the session has no tokens', () => {
    const detok = new StreamDetokenizer(null);
    expect(detok.push('hello [not a token] world')).toBe('hello [not a token] world');
    expect(detok.end()).toBe('');
  });

  it('does not hold back non-token bracket text', async () => {
    const detok = new StreamDetokenizer(await makeCtx());
    // Lowercase after '[' — cannot be one of our tokens, emit immediately.
    expect(detok.push('list [a, b, c] done')).toBe('list [a, b, c] done');
  });

  it('flushes a dangling partial token at stream end', async () => {
    const detok = new StreamDetokenizer(await makeCtx());
    const first = detok.push('ends with [BANK_ACC');
    expect(first).toBe('ends with ');
    expect(detok.end()).toBe('[BANK_ACC');
  });
});
