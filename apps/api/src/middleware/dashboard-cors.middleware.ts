import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';

/**
 * CORS middleware for authenticated dashboard routes.
 * Only allows the dashboard origin (CORS_ORIGIN env var).
 */
@Injectable()
export class DashboardCorsMiddleware implements NestMiddleware {
  private readonly dashboardOrigin: string;

  constructor() {
    this.dashboardOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  }

  use(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;

    if (!origin || origin === this.dashboardOrigin) {
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Credentials', 'true');
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, X-Correlation-Id',
        );
        res.setHeader('Access-Control-Expose-Headers', 'X-Correlation-Id');
        res.setHeader('Access-Control-Max-Age', '600');
      }

      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Origin not allowed — no CORS headers, browser will block
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }
}
