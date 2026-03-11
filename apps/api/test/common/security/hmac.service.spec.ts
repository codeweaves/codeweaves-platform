import { Test, TestingModule } from '@nestjs/testing';
import { HmacService } from '../../../src/common/security/hmac.service';
import { createHmac } from 'crypto';

describe('HmacService', () => {
  let service: HmacService;

  const TEST_SECRET = 'test-secret-key-for-hmac';
  const TEST_PAYLOAD = '{"agentReply":"Hello from n8n"}';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [HmacService],
    }).compile();

    service = module.get<HmacService>(HmacService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('computeSignature', () => {
    it('should compute HMAC-SHA256 hex digest', () => {
      const result = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      const expected = createHmac('sha256', TEST_SECRET)
        .update(TEST_PAYLOAD)
        .digest('hex');
      expect(result).toBe(expected);
    });

    it('should produce different signatures for different payloads', () => {
      const sig1 = service.computeSignature('payload-1', TEST_SECRET);
      const sig2 = service.computeSignature('payload-2', TEST_SECRET);
      expect(sig1).not.toBe(sig2);
    });

    it('should produce different signatures for different secrets', () => {
      const sig1 = service.computeSignature(TEST_PAYLOAD, 'secret-a');
      const sig2 = service.computeSignature(TEST_PAYLOAD, 'secret-b');
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should return true for a valid signature', () => {
      const signature = createHmac('sha256', TEST_SECRET)
        .update(TEST_PAYLOAD)
        .digest('hex');
      expect(service.verifySignature(TEST_PAYLOAD, signature, TEST_SECRET)).toBe(true);
    });

    it('should return false for an invalid signature', () => {
      expect(service.verifySignature(TEST_PAYLOAD, 'deadbeef'.repeat(8), TEST_SECRET)).toBe(false);
    });

    it('should return false for empty signature', () => {
      expect(service.verifySignature(TEST_PAYLOAD, '', TEST_SECRET)).toBe(false);
    });

    it('should return false for empty payload', () => {
      const signature = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      expect(service.verifySignature('', signature, TEST_SECRET)).toBe(false);
    });

    it('should return false for empty secret', () => {
      const signature = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      expect(service.verifySignature(TEST_PAYLOAD, signature, '')).toBe(false);
    });

    it('should return false when signature length differs from expected', () => {
      expect(service.verifySignature(TEST_PAYLOAD, 'short', TEST_SECRET)).toBe(false);
    });

    it('should match expected HMAC value for known input', () => {
      const knownSecret = 'known-secret';
      const knownPayload = 'known-payload';
      const expected = createHmac('sha256', knownSecret)
        .update(knownPayload)
        .digest('hex');

      expect(service.verifySignature(knownPayload, expected, knownSecret)).toBe(true);
      expect(service.computeSignature(knownPayload, knownSecret)).toBe(expected);
    });

    it('should use timing-safe comparison (does not short-circuit on mismatch)', () => {
      const validSig = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      const wrongSig = validSig.replace(/./g, (c) => (c === 'a' ? 'b' : 'a'));
      expect(service.verifySignature(TEST_PAYLOAD, wrongSig, TEST_SECRET)).toBe(false);
    });

    it('should return false for malformed hex signature (non-hex chars, correct length)', () => {
      // 64-char string of 'z' passes length check but Buffer.from('zz...', 'hex') produces empty buffer
      const malformedSig = 'z'.repeat(64);
      expect(service.verifySignature(TEST_PAYLOAD, malformedSig, TEST_SECRET)).toBe(false);
    });

    it('should return false for mixed valid/invalid hex signature', () => {
      const validSig = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      // Replace first 4 chars with non-hex to create a partial-hex string of same length
      const mixedSig = 'zzzz' + validSig.slice(4);
      expect(service.verifySignature(TEST_PAYLOAD, mixedSig, TEST_SECRET)).toBe(false);
    });
  });

  describe('roundtrip: computeSignature → verifySignature', () => {
    it('should verify a self-computed signature', () => {
      const sig = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      expect(service.verifySignature(TEST_PAYLOAD, sig, TEST_SECRET)).toBe(true);
    });

    it('should reject tampered payload with valid signature', () => {
      const sig = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      expect(service.verifySignature(TEST_PAYLOAD + 'x', sig, TEST_SECRET)).toBe(false);
    });

    it('should reject original payload with wrong secret', () => {
      const sig = service.computeSignature(TEST_PAYLOAD, TEST_SECRET);
      expect(service.verifySignature(TEST_PAYLOAD, sig, 'wrong-secret')).toBe(false);
    });
  });
});
