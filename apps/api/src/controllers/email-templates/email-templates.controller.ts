import { Controller, Get, Patch, Param, Body } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
import { EmailTemplateService } from '../../services/email-template.service';
import type { EmailTemplateKey } from '../../services/email-template.registry';
import { TracerService } from '../../common/tracer/tracer.service';
import { ZodValidationPipe } from '../../pipes/zod-validation.pipe';
import { CurrentUser, CurrentUserData } from '../../decorators/current-user.decorator';
import {
  emailTemplateKeyParamsSchema,
  updateEmailTemplateSchema,
} from '../../models/email-template.dto';
import type {
  EmailTemplateKeyParams,
  UpdateEmailTemplateDto,
} from '../../models/email-template.dto';
import { RequirePermission } from '../../decorators/require-permission.decorator';
import { Resource, Action } from '../../common/rbac/rbac.types';

/**
 * Utilities → Email. Lets the founders change transactional email copy without
 * a deploy.
 *
 * SUPER_ADMIN only, and read + update only: templates are seeded by migration,
 * so there is intentionally no create or delete. That keeps the row set in
 * lockstep with the keys the code actually sends.
 *
 * Change history is the audit_logs trail written on every PATCH — that is the
 * agreed substitute for a versioning table.
 */
@ApiTags('Email Templates')
@ApiBearerAuth()
@Controller('email-templates')
export class EmailTemplatesController {
  constructor(
    private readonly templates: EmailTemplateService,
    private readonly tracer: TracerService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List editable email templates' })
  @ApiResponse({ status: 200, description: 'Templates (without html bodies)' })
  @RequirePermission(Resource.EmailTemplate, Action.Read)
  async list() {
    return this.templates.listForEditor();
  }

  @Get(':key')
  @ApiOperation({ summary: 'One template with its html + allowed variables' })
  @ApiParam({ name: 'key', example: 'HANDOVER_REQUESTED' })
  @ApiResponse({ status: 200, description: 'Template + variable descriptors' })
  @RequirePermission(Resource.EmailTemplate, Action.Read)
  async get(
    @Param(new ZodValidationPipe(emailTemplateKeyParamsSchema)) params: EmailTemplateKeyParams,
  ) {
    return this.templates.getForEditor(params.key as EmailTemplateKey);
  }

  @Patch(':key')
  @ApiOperation({ summary: 'Update a template subject + html' })
  @ApiParam({ name: 'key', example: 'HANDOVER_REQUESTED' })
  @ApiResponse({ status: 200, description: 'Updated template' })
  @RequirePermission(Resource.EmailTemplate, Action.Update)
  async update(
    @Param(new ZodValidationPipe(emailTemplateKeyParamsSchema)) params: EmailTemplateKeyParams,
    @Body(new ZodValidationPipe(updateEmailTemplateSchema)) body: UpdateEmailTemplateDto,
    @CurrentUser() user: CurrentUserData,
  ) {
    const key = params.key as EmailTemplateKey;
    const { row, before } = await this.templates.updateFromEditor(key, body, user.id);

    // WHO changed WHAT. Bodies can be ~200KB, so the entry records the subject
    // change verbatim and the body change by size — enough to see that copy
    // moved and who moved it, without bloating audit_logs.
    await this.tracer.logAuditEvent(
      key,
      'EMAIL_TEMPLATE_UPDATED',
      {
        key,
        subjectBefore: before.subject,
        subjectAfter: row.subject,
        htmlChanged: before.html !== row.html,
        htmlLengthBefore: before.html.length,
        htmlLengthAfter: row.html.length,
      },
      { organizationId: user.organizationId ?? undefined },
    );

    return row;
  }
}
