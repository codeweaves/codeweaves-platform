import { Test, TestingModule } from '@nestjs/testing';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { PrismaService } from '../../../src/services/prisma.service';
import {
  requestContextStorage,
  RequestContext,
} from '../../../src/common/tracer/correlation.storage';
import { OrganizationLoggerService } from '../../../src/common/logger/organization.logger';
import { InvitationLoggerService } from '../../../src/common/logger/invitation.logger';
import { UserLoggerService } from '../../../src/common/logger/user.logger';
import { ClerkLoggerService } from '../../../src/common/logger/clerk.logger';
import { EmailLoggerService } from '../../../src/common/logger/email.logger';

describe('TracerService', () => {
  let service: TracerService;

  const mockPrismaService = {
    auditLog: {
      create: jest.fn(),
    },
    eventLog: {
      create: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    delete process.env.EVENT_LOG_ENABLED;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TracerService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<TracerService>(TracerService);
  });

  describe('logAuditEvent', () => {
    it('should write audit event to database with correct fields', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const context: RequestContext = {
        correlationId: 'test-corr-id',
        userId: 'user-uuid',
        clerkId: 'user_123',
        method: 'POST',
        url: '/api/test',
      };

      await requestContextStorage.run(context, async () => {
        await service.logAuditEvent('org-uuid', 'ORGANIZATION_CREATED', {
          response: { name: 'Test Org' },
        });
      });

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          correlationId: 'test-corr-id',
          userId: 'user-uuid',
          clerkId: 'user_123',
          contextId: 'org-uuid',
          organizationId: null,
          agentId: null,
          event: 'ORGANIZATION_CREATED',
          data: { response: { name: 'Test Org' } },
        },
      });
    });

    it('should read correlationId/userId from AsyncLocalStorage', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({});

      const context: RequestContext = {
        correlationId: 'corr-123',
        userId: 'user-456',
        clerkId: 'user_789',
      };

      await requestContextStorage.run(context, async () => {
        await service.logAuditEvent('ctx-1', 'TEST_EVENT', {});
      });

      const createCall = mockPrismaService.auditLog.create.mock.calls[0][0];
      expect(createCall.data.correlationId).toBe('corr-123');
      expect(createCall.data.userId).toBe('user-456');
      expect(createCall.data.clerkId).toBe('user_789');
    });

    it('should handle missing context (no AsyncLocalStorage store)', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({});

      await service.logAuditEvent('ctx-1', 'TEST_EVENT', { test: true });

      expect(mockPrismaService.auditLog.create).toHaveBeenCalledWith({
        data: {
          correlationId: undefined,
          userId: undefined,
          clerkId: undefined,
          contextId: 'ctx-1',
          organizationId: null,
          agentId: null,
          event: 'TEST_EVENT',
          data: { test: true },
        },
      });
    });

    it('auto-fills organizationId from the request context', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({});
      const context: RequestContext = {
        correlationId: 'c',
        userId: 'u',
        organizationId: 'org-from-ctx',
      };

      await requestContextStorage.run(context, async () => {
        await service.logAuditEvent('ctx-1', 'TEST_EVENT', {});
      });

      const data = mockPrismaService.auditLog.create.mock.calls[0][0].data;
      expect(data.organizationId).toBe('org-from-ctx');
      expect(data.agentId).toBeNull();
    });

    it('uses explicit scope over the request context, and stores agentId', async () => {
      mockPrismaService.auditLog.create.mockResolvedValue({});
      const context: RequestContext = {
        correlationId: 'c',
        userId: 'u',
        organizationId: 'org-from-ctx',
      };

      await requestContextStorage.run(context, async () => {
        await service.logAuditEvent('agent-1', 'AGENT_CREATED', {}, {
          organizationId: 'explicit-org',
          agentId: 'agent-1',
        });
      });

      const data = mockPrismaService.auditLog.create.mock.calls[0][0].data;
      expect(data.organizationId).toBe('explicit-org');
      expect(data.agentId).toBe('agent-1');
    });

    it('should catch database errors without throwing', async () => {
      mockPrismaService.auditLog.create.mockRejectedValue(
        new Error('DB connection lost'),
      );

      // Should NOT throw
      await expect(
        service.logAuditEvent('ctx-1', 'TEST_EVENT', {}),
      ).resolves.toBeUndefined();
    });
  });

  describe('logEvent', () => {
    it('writes an event_logs row and auto-fills actor/org/correlation from context', async () => {
      mockPrismaService.eventLog.create.mockResolvedValue({});
      const context: RequestContext = {
        correlationId: 'corr-1',
        userId: 'user-1',
        clerkId: 'clerk_1',
        organizationId: 'org-1',
      };

      await requestContextStorage.run(context, async () => {
        await service.logEvent({
          channel: 'WIDGET',
          eventName: 'WIDGET_MESSAGE_RECEIVED',
          direction: 'INBOUND',
          agentId: 'agent-1',
        });
      });

      const data = mockPrismaService.eventLog.create.mock.calls[0][0].data;
      expect(data).toMatchObject({
        channel: 'WIDGET',
        eventName: 'WIDGET_MESSAGE_RECEIVED',
        direction: 'INBOUND',
        agentId: 'agent-1',
        actorUserId: 'user-1',
        clerkId: 'clerk_1',
        organizationId: 'org-1',
        correlationId: 'corr-1',
        success: true,
      });
    });

    it('lets explicit fields override context', async () => {
      mockPrismaService.eventLog.create.mockResolvedValue({});
      const context: RequestContext = { correlationId: 'corr-1', userId: 'ctx-user' };

      await requestContextStorage.run(context, async () => {
        await service.logEvent({
          channel: 'INTERNAL',
          eventName: 'CLASSIFIER_RUN_STARTED',
          actorUserId: 'explicit-user',
        });
      });

      expect(mockPrismaService.eventLog.create.mock.calls[0][0].data.actorUserId).toBe(
        'explicit-user',
      );
    });

    it('sanitizes headers and never stores authorization', async () => {
      mockPrismaService.eventLog.create.mockResolvedValue({});
      await service.logEvent({
        channel: 'WHATSAPP',
        eventName: 'META_WHATSAPP_SEND_TEXT_COMPLETED',
        requestHeaders: { authorization: 'Bearer x', 'content-type': 'application/json' },
        requestPayload: { to: '+123', token: 'secret' },
      });
      const data = mockPrismaService.eventLog.create.mock.calls[0][0].data;
      expect(data.requestHeaders).toEqual({ 'content-type': 'application/json' });
      expect(data.requestPayload.token).toBe('[REDACTED]');
    });

    it('omits Json columns (not null) when payloads are absent', async () => {
      mockPrismaService.eventLog.create.mockResolvedValue({});
      await service.logEvent({ channel: 'DASHBOARD', eventName: 'X' });
      const data = mockPrismaService.eventLog.create.mock.calls[0][0].data;
      expect(data).not.toHaveProperty('requestHeaders');
      expect(data).not.toHaveProperty('requestPayload');
      expect(data).not.toHaveProperty('responsePayload');
      expect(data).not.toHaveProperty('metadata');
    });

    it('is a no-op when EVENT_LOG_ENABLED=false', async () => {
      process.env.EVENT_LOG_ENABLED = 'false';
      await service.logEvent({ channel: 'DASHBOARD', eventName: 'X' });
      expect(mockPrismaService.eventLog.create).not.toHaveBeenCalled();
    });

    it('never throws when the DB write fails (fire-and-forget)', async () => {
      mockPrismaService.eventLog.create.mockRejectedValue(new Error('DB down'));
      await expect(
        service.logEvent({ channel: 'DASHBOARD', eventName: 'X' }),
      ).resolves.toBeUndefined();
    });
  });

  describe('mergeJsonResponse', () => {
    it('should merge multiple objects correctly', () => {
      const result = service.mergeJsonResponse(
        { response: { id: '1' } },
        { request: { name: 'test' } },
      );

      expect(result).toEqual({
        response: { id: '1' },
        request: { name: 'test' },
      });
    });

    it('should handle single object', () => {
      const result = service.mergeJsonResponse({ response: { ok: true } });
      expect(result).toEqual({ response: { ok: true } });
    });

    it('should override duplicate keys with last value', () => {
      const result = service.mergeJsonResponse(
        { key: 'first' },
        { key: 'second' },
      );
      expect(result).toEqual({ key: 'second' });
    });
  });
});

