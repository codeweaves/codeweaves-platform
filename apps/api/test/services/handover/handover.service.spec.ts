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

  const adminUser: CurrentUserData = {
    ...clientUser,
    id: 'admin-user-id',
    role: Role.ADMIN,
  };

  const superAdminUser: CurrentUserData = {
    ...clientUser,
    id: 'super-admin-user-id',
    role: Role.SUPER_ADMIN,
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
    takenOverById: null,
    takenOverBy: null,
    ...overrides,
  });

  /** A conversation already claimed by someone. Defaults to a DIFFERENT user. */
  const heldBy = (
    userId = 'other-user-id',
    name: string | null = 'Priya',
    overrides: Record<string, unknown> = {},
  ) =>
    sessionRow({
      handoverState: 'ACTIVE_HUMAN',
      handoverStartedAt: new Date('2026-06-24T10:05:00Z'),
      takenOverById: userId,
      takenOverBy: { id: userId, name },
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

    // Simultaneous clicks: both callers saw state REQUESTED, so the guard can't
    // help — the DB claim decides, and the loser just gets the claimed thread.
    it('no-ops (no emit) when a simultaneous click won the claim first', async () => {
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

  /**
   * One teammate owns a live conversation at a time. Before this guard existed,
   * `takeover` silently returned the thread (so the second person believed they
   * had it) and `postMessage`/`resolve` only checked that SOMEONE had taken over
   * — not that it was the caller. Two staff could answer the same visitor as the
   * same brand.
   */
  describe('single-owner guard', () => {
    /**
     * The session state these tests are running against, so the updateMany mock
     * below can answer faithfully. Set by each test via `given()`.
     */
    let current: { handoverState: string; takenOverById: string | null };

    const given = (row: ReturnType<typeof sessionRow>) => {
      current = {
        handoverState: row.handoverState as string,
        takenOverById: row.takenOverById as string | null,
      };
      mockPrisma.chatSession.findFirst.mockResolvedValue(row);
      return row;
    };

    beforeEach(() => {
      current = { handoverState: 'REQUESTED', takenOverById: null };
      mockPrisma.chatMessage.findMany.mockResolvedValue([]);

      // A FAITHFUL mock, not a blanket `{ count: 1 }`. The previous version
      // returned 1 for any where-clause, which hid a real bug: the SUPER_ADMIN
      // override filtered on `handoverState != ACTIVE_HUMAN` against a session
      // that WAS ACTIVE_HUMAN, so the real DB would have matched zero rows and
      // the override silently did nothing. Evaluating the clause here means the
      // test can actually fail on that.
      mockPrisma.chatSession.updateMany.mockImplementation(
        (args: {
          where: {
            handoverState?: { not?: string };
            takenOverById?: string | null;
          };
        }) => {
          const { where } = args;
          if (where.handoverState?.not !== undefined) {
            return Promise.resolve({
              count: current.handoverState === where.handoverState.not ? 0 : 1,
            });
          }
          if (where.takenOverById !== undefined) {
            return Promise.resolve({
              count: current.takenOverById === where.takenOverById ? 1 : 0,
            });
          }
          return Promise.resolve({ count: 1 });
        },
      );

      mockPrisma.chatMessage.create.mockResolvedValue({
        id: 'msg-1',
        role: 'HUMAN_AGENT',
        content: 'hi',
        createdAt: new Date(),
      });
      mockPrisma.user.findUnique.mockResolvedValue({ name: 'Me' });
    });

    describe('takeover', () => {
      it('rejects with a 409 naming who holds it', async () => {
        given(heldBy());

        await expect(service.takeover('sess-pub', clientUser)).rejects.toBeInstanceOf(
          ConflictException,
        );
        await expect(service.takeover('sess-pub', clientUser)).rejects.toThrow(/Priya/);
      });

      it('does not claim or emit when rejected', async () => {
        given(heldBy());

        await expect(service.takeover('sess-pub', clientUser)).rejects.toThrow();

        expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
        expect(mockRealtime.emitHandover).not.toHaveBeenCalled();
        expect(mockTracer.logAuditEvent).not.toHaveBeenCalled();
      });

      // Re-clicking your own active chat must stay harmless.
      it('is idempotent for the holder', async () => {
        given(heldBy(clientUser.id, 'Me'));

        await expect(service.takeover('sess-pub', clientUser)).resolves.toBeDefined();
      });

      it('falls back to a generic name when the holder has none', async () => {
        given(heldBy('other-user-id', null));

        await expect(service.takeover('sess-pub', clientUser)).rejects.toThrow(
          /another teammate/,
        );
      });

      // An ADMIN is a peer of whoever is handling the chat, so seizing it would
      // be the same hijack this guard prevents. Only SUPER_ADMIN overrides.
      it('does NOT let an ADMIN override', async () => {
        given(heldBy());

        await expect(service.takeover('sess-pub', adminUser)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.chatSession.updateMany).not.toHaveBeenCalled();
      });

      // The single escape hatch, for a chat left open by someone who went home.
      // NOTE: `resolves` alone is NOT proof of success here — the pre-fix code
      // also resolved, by silently returning the unchanged thread. These assert
      // the claim actually landed.
      it('lets a SUPER_ADMIN override, and the claim actually lands', async () => {
        given(heldBy());

        await expect(service.takeover('sess-pub', superAdminUser)).resolves.toBeDefined();

        // Reassigned to the overriding user...
        expect(mockPrisma.chatSession.updateMany).toHaveBeenCalledWith(
          expect.objectContaining({
            data: expect.objectContaining({ takenOverById: superAdminUser.id }),
          }),
        );
        // ...and the side effects of a real takeover happened, which they do not
        // when the update matches zero rows.
        expect(mockRealtime.emitHandover).toHaveBeenCalled();
        expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
          'sess-pub',
          'HANDOVER_TAKEN_OVER',
          expect.anything(),
          expect.anything(),
        );
      });

      // The seize matches on the holder we observed, so it keeps the same
      // optimistic-concurrency property as the normal path.
      it('does not clobber when the holder changed under the SUPER_ADMIN', async () => {
        given(heldBy('other-user-id'));
        // Someone else seized it between our read and our write.
        current.takenOverById = 'a-third-user';

        await service.takeover('sess-pub', superAdminUser);

        expect(mockRealtime.emitHandover).not.toHaveBeenCalled();
      });
    });

    describe('postMessage', () => {
      // The important one: a state-only check would have allowed this.
      it('rejects a reply into a chat another teammate holds', async () => {
        given(heldBy());

        await expect(
          service.postMessage('sess-pub', clientUser, 'hello'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
      });

      it('allows the holder to reply', async () => {
        given(heldBy(clientUser.id, 'Me'));

        await expect(
          service.postMessage('sess-pub', clientUser, 'hello'),
        ).resolves.toBeDefined();
        expect(mockPrisma.chatMessage.create).toHaveBeenCalled();
      });

      it('rejects an ADMIN replying into a chat someone else holds', async () => {
        given(heldBy());

        await expect(
          service.postMessage('sess-pub', adminUser, 'hello'),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(mockPrisma.chatMessage.create).not.toHaveBeenCalled();
      });

      it('allows a SUPER_ADMIN to reply', async () => {
        given(heldBy());

        await expect(
          service.postMessage('sess-pub', superAdminUser, 'hello'),
        ).resolves.toBeDefined();
      });
    });

    describe('resolve', () => {
      it("rejects resolving another teammate's active chat", async () => {
        given(heldBy());

        await expect(service.resolve('sess-pub', clientUser)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
      });

      it('allows the holder to resolve', async () => {
        given(heldBy(clientUser.id, 'Me'));
        mockPrisma.chatSession.update.mockResolvedValue({});

        await expect(service.resolve('sess-pub', clientUser)).resolves.toBeDefined();
      });

      it("rejects an ADMIN resolving someone else's chat", async () => {
        given(heldBy());

        await expect(service.resolve('sess-pub', adminUser)).rejects.toBeInstanceOf(
          ConflictException,
        );
        expect(mockPrisma.chatSession.update).not.toHaveBeenCalled();
      });

      it('allows a SUPER_ADMIN to resolve', async () => {
        given(heldBy());
        mockPrisma.chatSession.update.mockResolvedValue({});

        await expect(service.resolve('sess-pub', superAdminUser)).resolves.toBeDefined();
      });

      // A bot-handled chat has no owner, so nothing to conflict with.
      it('is unaffected when nobody holds the chat', async () => {
        given(sessionRow({ handoverState: 'NONE' }));

        await expect(service.resolve('sess-pub', clientUser)).resolves.toBeDefined();
      });
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
