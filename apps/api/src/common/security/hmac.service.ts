import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';

@Injectable()
export class HmacService {
  /**
   * Verify an HMAC-SHA256 signature against a payload.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!payload || !signature || !secret) return false;
    const expected = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    if (expected.length !== signature.length) return false;
    try {
      return timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      );
    } catch {
      return false;
    }
  }

  /**
   * Compute an HMAC-SHA256 signature for a payload.
   */
  computeSignature(payload: string, secret: string): string {
    return createHmac('sha256', secret).update(payload).digest('hex');
  }
}
