import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { randomUUID } from 'crypto';
import {
  requestContextStorage,
  RequestContext,
} from '../common/tracer/correlation.storage';

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

    this.logger.log(
      `→ ${req.method} ${req.originalUrl} [${correlationId.slice(0, 8)}]`,
    );

    requestContextStorage.run(context, () => next());
  }
}
