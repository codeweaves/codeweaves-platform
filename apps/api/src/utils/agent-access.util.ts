import { NotFoundException } from '@nestjs/common';
import { Role } from '@prisma/client';

import type { CurrentUserData } from '../decorators/current-user.decorator';
import type { PrismaService } from '../services/prisma.service';

/**
 * Tenant scoping for agent sub-resources (knowledge, documents, integrations…).
 *
 * The rule (same as AgentsService.findById): CLIENT users only ever see agents
 * belonging to their own organization; ADMIN / SUPER_ADMIN are platform staff
 * and may operate cross-org. A CLIENT with no organization sees nothing.
 *
 * Every controller that takes an :agentId URL param MUST resolve the agent
 * through this check before touching any data hanging off it. Checking only
 * `deletedAt` (as the pre-fix knowledge endpoints did) lets any authenticated
 * user of any org read/write another org's data by guessing/leaking a UUID —
 * that exact cross-tenant IDOR is what this helper exists to prevent.
 */
export interface AccessibleAgent {
  id: string;
  organizationId: string;
  /**
   * Raw aiConfig JSONB — included so sub-resource services that need a config
   * field (e.g. the documents API reading ragChunkingStrategy) don't pay a
   * second agent fetch. Parse via resolveAiConfig; may be null.
   */
  aiConfig: unknown;
}

/**
 * Load the agent scoped to the caller's tenancy, or throw 404. Returns the
 * agent's id + organizationId (callers need the org for denormalised writes).
 *
 * 404 (not 403) on cross-tenant access — existence of another org's agent
 * must not be observable.
 */
export async function assertAgentAccessible(
  prisma: PrismaService,
  agentId: string,
  user: CurrentUserData,
): Promise<AccessibleAgent> {
  if (user.role === Role.CLIENT && !user.organizationId) {
    throw new NotFoundException(`Agent ${agentId} not found or inactive.`);
  }
  const agent = await prisma.agent.findFirst({
    where: {
      id: agentId,
      deletedAt: null,
      ...(user.role === Role.CLIENT && {
        organizationId: user.organizationId!,
      }),
    },
    select: { id: true, organizationId: true, aiConfig: true },
  });
  if (!agent) {
    throw new NotFoundException(`Agent ${agentId} not found or inactive.`);
  }
  return agent;
}
