import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../services/prisma.service';
import { getRequestContext } from './correlation.storage';

@Injectable()
export class TracerService {
  private readonly logger = new Logger(TracerService.name);

  constructor(private readonly prisma: PrismaService) {}

  async logAuditEvent(
    contextId: string,
    event: string,
    data: Record<string, unknown>,
  ): Promise<void> {
    const context = getRequestContext();
    try {
      await this.prisma.auditLog.create({
        data: {
          correlationId: context?.correlationId,
          userId: context?.userId,
          clerkId: context?.clerkId,
          contextId,
          event,
          data: data as Prisma.InputJsonValue,
        },
      });
      this.logger.log(
        `[${context?.correlationId?.slice(0, 8) ?? 'no-ctx'}] ${event} → ${contextId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to write audit event ${event}: ${error}`);
    }
  }

  mergeJsonResponse(
    ...objects: Record<string, unknown>[]
  ): Record<string, unknown> {
    return Object.assign({}, ...objects);
  }
}
