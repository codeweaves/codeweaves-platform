import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Param,
  ParseUUIDPipe,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam, ApiQuery } from '@nestjs/swagger';
import { Role } from '@prisma/client';
import { CurrentUser } from '../../decorators/current-user.decorator';
import type { CurrentUserData } from '../../decorators/current-user.decorator';
import { Roles } from '../../decorators/roles.decorator';
import { RolesGuard } from '../../guards/roles.guard';
import { PurgeService } from '../../services/purge.service';

/**
 * Privacy / data-subject-rights endpoints (DPDP S2 — erasure engine).
 *
 * Deliberately DELETE-only and heavily guarded: these are the only routes in
 * the API that irreversibly destroy data.
 */
@ApiTags('Privacy')
@ApiBearerAuth()
@Controller('privacy')
@UseGuards(RolesGuard)
export class PrivacyController {
  constructor(private readonly purgeService: PurgeService) {}

  /**
   * Resolve which org a data-subject-rights call operates on. CLIENT users
   * are pinned to their own organization — a client must never reach another
   * tenant, whatever they pass. ADMIN/SUPER_ADMIN may target any org.
   */
  private resolveOrgScope(user: CurrentUserData, orgId?: string): string {
    const organizationId =
      user.role === Role.CLIENT ? user.organizationId : (orgId ?? user.organizationId);
    if (!organizationId) {
      throw new BadRequestException('orgId is required');
    }
    return organizationId;
  }

  /**
   * Right to access (DPDP): summary of the data held on one visitor —
   * sessions, captured lead fields, operational record counts, purposes.
   */
  @Get('visitors/:visitorId/summary')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.CLIENT)
  @ApiOperation({ summary: "Summarize a visitor's stored data (right to access)" })
  @ApiParam({ name: 'visitorId', description: 'Stored visitor identifier: vh_… hash (web) or phone (WhatsApp)' })
  @ApiQuery({ name: 'orgId', required: false, description: 'Target org (ADMIN/SUPER_ADMIN only; CLIENT is pinned to their own org)' })
  @ApiResponse({ status: 200, description: 'Data summary for the visitor' })
  async summarizeVisitor(
    @Param('visitorId') visitorId: string,
    @CurrentUser() user: CurrentUserData,
    @Query('orgId') orgId?: string,
  ) {
    return this.purgeService.summarizeVisitor(
      this.resolveOrgScope(user, orgId),
      visitorId,
    );
  }

  /**
   * Erase one visitor's complete footprint within one organization —
   * the "right to erasure" path, run on a verified data-principal request.
   */
  @Delete('visitors/:visitorId')
  @Roles(Role.SUPER_ADMIN, Role.ADMIN, Role.CLIENT)
  @ApiOperation({ summary: "Erase a visitor's data within an organization (right to erasure)" })
  @ApiParam({ name: 'visitorId', description: 'Stored visitor identifier: vh_… hash (web) or phone (WhatsApp)' })
  @ApiQuery({ name: 'orgId', required: false, description: 'Target org (ADMIN/SUPER_ADMIN only; CLIENT is pinned to their own org)' })
  @ApiResponse({ status: 200, description: 'Erasure completed; per-table counts returned' })
  @ApiResponse({ status: 400, description: 'Missing org scope' })
  async eraseVisitor(
    @Param('visitorId') visitorId: string,
    @CurrentUser() user: CurrentUserData,
    @Query('orgId') orgId?: string,
  ) {
    return this.purgeService.eraseVisitor(
      this.resolveOrgScope(user, orgId),
      visitorId,
    );
  }

  /**
   * Hard-delete an organization and everything it owns. Irreversible —
   * SUPER_ADMIN only, and the org id must be repeated in `confirm` as a
   * deliberate double-entry (no one-click catastrophes).
   */
  @Delete('organizations/:orgId')
  @Roles(Role.SUPER_ADMIN)
  @ApiOperation({ summary: 'Hard-delete an organization and its complete data footprint (irreversible)' })
  @ApiParam({ name: 'orgId', description: 'Organization UUID' })
  @ApiQuery({ name: 'confirm', required: true, description: 'Must exactly repeat the organization UUID' })
  @ApiResponse({ status: 200, description: 'Organization erased; per-table counts returned' })
  @ApiResponse({ status: 403, description: 'Confirmation mismatch' })
  @ApiResponse({ status: 404, description: 'Organization not found' })
  async eraseOrganization(
    @Param('orgId', ParseUUIDPipe) orgId: string,
    @Query('confirm') confirm?: string,
  ) {
    if (confirm !== orgId) {
      throw new ForbiddenException(
        'Confirmation mismatch: pass ?confirm=<orgId> to hard-delete this organization',
      );
    }
    return this.purgeService.eraseOrganization(orgId);
  }
}
