import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import {
  requestContextStorage,
  RequestContext,
} from '../common/tracer/correlation.storage';

/**
 * High-frequency endpoints we don't want flooding the request log. The widget
 * handover poller hits `/poll` every ~2.5s per live chat — logging each one
 * drowns the console (and the correlation chain is still set up regardless).
 */
const QUIET_PATHS = /\/poll(\?|$)/;

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');

  use(req: Request, res: Response, next: NextFunction) {
    const raw = req.headers['x-correlation-id'];
    const correlationId =
      (typeof raw === 'string' ? raw : undefined) || randomUUID();
    res.setHeader('x-correlation-id', correlationId);

    const context: RequestContext = {
      correlationId,
      method: req.method,
      url: req.originalUrl,
    };

    if (!QUIET_PATHS.test(req.originalUrl)) {
      this.logger.log(
        `→ ${req.method} ${req.originalUrl} [${correlationId.slice(0, 8)}]`,
      );
    }

    requestContextStorage.run(context, () => next());
  }
}
