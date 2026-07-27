import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Role } from '@prisma/client';
import { HandoverService } from '../../../src/services/handover.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { RealtimeService } from '../../../src/services/realtime.service';
import { WhatsappOutboundService } from '../../../src/modules/whatsapp/whatsapp-outbound.service';
import { PiiDetectionService } from '../../../src/modules/pii/pii-detection.service';
import { InternalEventLogger } from '../../../src/common/events/internal.logger';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import { NotificationService } from '../../../src/services/notification.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('HandoverService', () => {
  let service: HandoverService;

  const orgId = '123e4567-e89b-12d3-a456-426614174000';

  const mockPrisma = {
    chatSession: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
    },
    chatMessage: {
      create: jest.fn(),
      findMany: jest.fn(),
    },
    user: { findUnique: jest.fn() },
  };

  const mockRealtime = {
    emitHandover: jest.fn().mockResolvedValue(undefined),
    emitMessage: jest.fn().mockResolvedValue(undefined),
  };

  const mockWhatsappOutbound = {
    deliverHumanReply: jest.fn().mockResolvedValue(undefined),
  };

  const mockEvents = {
    logStarted: jest.fn(),
    logCompleted: jest.fn(),
    logFailed: jest.fn(),
  };

  const mockTracer = { logAuditEvent: jest.fn().mockResolvedValue(undefined) };

  const mockNotifications = { emit: jest.fn().mockResolvedValue(undefined) };

  const clientUser: CurrentUserData = {
    clerkId: 'user_client',
    email: 'client@test.com',
    id: 'client-user-id',
    role: Role.CLIENT,
    organizationId: orgId,
    organization: { id: orgId, name: 'Test Org', slug: 'test-org' },
  };

  const clientNoOrg: CurrentUserData = {
    ...clientUser,
    id: 'client-no-org',
    organizationId: null,
    organization: null,
  };

  const sessionRow = (overrides: Record<string, unknown> = {}) => ({
    id: 'sess-db',
    sessionId: 'sess-pub',
    source: 'WIDGET',
    visitorId: '1.2.3.4',
    handoverState: 'REQUESTED',
    handoverReason: 'USER_REQUESTED',
    handoverRequestedAt: new Date('2026-06-24T10:00:00Z'),
    handoverStartedAt: null,
    handoverResolvedAt: null,
    agent: { id: 'agent-1', name: 'Bot', organizationId: orgId, humanConnectedLabel: null },
    takenOverBy: null,
    ...overrides,
  });

  const ctx = { sessionDbId: 'sess-db', publicSessionId: 'sess-pub', organizationId: orgId };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: RealtimeService, useValue: mockRealtime },
        { provide: ConfigService, useValue: { get: jest.fn() } },
        { provide: WhatsappOutboundService, useValue: mockWhatsappOutbound },
        { provide: InternalEventLogger, useValue: mockEvents },
        { provide: TracerService, useValue: mockTracer },
        { provide: NotificationService, useValue: mockNotifications },
        PiiDetectionService,
      ],
    }).compile();

    service = module.get<HandoverService>(HandoverService);
    jest.clearAllMocks();
    mockRealtime.emitHandover.mockResolvedValue(undefined);
    mockRealtime.emitMessage.mockResolvedValue(undefined);
    mockPrisma.user.findUnique.mockResolvedValue({ name: 'Priya' });
    mockPrisma.chatMessage.create.mockResolvedValue({
      id: 'msg-1',
      role: 'SYSTEM',
      content: 'x',
      createdAt: new Date('2026-06-24T10:01:00Z'),
    });
  });

  describe('detectKeyword', () => {
    it.each([
      'I want to talk to a human',
      'can I speak with a person please',
      'connect me to an agent',
      'I need a real person',
      'get me customer support rep',
    ])('matches "%s"', (text) => {
      expect(service.detectKeyword(text)).toBe(true);
    });

    it.each([
      'what are your hours?',
      'how much does the agent plan cost', // "agent plan" must not trip it
      'thanks, that helps',
    ])('does not match "%s"', (text) => {
      expect(service.detectKeyword(text)).toBe(false);
    });
  });

  describe('stallInstruction', () => {
    it('uses the configured label', () => {
      expect(service.stallInstruction('our support team')).toContain('our support team');
    });
    it('falls back to a default when no label', () => {
      expect(service.stallInstruction(null)).toContain('a member of our team');
    });
    it('always forbids claiming to be human', () => {
      expect(service.stallInstruction(null).toLowerCase()).toContain('never claim to be human');
    });
  });

  describe('raiseRequested', () => {
    it('flips NONE → REQUESTED, writes a system line, and emits', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });

      await service.raiseRequested(ctx, 'USER_REQUESTED');

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-db', handoverState: 'NONE' },
        data: expect.objectContaining({ handoverState: 'REQUESTED', handoverReason: 'USER_REQUESTED' }),
      });
      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'SYSTEM' }) }),
      );
      expect(mockRealtime.emitHandover).toHaveBeenCalled();
      expect(mockRealtime.emitMessage).toHaveBeenCalled();
      expect(mockEvents.logCompleted).toHaveBeenCalledWith(
        'HANDOVER_REQUESTED',
        expect.objectContaining({ sessionId: 'sess-pub', organizationId: orgId }),
      );
    });

    it('clears the prior cycle stamps so a re-escalation starts clean', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });

      await service.raiseRequested(ctx, 'USER_REQUESTED');

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-db', handoverState: 'NONE' },
        data: expect.objectContaining({
          handoverStartedAt: null,
          handoverResolvedAt: null,
          takenOverById: null,
        }),
      });
    });

    it('is a no-op when the session is no longer NONE (race-safe)', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 0 });

      await service.raiseRequested(ctx, 'USER_REQUESTED');

      expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
      expect(mockRealtime.emitHandover).not.toHaveBeenCalled();
      expect(mockEvents.logCompleted).not.toHaveBeenCalled();
    });

    it('never throws (fail-open) when the DB write fails', async () => {
      mockPrisma.chatSession.updateMany.mockRejectedValue(new Error('db down'));
      await expect(service.raiseRequested(ctx, 'USER_REQUESTED')).resolves.toBeUndefined();
    });
  });

  // The dashboard notification is fired off the hot path (`void`), so these
  // assertions flush the microtask queue before checking.
  describe('handover-requested notification', () => {
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    const agentRow = (overrides: Record<string, unknown> = {}) => ({
      agent: {
        id: 'agent-1',
        name: 'Support Bot',
        handoverEmailEnabled: false,
        handoverEmailRecipients: [],
        organization: { name: 'Acme Corp' },
        ...overrides,
      },
    });

    beforeEach(() => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.chatSession.findUnique.mockResolvedValue(agentRow());
    });

    it('raises an URGENT notification naming the agent', async () => {
      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();

      expect(mockNotifications.emit).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: orgId,
          agentId: 'agent-1',
          type: 'HANDOVER_REQUESTED',
          severity: 'URGENT',
          title: 'A visitor asked for a human on Support Bot',
          entityType: 'conversation',
          entityId: 'sess-pub',
        }),
      );
    });

    // The title rides the socket into a toast and an OS popup — it must carry
    // no visitor message content.
    it('puts no visitor content in the title', async () => {
      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();

      const input = mockNotifications.emit.mock.calls[0][0] as { title: string };
      expect(input.title).toBe('A visitor asked for a human on Support Bot');
    });

    it('passes email off when the agent has the toggle off', async () => {
      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();

      const input = mockNotifications.emit.mock.calls[0][0] as {
        email: { enabled: boolean };
      };
      expect(input.email.enabled).toBe(false);
    });

    it('passes the agent recipients through when the toggle is on', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        agentRow({
          handoverEmailEnabled: true,
          handoverEmailRecipients: ['ops@acme.com'],
        }),
      );

      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();

      const input = mockNotifications.emit.mock.calls[0][0] as {
        email: {
          enabled: boolean;
          recipients: string[];
          templateKey: string;
          vars: Record<string, string>;
        };
      };
      expect(input.email.enabled).toBe(true);
      expect(input.email.recipients).toEqual(['ops@acme.com']);
      expect(input.email.templateKey).toBe('HANDOVER_REQUESTED');
      expect(input.email.vars).toMatchObject({
        orgName: 'Acme Corp',
        agentName: 'Support Bot',
      });
    });

    // A publicSessionId is a bearer credential for the unauthenticated public
    // chat endpoints, so it must never be handed to the email layer. The link is
    // built from the notification id instead (NotificationService.deepLink).
    it('never puts the session id in the email variables', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(
        agentRow({
          handoverEmailEnabled: true,
          handoverEmailRecipients: ['ops@acme.com'],
        }),
      );

      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();

      const input = mockNotifications.emit.mock.calls[0][0] as {
        email: { vars: Record<string, string> };
      };
      expect(JSON.stringify(input.email.vars)).not.toContain('sess-pub');
      expect(input.email.vars).not.toHaveProperty('conversationUrl');
    });

    it('does not notify when the flip was a no-op', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 0 });
      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();
      expect(mockNotifications.emit).not.toHaveBeenCalled();
    });

    it('skips the notification when the session has no agent', async () => {
      mockPrisma.chatSession.findUnique.mockResolvedValue(null);
      await service.raiseRequested(ctx, 'USER_REQUESTED');
      await flush();
      expect(mockNotifications.emit).not.toHaveBeenCalled();
    });

    it('never lets a notification failure break the escalation', async () => {
      mockNotifications.emit.mockRejectedValueOnce(new Error('notify down'));
      await expect(
        service.raiseRequested(ctx, 'USER_REQUESTED'),
      ).resolves.toBeUndefined();
      await flush();
      // The escalation itself still happened.
      expect(mockRealtime.emitHandover).toHaveBeenCalled();
    });

    it('never lets an agent lookup failure break the escalation', async () => {
      mockPrisma.chatSession.findUnique.mockRejectedValueOnce(new Error('db down'));
      await expect(
        service.raiseRequested(ctx, 'USER_REQUESTED'),
      ).resolves.toBeUndefined();
      await flush();
      expect(mockRealtime.emitHandover).toHaveBeenCalled();
    });
  });

  describe('offerInstruction', () => {
    it('tells the bot to offer + names the connect_to_human tool', () => {
      const text = service.offerInstruction();
      expect(text).toContain('connect_to_human');
      expect(text.toLowerCase()).toContain('frustrated');
      // Must never let the bot impersonate a human.
      expect(text.toLowerCase()).toContain('never claim to be a human');
    });
  });

  describe('buildConnectTool', () => {
    it('on execute: raises REQUESTED and reports the reason back to the caller', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });
      const onEscalate = jest.fn();
      const t = service.buildConnectTool(ctx, onEscalate);

      // The AI SDK tool exposes an execute(args, options) callback.
      const result = await t.execute!(
        { reason: 'explicit_request' },
        { toolCallId: 'tc-1', messages: [] },
      );

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith({
        where: { id: 'sess-db', handoverState: 'NONE' },
        data: expect.objectContaining({ handoverState: 'REQUESTED', handoverReason: 'USER_REQUESTED' }),
      });
      expect(onEscalate).toHaveBeenCalledWith('USER_REQUESTED');
      expect(result).toEqual(expect.objectContaining({ status: 'connecting' }));
    });

    it('maps a frustration call to the FRUSTRATION reason', async () => {
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });
      const onEscalate = jest.fn();
      const t = service.buildConnectTool(ctx, onEscalate);

      await t.execute!({ reason: 'frustration' }, { toolCallId: 'tc-2', messages: [] });

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ handoverReason: 'FRUSTRATION' }),
        }),
      );
      expect(onEscalate).toHaveBeenCalledWith('FRUSTRATION');
    });
  });

  describe('maybeRaiseFromFallback', () => {
    it('does nothing when the current turn answered fine', async () => {
      await service.maybeRaiseFromFallback(ctx, false);
      expect(mockPrisma.chatMessage.findMany).not.toHaveBeenCalled();
      expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
    });

    it('raises when current + the prior turn both could not answer', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([{ metrics: { couldntAnswer: true } }]);
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });

      await service.maybeRaiseFromFallback(ctx, true);

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ handoverReason: 'BOT_FALLBACK' }) }),
      );
    });

    it('does not raise when the prior turn answered fine (streak broken)', async () => {
      mockPrisma.chatMessage.findMany.mockResolvedValue([{ metrics: { couldntAnswer: false } }]);

      await service.maybeRaiseFromFallback(ctx, true);

      expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('listInbox', () => {
    beforeEach(() => mockPrisma.chatSession.findMany.mockResolvedValue([]));

    it('CLIENT without an org is rejected', async () => {
      await expect(service.listInbox({ filter: 'needs' }, clientNoOrg)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('maps "needs" → [REQUESTED] and scopes to the client org', async () => {
      await service.listInbox({ filter: 'needs' }, clientUser);
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.handoverState).toEqual({ in: ['REQUESTED'] });
      expect(arg.where.agent).toEqual(expect.objectContaining({ organizationId: orgId }));
    });

    it('maps "all" → [REQUESTED, ACTIVE_HUMAN]', async () => {
      await service.listInbox({ filter: 'all' }, clientUser);
      const arg = mockPrisma.chatSession.findMany.mock.calls[0][0];
      expect(arg.where.handoverState).toEqual({ in: ['REQUESTED', 'ACTIVE_HUMAN'] });
    });
  });

  describe('takeover', () => {
    it('sets ACTIVE_HUMAN, stamps the user, writes a system line, emits', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 1 });
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);

      await service.takeover('sess-pub', clientUser);

      expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ handoverState: { not: 'ACTIVE_HUMAN' } }),
          data: expect.objectContaining({
            handoverState: 'ACTIVE_HUMAN',
            takenOverById: 'client-user-id',
          }),
        }),
      );
      expect(mockRealtime.emitHandover).toHaveBeenCalled();
      expect(mockEvents.logCompleted).toHaveBeenCalledWith(
        'HANDOVER_TAKEN_OVER',
        expect.objectContaining({ agentId: 'agent-1', sessionId: 'sess-pub' }),
      );
      // …and the accountability trail gets its own scoped audit row.
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        'sess-pub',
        'HANDOVER_TAKEN_OVER',
        expect.anything(),
        { organizationId: orgId, agentId: 'agent-1' },
      );
    });

    it('no-ops (no emit) when another teammate already took over', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow());
      mockPrisma.chatSession.updateMany.mockResolvedValue({ count: 0 });
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);

      await service.takeover('sess-pub', clientUser);

      expect(mockRealtime.emitHandover).not.toHaveBeenCalled();
    });

    it('throws NotFound when the session is not in the user scope', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(null);
      await expect(service.takeover('nope', clientUser)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('postMessage', () => {
    it('rejects when the conversation is not being handled', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow({ handoverState: 'REQUESTED' }));
      await expect(service.postMessage('sess-pub', clientUser, 'hi')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('creates a HUMAN_AGENT message when handling', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow({ handoverState: 'ACTIVE_HUMAN' }));
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm2',
        role: 'HUMAN_AGENT',
        content: 'hello there',
        createdAt: new Date('2026-06-24T10:05:00Z'),
      });
      mockPrisma.chatSession.update.mockResolvedValue({});

      const res = await service.postMessage('sess-pub', clientUser, 'hello there');

      expect(mockPrisma.chatMessage.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ role: 'HUMAN_AGENT' }) }),
      );
      expect(res).toEqual(expect.objectContaining({ role: 'HUMAN_AGENT', author: 'Priya' }));
      expect(mockRealtime.emitMessage).toHaveBeenCalled();
      // Widget chats receive via the poll — no WhatsApp outbound.
      expect(mockWhatsappOutbound.deliverHumanReply).not.toHaveBeenCalled();
    });

    it('delivers the reply out to WhatsApp when the session source is WHATSAPP', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(
        sessionRow({ handoverState: 'ACTIVE_HUMAN', source: 'WHATSAPP', visitorId: '+15551234567' }),
      );
      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'm3',
        role: 'HUMAN_AGENT',
        content: 'on my way',
        createdAt: new Date('2026-06-24T10:06:00Z'),
      });
      mockPrisma.chatSession.update.mockResolvedValue({});

      await service.postMessage('sess-pub', clientUser, 'on my way');

      // agent.id from sessionRow, visitorId = the WhatsApp phone, verbatim text.
      expect(mockWhatsappOutbound.deliverHumanReply).toHaveBeenCalledWith(
        'agent-1',
        '+15551234567',
        'on my way',
      );
    });
  });

  describe('resolve', () => {
    it('flips back to NONE and stamps handoverResolvedAt', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow({ handoverState: 'ACTIVE_HUMAN' }));
      mockPrisma.chatSession.update.mockResolvedValue({});
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);

      await service.resolve('sess-pub', clientUser);

      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ handoverState: 'NONE', handoverResolvedAt: expect.any(Date) }),
        }),
      );
      expect(mockEvents.logCompleted).toHaveBeenCalledWith(
        'HANDOVER_RESOLVED',
        expect.objectContaining({ agentId: 'agent-1', sessionId: 'sess-pub' }),
      );
    });

    it('is a no-op write when already NONE', async () => {
      mockPrisma.chatSession.findFirst.mockResolvedValue(sessionRow({ handoverState: 'NONE' }));
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);

      await service.resolve('sess-pub', clientUser);

      expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
    });
  });

  describe('sweepIdleHandovers', () => {
    it('auto-resolves idle handovers back to NONE + emits', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([
        { id: 'sess-db', sessionId: 'sess-pub', agent: { organizationId: orgId } },
      ]);
      mockPrisma.chatSession.update.mockResolvedValue({});

      const res = await service.sweepIdleHandovers(20);

      expect(res.resolved).toBe(1);
      expect(mockPrisma.chatSession.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            handoverState: 'NONE',
            handoverResolvedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockRealtime.emitHandover).toHaveBeenCalled();
      // Cron liveness / result observability.
      expect(mockEvents.logCompleted).toHaveBeenCalledWith(
        'HANDOVER_SWEEP_COMPLETED',
        expect.objectContaining({ metadata: expect.objectContaining({ resolved: 1 }) }),
      );
    });

    it('resolves nothing when none are idle', async () => {
      mockPrisma.chatSession.findMany.mockResolvedValue([]);
      const res = await service.sweepIdleHandovers(20);
      expect(res.resolved).toBe(0);
      expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
    });
  });
});
