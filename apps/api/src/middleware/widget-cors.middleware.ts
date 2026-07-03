import { Injectable, NestMiddleware, Logger } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { PrismaService } from '../services/prisma.service';
import { WidgetCorsCacheService } from '../common/cache/widget-cors-cache.service';
import { normalizeDomain } from '../utils/domain';

/**
 * Dynamic CORS middleware for public widget endpoints.
 *
 * For requests with an Origin header that does NOT match the dashboard origin,
 * this middleware looks up the target agent's allowedDomains from the DB and
 * only sets Access-Control-Allow-Origin if the origin is permitted.
 *
 * - Dashboard origin (CORS_ORIGIN env) → always allowed
 * - No Origin header (server-to-server, curl) → allowed (no CORS headers needed)
 * - Widget origins → checked against agent's allowedDomains
 * - Empty allowedDomains → allow all origins (no restrictions configured)
 */
@Injectable()
export class WidgetCorsMiddleware implements NestMiddleware {
  private readonly logger = new Logger(WidgetCorsMiddleware.name);
  private readonly dashboardOrigin: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: WidgetCorsCacheService,
  ) {
    this.dashboardOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
  }

  async use(req: Request, res: Response, next: NextFunction) {
    const origin = req.headers.origin;

    // No Origin header — not a cross-origin request (server-to-server, same-origin, curl)
    if (!origin) return next();

    // Dashboard origin — always allowed with credentials
    if (origin === this.dashboardOrigin) {
      this.setCorsHeaders(res, origin, true);
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Extract agent identifier from the request
    const agentId = this.extractAgentId(req);
    if (!agentId) {
      // Can't determine agent — block cross-origin request
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Look up allowed domains for this agent
    const allowedDomains = await this.getAllowedDomains(agentId);
    if (allowedDomains === null) {
      // Agent not found — let the controller handle 404
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Check if origin is allowed
    const originHostname = this.extractHostname(origin);
    if (this.isOriginAllowed(originHostname, allowedDomains)) {
      this.setCorsHeaders(res, origin, false);
      if (req.method === 'OPTIONS') return res.status(204).end();
      return next();
    }

    // Origin not allowed — respond without CORS headers (browser will block)
    this.logger.warn(
      `CORS blocked: origin "${origin}" not in allowedDomains for agent "${agentId}"`,
    );
    if (req.method === 'OPTIONS') return res.status(204).end();
    return next();
  }

  private setCorsHeaders(res: Response, origin: string, credentials: boolean): void {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization, If-None-Match, X-Device-Id, X-Session-Id, X-Correlation-Id',
    );
    res.setHeader('Access-Control-Expose-Headers', 'ETag, X-Correlation-Id');
    res.setHeader('Access-Control-Max-Age', '600');
    if (credentials) {
      res.setHeader('Access-Control-Allow-Credentials', 'true');
    }
  }

  /**
   * Extract agent identifier from the request.
   * - Config endpoint: /public/agents/:publicId/config → publicId from URL
   * - Chat/Voice endpoints: agentId from JSON body (POST)
   */
  private extractAgentId(req: Request): string | null {
    const url = req.originalUrl || req.url;

    // Config endpoint: /api/klivo/v1/public/agents/:publicId/config
    const configMatch = url.match(/\/public\/agents\/([^/]+)\/config/);
    if (configMatch?.[1]) return configMatch[1];

    // Demo endpoint: /api/klivo/v1/public/agents/:id/demo
    const demoMatch = url.match(/\/public\/agents\/([^/]+)\/demo/);
    if (demoMatch?.[1]) return demoMatch[1];

    // Chat/Voice POST endpoints: agentId in request body (JSON only — multipart bodies
    // are parsed later by multer/FileInterceptor, not available in middleware)
    if (req.method === 'POST' && req.body?.agentId) {
      return String(req.body.agentId);
    }

    // Voice endpoints use multipart/form-data — body not parsed yet in middleware.
    // Try to read agentId from query parameter (widget sends ?agentId=xxx).
    // If not available, fall through to preflight-style handling; the voice controller
    // validates the agent after multer parses the body, so this is defense-in-depth only.
    const isVoiceRoute = url.includes('/public/voice/');
    if (req.method === 'POST' && isVoiceRoute) {
      const queryAgentId = req.query?.agentId;
      if (typeof queryAgentId === 'string' && queryAgentId.trim()) {
        return queryAgentId.trim();
      }
      // No agentId in query — allow through; controller enforces agent validation
      return '__preflight__';
    }

    // Body-less GET widget endpoints (e.g. the handover poll loop at
    // /public/chat/:sessionId/poll) carry only a sessionId in the URL, so the
    // agentId is sent as a query param for CORS resolution. The browser's
    // preflight uses the same URL+query, so this also covers OPTIONS below.
    const queryAgentId = req.query?.agentId;
    if (typeof queryAgentId === 'string' && queryAgentId.trim()) {
      return queryAgentId.trim();
    }

    // Preflight OPTIONS requests carry no body — try Referer or fall back
    // For OPTIONS, we need the agentId from somewhere. The actual POST will
    // be validated, so we allow OPTIONS through if we can't determine the agent.
    if (req.method === 'OPTIONS') {
      return '__preflight__';
    }

    return null;
  }

  /**
   * Look up allowedDomains for an agent. Handles both publicId and UUID lookups.
   * Returns null if agent not found, empty array if no restrictions.
   */
  private async getAllowedDomains(agentId: string): Promise<string[] | null> {
    // Preflight — we can't know the agent, allow it through
    // The actual request will be validated
    if (agentId === '__preflight__') return [];

    // Check cache (keyed by whichever identifier the wire sent — publicId or UUID).
    const cached = this.cache.get(agentId);
    if (cached !== null) return cached;

    try {
      // Single query covering both lookup paths — agent identifiers from the
      // wire are either a `publicId` (8-char slug, config endpoint) or a `id`
      // (UUID, chat/voice endpoints). Previously we ran two sequential
      // findFirst calls; the OR variant lets Postgres satisfy both with one
      // round-trip + index seek. Saves ~300-400ms on cache miss (~half the
      // dominant widget vs dev page latency gap).
      const agent = await this.prisma.agent.findFirst({
        where: {
          deletedAt: null,
          status: 'ACTIVE',
          OR: [
            { publicId: agentId },
            { id: agentId },
          ],
        },
        select: { id: true, publicId: true, allowedDomains: true },
      });

      if (!agent) return null;

      const domains = agent.allowedDomains as string[];
      // Populate under BOTH keys so the next request can hit cache regardless
      // of which identifier it sends (the widget config endpoint sends
      // publicId; chat/voice POST bodies send the UUID).
      this.cache.set({ publicId: agent.publicId, id: agent.id }, domains);
      return domains;
    } catch (error) {
      this.logger.error(`Failed to look up allowedDomains for agent "${agentId}": ${error}`);
      return null;
    }
  }

  /** Extract hostname (with port) from an origin URL */
  private extractHostname(origin: string): string {
    try {
      const url = new URL(origin);
      return url.port ? `${url.hostname}:${url.port}` : url.hostname;
    } catch {
      return origin;
    }
  }

  /** Check if a hostname matches the allowed domains list */
  private isOriginAllowed(hostname: string, allowedDomains: string[]): boolean {
    // No restrictions configured — allow all
    if (allowedDomains.length === 0) return true;

    const host = normalizeDomain(hostname);

    for (const pattern of allowedDomains) {
      const p = normalizeDomain(pattern);
      if (!p) continue;

      if (p.startsWith('*.')) {
        const base = p.slice(2);
        if (host === base || host.endsWith('.' + base)) return true;
      } else {
        if (host === p) return true;
      }
    }

    return false;
  }
}
