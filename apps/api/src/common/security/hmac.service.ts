import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import { AppLogger } from '../logger/app-logger';

@Injectable()
export class HmacService {
  private readonly log = new AppLogger(HmacService.name);

  /**
   * Verify an HMAC-SHA256 signature against a payload.
   * Uses timing-safe comparison to prevent timing attacks.
   */
  verifySignature(
    payload: string,
    signature: string,
    secret: string,
  ): boolean {
    if (!payload || !signature || !secret) {
      this.log.warn('verifySignature', 'HMAC verification rejected — missing payload, signature, or secret');
      return false;
    }
    const expected = createHmac('sha256', secret)
      .update(payload)
      .digest('hex');
    if (expected.length !== signature.length) {
      this.log.warn('verifySignature', 'HMAC verification rejected — signature length mismatch');
      return false;
    }
    try {
      const ok = timingSafeEqual(
        Buffer.from(expected, 'hex'),
        Buffer.from(signature, 'hex'),
      );
      if (!ok) {
        this.log.warn('verifySignature', 'HMAC verification rejected — signature mismatch');
      }
      return ok;
    } catch {
      this.log.warn('verifySignature', 'HMAC verification rejected — malformed signature hex');
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
