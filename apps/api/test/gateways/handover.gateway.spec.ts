import { Test, TestingModule } from '@nestjs/testing';
import { HandoverGateway } from '../../src/gateways/handover.gateway';
import { WsAuthService } from '../../src/common/ws/ws-auth.service';

describe('HandoverGateway', () => {
  let gateway: HandoverGateway;
  let emit: jest.Mock;
  let to: jest.Mock;

  const orgId = '123e4567-e89b-12d3-a456-426614174000';

  const mockWsAuth = { resolveScope: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        HandoverGateway,
        { provide: WsAuthService, useValue: mockWsAuth },
      ],
    }).compile();

    gateway = module.get(HandoverGateway);

    emit = jest.fn();
    to = jest.fn().mockReturnValue({ emit });
    (gateway as unknown as { server: unknown }).server = { to };
  });

  describe('emitNotification', () => {
    const payload = {
      id: 'notif-1',
      type: 'HANDOVER_REQUESTED',
      severity: 'URGENT',
      title: 'A visitor asked for a human on Support Bot',
      entityType: 'conversation',
      entityId: 'sess-pub',
      createdAt: '2026-07-27T10:00:00.000Z',
    };

    it('emits into the org room', () => {
      gateway.emitNotification(orgId, payload);

      expect(to).toHaveBeenCalledWith(`org:${orgId}`);
      expect(emit).toHaveBeenCalledWith('notification', payload);
    });

    // Platform staff (ADMIN/SUPER_ADMIN with no org) already see every org's
    // handovers in the Inbox. Omitting them here left them able to see a waiting
    // conversation but never be told about it — so the notification follows the
    // same scope as emitHandover.
    it('also emits into the platform room so platform staff are notified', () => {
      gateway.emitNotification(orgId, payload);

      const rooms = to.mock.calls.map((c) => c[0] as string);
      expect(rooms).toEqual([`org:${orgId}`, 'platform']);
    });

    // The widget's socket only ever resolves to a session room, so keeping
    // notifications out of session rooms is what stops a visitor receiving them.
    it('does not emit into any session room', () => {
      gateway.emitNotification(orgId, payload);

      const rooms = to.mock.calls.map((c) => c[0] as string);
      expect(rooms.some((r) => r.startsWith('session:'))).toBe(false);
    });

    it('emits once per room and no more', () => {
      gateway.emitNotification(orgId, payload);
      expect(emit).toHaveBeenCalledTimes(2);
    });
  });

  describe('emitHandover / emitMessage (unchanged contract)', () => {
    it('emitHandover reaches session + org + platform', () => {
      gateway.emitHandover('sess-pub', orgId, 'REQUESTED');

      const rooms = to.mock.calls.map((c) => c[0] as string);
      expect(rooms).toEqual(['session:sess-pub', `org:${orgId}`, 'platform']);
    });

    it('emitMessage carries no message content', () => {
      gateway.emitMessage('sess-pub', orgId);

      for (const call of emit.mock.calls) {
        expect(call[1]).toEqual({ sessionId: 'sess-pub' });
      }
    });
  });
});
