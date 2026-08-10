import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { NotFoundException } from '@nestjs/common';
import { Role, AccessScope } from '@prisma/client';
import { EmailTemplatesController } from '../../../src/controllers/email-templates/email-templates.controller';
import { EmailTemplateService } from '../../../src/services/email-template.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { PermissionGuard } from '../../../src/guards/permission.guard';
import {
  emailTemplateKeyParamsSchema,
  updateEmailTemplateSchema,
} from '../../../src/models/email-template.dto';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('EmailTemplatesController', () => {
  let controller: EmailTemplatesController;

  const mockService = {
    listForEditor: jest.fn(),
    getForEditor: jest.fn(),
    updateFromEditor: jest.fn(),
  };
  const mockTracer = { logAuditEvent: jest.fn().mockResolvedValue(undefined) };

  const orgId = '123e4567-e89b-12d3-a456-426614174000';
  const superAdmin: CurrentUserData = {
    clerkId: 'user_super',
    email: 'super@test.com',
    id: 'super-user-id',
    role: Role.SUPER_ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.super_admin'],
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [EmailTemplatesController],
      providers: [
        { provide: EmailTemplateService, useValue: mockService },
        { provide: TracerService, useValue: mockTracer },
        Reflector,
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(EmailTemplatesController);
    jest.clearAllMocks();
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  // Email copy goes to every customer — this must never widen past the founders.
  it('declares a permission on every route', () => {
      // Authorization moved from a class-level @Roles to a per-route
      // @RequirePermission, so the check is that no route was left undeclared.
      for (const method of ['list', 'get', 'update']) {
        const permission = Reflect.getMetadata(
          'permission',
          (EmailTemplatesController.prototype as unknown as Record<string, unknown>)[method] as object,
        );
        expect(permission).toBeDefined();
      }
    });

  // Rows are seeded by migration; exposing create/delete would let the row set
  // drift from the keys the code actually sends.
  it('exposes no create or delete handler', () => {
    const proto = EmailTemplatesController.prototype as unknown as Record<string, unknown>;
    expect(proto.create).toBeUndefined();
    expect(proto.remove).toBeUndefined();
    expect(proto.delete).toBeUndefined();
  });

  it('list() delegates to the service', async () => {
    mockService.listForEditor.mockResolvedValue([]);
    await controller.list();
    expect(mockService.listForEditor).toHaveBeenCalled();
  });

  it('get() delegates the key', async () => {
    mockService.getForEditor.mockResolvedValue({ key: 'HANDOVER_REQUESTED' });
    await controller.get({ key: 'HANDOVER_REQUESTED' });
    expect(mockService.getForEditor).toHaveBeenCalledWith('HANDOVER_REQUESTED');
  });

  describe('update()', () => {
    const body = { subject: 'New subject', html: '<p>new</p>' };

    beforeEach(() => {
      mockService.updateFromEditor.mockResolvedValue({
        row: { key: 'HANDOVER_REQUESTED', subject: 'New subject', html: '<p>new</p>' },
        before: { subject: 'Old subject', html: '<p>old</p>' },
      });
    });

    it('passes the acting user id as updatedBy', async () => {
      await controller.update({ key: 'HANDOVER_REQUESTED' }, body, superAdmin);
      expect(mockService.updateFromEditor).toHaveBeenCalledWith(
        'HANDOVER_REQUESTED',
        body,
        superAdmin.id,
      );
    });

    // The audit trail IS the change history — this is the agreed substitute for
    // a versioning table, so it has to actually be written.
    it('writes an EMAIL_TEMPLATE_UPDATED audit entry with before/after', async () => {
      await controller.update({ key: 'HANDOVER_REQUESTED' }, body, superAdmin);

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        'HANDOVER_REQUESTED',
        'EMAIL_TEMPLATE_UPDATED',
        expect.objectContaining({
          key: 'HANDOVER_REQUESTED',
          subjectBefore: 'Old subject',
          subjectAfter: 'New subject',
          htmlChanged: true,
          htmlLengthBefore: '<p>old</p>'.length,
          htmlLengthAfter: '<p>new</p>'.length,
        }),
        { organizationId: orgId },
      );
    });

    it('records htmlChanged false when only the subject moved', async () => {
      mockService.updateFromEditor.mockResolvedValue({
        row: { key: 'HANDOVER_REQUESTED', subject: 'New', html: '<p>same</p>' },
        before: { subject: 'Old', html: '<p>same</p>' },
      });
      await controller.update({ key: 'HANDOVER_REQUESTED' }, body, superAdmin);

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        expect.anything(),
        'EMAIL_TEMPLATE_UPDATED',
        expect.objectContaining({ htmlChanged: false }),
        expect.anything(),
      );
    });

    // The body can be ~200KB; writing it verbatim into audit_logs would bloat it.
    it('does not write the html body into the audit entry', async () => {
      await controller.update({ key: 'HANDOVER_REQUESTED' }, body, superAdmin);
      const data = mockTracer.logAuditEvent.mock.calls[0][2] as Record<string, unknown>;
      expect(data).not.toHaveProperty('html');
      expect(data).not.toHaveProperty('htmlBefore');
      expect(data).not.toHaveProperty('htmlAfter');
    });

    it('propagates a missing-template error', async () => {
      mockService.updateFromEditor.mockRejectedValue(new NotFoundException());
      await expect(
        controller.update({ key: 'HANDOVER_REQUESTED' }, body, superAdmin),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('validation', () => {
    it('accepts only registered template keys', () => {
      expect(
        emailTemplateKeyParamsSchema.parse({ key: 'HANDOVER_REQUESTED' }),
      ).toEqual({ key: 'HANDOVER_REQUESTED' });
      expect(emailTemplateKeyParamsSchema.parse({ key: 'TEAM_INVITATION' })).toEqual({
        key: 'TEAM_INVITATION',
      });
    });

    it('rejects an unknown key', () => {
      expect(() => emailTemplateKeyParamsSchema.parse({ key: 'MADE_UP' })).toThrow();
    });

    it('requires a non-empty subject and html', () => {
      expect(() =>
        updateEmailTemplateSchema.parse({ subject: '', html: '<p>x</p>' }),
      ).toThrow();
      expect(() =>
        updateEmailTemplateSchema.parse({ subject: 'S', html: '' }),
      ).toThrow();
    });

    it('rejects a subject longer than 300 chars', () => {
      expect(() =>
        updateEmailTemplateSchema.parse({ subject: 'x'.repeat(301), html: 'y' }),
      ).toThrow();
    });

    it('rejects an html body over the 200KB ceiling', () => {
      expect(() =>
        updateEmailTemplateSchema.parse({
          subject: 'S',
          html: 'x'.repeat(200_001),
        }),
      ).toThrow();
    });

    it('trims the subject', () => {
      expect(
        updateEmailTemplateSchema.parse({ subject: '  Hi  ', html: 'y' }).subject,
      ).toBe('Hi');
    });

    it('ignores extra fields so name/key cannot be moved by an edit', () => {
      const parsed = updateEmailTemplateSchema.parse({
        subject: 'S',
        html: 'y',
        key: 'SOMETHING_ELSE',
        name: 'Renamed',
      });
      expect(parsed).toEqual({ subject: 'S', html: 'y' });
    });
  });
});
