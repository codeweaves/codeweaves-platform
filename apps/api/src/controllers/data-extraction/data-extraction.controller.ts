import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '../../decorators/public.decorator';
import { DataExtractionService } from '../../services/data-extraction.service';

/**
 * Internal trigger for background data capture. There is NO in-process timer or
 * queue — extraction runs only when this endpoint is called:
 *
 *   - PRODUCTION: an external scheduler (e.g. GCP Cloud Scheduler) POSTs here
 *     every ~1-2 min to process whatever conversations are due.
 *   - LOCAL/TESTING: hit it yourself. Pass `{ "sessionId": "<id>" }` to extract
 *     one conversation immediately (skips the debounce timer) so you don't wait.
 *
 * `@Public()` bypasses the JWT guard (no user context on a cron call). It's
 * protected by a shared secret header when `INTERNAL_API_SECRET` is set; with
 * no secret configured it's allowed in non-production only (local convenience)
 * and denied in production (fail closed).
 */
@ApiTags('Internal')
@Controller('internal/data-extraction')
export class DataExtractionController {
  constructor(
    private readonly extraction: DataExtractionService,
    private readonly config: ConfigService,
  ) {}

  @Post('run')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Run due data-capture extractions (cron). Optional { sessionId } extracts one conversation now.',
  })
  @ApiResponse({ status: 200, description: 'Extraction pass completed.' })
  @ApiResponse({ status: 401, description: 'Missing/invalid internal secret.' })
  async run(
    @Headers('x-internal-secret') secret: string | undefined,
    @Body() body: { sessionId?: string } | undefined,
  ) {
    this.assertAuthorized(secret);

    // Local-testing shortcut: extract one conversation right now, ignoring the
    // debounce timer.
    if (body?.sessionId) {
      const outcome = await this.extraction.extractForSession(body.sessionId);
      return { mode: 'single', sessionId: body.sessionId, outcome };
    }

    const captured = await this.extraction.runDuePass();
    return { mode: 'due-pass', captured };
  }

  private assertAuthorized(secret: string | undefined): void {
    const expected = this.config.get<string>('INTERNAL_API_SECRET');
    if (expected) {
      if (secret !== expected) {
        throw new UnauthorizedException('Invalid internal secret');
      }
      return;
    }
    // No secret configured → allow locally (dev convenience), deny in prod.
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new UnauthorizedException('INTERNAL_API_SECRET is not configured');
    }
  }
}
