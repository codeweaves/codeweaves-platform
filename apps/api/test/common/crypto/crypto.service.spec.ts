import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { randomBytes } from 'crypto';

describe('CryptoService', () => {
  let service: CryptoService;

  const validKey = randomBytes(32).toString('hex'); // 64-char hex = 32 bytes

  const createService = async (keyOverride?: string | undefined) => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CryptoService,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'AGENT_SECRET_KEY') return keyOverride;
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    return module.get<CryptoService>(CryptoService);
  };

  beforeEach(async () => {
    service = await createService(validKey);
    service.onModuleInit();
  });

  describe('onModuleInit', () => {
    it('should initialize successfully with a valid 64-char hex key', () => {
      expect(() => service.onModuleInit()).not.toThrow();
    });

    it('should throw if AGENT_SECRET_KEY is missing', async () => {
      const svc = await createService(undefined);
      expect(() => svc.onModuleInit()).toThrow(
        'AGENT_SECRET_KEY environment variable is required',
      );
    });

    it('should throw if AGENT_SECRET_KEY is empty string', async () => {
      const svc = await createService('');
      expect(() => svc.onModuleInit()).toThrow(
        'AGENT_SECRET_KEY environment variable is required',
      );
    });

    it('should throw if key is not 32 bytes (too short)', async () => {
      const shortKey = randomBytes(16).toString('hex'); // 16 bytes
      const svc = await createService(shortKey);
      expect(() => svc.onModuleInit()).toThrow(
        'AGENT_SECRET_KEY must be a 64-character hex string (32 bytes)',
      );
    });

    it('should throw if key is not 32 bytes (too long)', async () => {
      const longKey = randomBytes(48).toString('hex'); // 48 bytes
      const svc = await createService(longKey);
      expect(() => svc.onModuleInit()).toThrow(
        'AGENT_SECRET_KEY must be a 64-character hex string (32 bytes)',
      );
    });
  });

  describe('encrypt', () => {
    it('should return a string in iv:ciphertext:tag format', () => {
      const result = service.encrypt('hello world');
      const parts = result.split(':');
      expect(parts).toHaveLength(3);
      // IV should be 32 hex chars (16 bytes)
      expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
      // Ciphertext and tag should be hex strings
      expect(parts[1]).toMatch(/^[0-9a-f]+$/);
      expect(parts[2]).toMatch(/^[0-9a-f]+$/);
    });

    it('should produce different IVs for the same plaintext', () => {
      const a = service.encrypt('same text');
      const b = service.encrypt('same text');
      const ivA = a.split(':')[0];
      const ivB = b.split(':')[0];
      expect(ivA).not.toEqual(ivB);
    });

    it('should produce different ciphertext for the same plaintext', () => {
      const a = service.encrypt('same text');
      const b = service.encrypt('same text');
      expect(a).not.toEqual(b);
    });
  });

  describe('decrypt', () => {
    it('should decrypt to the original plaintext', () => {
      const plaintext = 'https://n8n.example.com/webhook/abc123';
      const encrypted = service.encrypt(plaintext);
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(plaintext);
    });

    it('should handle empty string', () => {
      const encrypted = service.encrypt('');
      expect(service.decrypt(encrypted)).toBe('');
    });

    it('should handle long strings', () => {
      const longText = 'A'.repeat(10000);
      const encrypted = service.encrypt(longText);
      expect(service.decrypt(encrypted)).toBe(longText);
    });

    it('should handle unicode characters', () => {
      const unicode = 'Hello 世界 🌍 café';
      const encrypted = service.encrypt(unicode);
      expect(service.decrypt(encrypted)).toBe(unicode);
    });

    it('should throw on invalid format (missing parts)', () => {
      expect(() => service.decrypt('invalidformat')).toThrow(
        'Invalid encrypted value format',
      );
    });

    it('should throw on invalid format (only two parts)', () => {
      expect(() => service.decrypt('abc:def')).toThrow(
        'Invalid encrypted value format',
      );
    });

    it('should throw when auth tag is tampered', () => {
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');
      // Flip a character in the auth tag
      const tamperedTag =
        parts[2]![0] === 'a'
          ? 'b' + parts[2]!.slice(1)
          : 'a' + parts[2]!.slice(1);
      const tampered = `${parts[0]}:${parts[1]}:${tamperedTag}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw when ciphertext is tampered', () => {
      const encrypted = service.encrypt('secret data');
      const parts = encrypted.split(':');
      const tamperedData =
        parts[1]![0] === 'a'
          ? 'b' + parts[1]!.slice(1)
          : 'a' + parts[1]!.slice(1);
      const tampered = `${parts[0]}:${tamperedData}:${parts[2]}`;
      expect(() => service.decrypt(tampered)).toThrow();
    });

    it('should throw when decrypted with a different key', async () => {
      const encrypted = service.encrypt('secret data');

      // Create a new service with a different key
      const otherKey = randomBytes(32).toString('hex');
      const otherService = await createService(otherKey);
      otherService.onModuleInit();

      expect(() => otherService.decrypt(encrypted)).toThrow();
    });
  });

  describe('encrypt/decrypt roundtrip', () => {
    const testCases = [
      'https://n8n.example.com/webhook/abc123',
      'http://localhost:5678/webhook/test',
      'sk-abc123def456',
      '',
      'special chars: !@#$%^&*()_+-={}[]|;:,.<>?',
    ];

    testCases.forEach((input) => {
      it(`should roundtrip: "${input.substring(0, 40)}${input.length > 40 ? '...' : ''}"`, () => {
        const encrypted = service.encrypt(input);
        expect(service.decrypt(encrypted)).toBe(input);
      });
    });
  });
});
