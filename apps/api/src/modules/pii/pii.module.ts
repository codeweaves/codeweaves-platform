import { Global, Module } from '@nestjs/common';

import { PiiDetectionService } from './pii-detection.service';
import { PiiTokenizerService } from './pii-tokenizer.service';

/**
 * PII detection + reversible tokenization. Global for the same reason
 * CryptoModule is: consumed across chat, handover, and AI modules, and
 * entirely stateless/side-effect-free to construct.
 *
 * See docs/plans/pii-redaction-plan.md for the architecture.
 */
@Global()
@Module({
  providers: [PiiDetectionService, PiiTokenizerService],
  exports: [PiiDetectionService, PiiTokenizerService],
})
export class PiiModule {}
