import { Injectable, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { AppLogger } from '../common/logger/app-logger';

/**
 * CORS middleware for authenticated dashboard routes.
 * Only allows the dashboard origin (CORS_ORIGIN env var).
 */
@Injectable()
export class DashboardCorsMiddleware implements NestMiddleware {
  private readonly log = new AppLogger(DashboardCorsMiddleware.name);
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
        // Content-Disposition is exposed so a fetch-driven download (CSV export)
        // can read the server-chosen filename instead of inventing one.
        res.setHeader(
          'Access-Control-Expose-Headers',
          'X-Correlation-Id, Content-Disposition',
        );
        res.setHeader('Access-Control-Max-Age', '600');
      }

      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Origin not allowed — no CORS headers, browser will block
    this.log.warn('use', 'CORS blocked — origin not permitted for dashboard', {
      origin,
    });
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }
}
