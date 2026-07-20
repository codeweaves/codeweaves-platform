import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { verifyToken } from '@clerk/backend';
import { Role } from '@prisma/client';

import { PrismaService } from '../../services/prisma.service';

/**
 * The trusted scope a socket is entitled to, resolved from its handshake.
 * NEVER built from client-supplied `orgId`/`platform` — only from a verified
 * Clerk token (dashboard) or the unguessable `sessionId` bearer (widget).
 */
export interface WsScope {
  /** Widget: the public session it may watch (`session:<id>`). */
  sessionId?: string;
  /** Dashboard CLIENT: their own org's inbox room (`org:<id>`). */
  orgId?: string;
  /** Dashboard ADMIN/SUPER_ADMIN (no org): the all-orgs `platform` room. */
  platform?: boolean;
}

/** Pull a single non-empty string from a handshake auth/query value. */
function pickStr(v: unknown): string | undefined {
  if (typeof v === 'string' && v.trim()) return v.trim();
  if (Array.isArray(v) && typeof v[0] === 'string' && v[0].trim())
    return v[0].trim();
  return undefined;
}

/**
 * Authenticates Socket.io handshakes for the handover gateway.
 *
 * There are exactly two legitimate kinds of client, and the scope is derived
 * from what each PROVES, never from what it claims:
 *
 *   • Widget (public customer sites) — presents only an unguessable `sessionId`.
 *     Same bearer model as the public `/poll` HTTP endpoint. No login. Gets a
 *     session-scoped socket and nothing else.
 *   • Dashboard (our team) — presents a Clerk JWT (`klivo-api` template token,
 *     the same one the HTTP API verifies). We verify it, map `sub` → the DB
 *     user, and derive the org/platform room from the DB — so a client can
 *     NEVER self-assign into another org's room by sending an `orgId` flag.
 *
 * Any handshake that is neither a valid token nor a sessionId is rejected.
 */
@Injectable()
export class WsAuthService {
  private readonly logger = new Logger(WsAuthService.name);
  private readonly secretKey: string;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    this.secretKey = this.config.get<string>('CLERK_SECRET_KEY', '');
  }

  /**
   * Resolve the trusted scope for a socket, or `null` when the handshake can't
   * be trusted (→ the caller rejects the connection).
   */
  async resolveScope(handshake: {
    auth?: Record<string, unknown>;
    query?: Record<string, unknown>;
  }): Promise<WsScope | null> {
    const auth = handshake.auth ?? {};
    const query = handshake.query ?? {};
    const token = pickStr(auth.token) ?? pickStr(query.token);
    const sessionId = pickStr(auth.sessionId) ?? pickStr(query.sessionId);

    // ── Dashboard path: a verified Clerk token is required. ──────────────────
    // org/role come from the DB user the token maps to — client-supplied
    // orgId/platform flags are ignored entirely.
    if (token) {
      const scope = await this.scopeFromToken(token);
      if (scope) return scope;
      // Token present but invalid/unresolved: do NOT fall back to any
      // client-claimed scope. Only the sessionId bearer path may still apply.
    }

    // ── Widget path: the unguessable sessionId IS the bearer. No auth. ───────
    if (sessionId) return { sessionId };

    return null;
  }

  private async scopeFromToken(token: string): Promise<WsScope | null> {
    if (!this.secretKey) {
      this.logger.warn(
        'CLERK_SECRET_KEY not set — cannot verify dashboard socket tokens.',
      );
      return null;
    }
    try {
      const claims = await verifyToken(token, { secretKey: this.secretKey });
      const clerkId = claims.sub;
      if (!clerkId) return null;

      const user = await this.prisma.user.findFirst({
        where: { clerkId, deletedAt: null },
        select: { role: true, organizationId: true },
      });
      if (!user) return null;

      // A CLIENT is pinned to their own org. Platform staff (no org) watch all.
      if (user.organizationId) return { orgId: user.organizationId };
      if (user.role === Role.SUPER_ADMIN || user.role === Role.ADMIN) {
        return { platform: true };
      }
      // Authenticated but neither org-bound nor staff → no room to join.
      return null;
    } catch (err) {
      this.logger.warn(
        `WS token verification failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }
}