describe('Entity Logger Services', () => {
  const mockTracerService = {
    logAuditEvent: jest.fn(),
    mergeJsonResponse: jest.fn(),
  };

  beforeEach(() => {
    mockTracerService.logAuditEvent.mockResolvedValue(undefined);
    mockTracerService.mergeJsonResponse.mockImplementation(
      (...objects: Record<string, unknown>[]) => Object.assign({}, ...objects),
    );
  });

  describe('OrganizationLoggerService', () => {
    let logger: OrganizationLoggerService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          OrganizationLoggerService,
          { provide: TracerService, useValue: mockTracerService },
        ],
      }).compile();
      logger = module.get(OrganizationLoggerService);
    });

    it('should log ORGANIZATION_CREATED', async () => {
      await logger.logOrganizationCreated('org-1', { name: 'Test' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'org-1',
        'ORGANIZATION_CREATED',
        { response: { name: 'Test' } },
      );
    });

    it('should log ORGANIZATION_CREATION_EXCEPTION', async () => {
      await logger.logOrganizationCreationException('org-1', new Error('fail'), {
        request: {},
      });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'org-1',
        'ORGANIZATION_CREATION_EXCEPTION',
        expect.objectContaining({ error: { message: expect.any(String) } }),
      );
    });
  });

  describe('InvitationLoggerService', () => {
    let logger: InvitationLoggerService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          InvitationLoggerService,
          { provide: TracerService, useValue: mockTracerService },
        ],
      }).compile();
      logger = module.get(InvitationLoggerService);
    });

    it('should log INVITATION_CREATED', async () => {
      await logger.logInvitationCreated('inv-1', { email: 'test@test.com' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'inv-1',
        'INVITATION_CREATED',
        { response: { email: 'test@test.com' } },
      );
    });

    it('should log INVITATION_CANCELLED', async () => {
      await logger.logInvitationCancelled('inv-1', { id: 'inv-1' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'inv-1',
        'INVITATION_CANCELLED',
        { response: { id: 'inv-1' } },
      );
    });
  });

  describe('UserLoggerService', () => {
    let logger: UserLoggerService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          UserLoggerService,
          { provide: TracerService, useValue: mockTracerService },
        ],
      }).compile();
      logger = module.get(UserLoggerService);
    });

    it('should log USER_FIRST_LOGIN', async () => {
      await logger.logUserFirstLogin('user-1', { email: 'test@test.com' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'USER_FIRST_LOGIN',
        { response: { email: 'test@test.com' } },
      );
    });

    it('should log MEMBER_ASSIGNED_TO_ORGANIZATION', async () => {
      await logger.logMemberAssigned('user-1', { orgId: 'org-1' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'user-1',
        'MEMBER_ASSIGNED_TO_ORGANIZATION',
        { response: { orgId: 'org-1' } },
      );
    });
  });

  describe('ClerkLoggerService', () => {
    let logger: ClerkLoggerService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          ClerkLoggerService,
          { provide: TracerService, useValue: mockTracerService },
        ],
      }).compile();
      logger = module.get(ClerkLoggerService);
    });

    it('should log CLERK_INVITATION_CREATED', async () => {
      await logger.logClerkInvitationCreated('clerk_inv_1', {
        email: 'test@test.com',
      });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'clerk_inv_1',
        'CLERK_INVITATION_CREATED',
        { response: { email: 'test@test.com' } },
      );
    });
  });

  describe('EmailLoggerService', () => {
    let logger: EmailLoggerService;

    beforeEach(async () => {
      const module = await Test.createTestingModule({
        providers: [
          EmailLoggerService,
          { provide: TracerService, useValue: mockTracerService },
        ],
      }).compile();
      logger = module.get(EmailLoggerService);
    });

    it('should log EMAIL_SENT', async () => {
      await logger.logEmailSent('email-1', { to: 'test@test.com' });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'email-1',
        'EMAIL_SENT',
        { response: { to: 'test@test.com' } },
      );
    });

    it('should log EMAIL_SEND_EXCEPTION', async () => {
      await logger.logEmailException('email-1', new Error('SMTP down'), {
        request: { to: 'test@test.com' },
      });
      expect(mockTracerService.logAuditEvent).toHaveBeenCalledWith(
        'email-1',
        'EMAIL_SEND_EXCEPTION',
        expect.objectContaining({ error: { message: expect.any(String) } }),
      );
    });
  });
});
