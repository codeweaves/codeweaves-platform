import { ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { CryptoService } from '../../../src/common/crypto/crypto.service';
import type { TracerService } from '../../../src/common/tracer/tracer.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';
import { WhatsappChannelService } from '../../../src/modules/whatsapp/whatsapp-channel.service';
import type { AgentsService } from '../../../src/services/agents.service';
import type { PrismaService } from '../../../src/services/prisma.service';

describe('WhatsappChannelService', () => {
  let prisma: {
    whatsappChannel: {
      findUnique: jest.Mock;
      upsert: jest.Mock;
      deleteMany: jest.Mock;
      update: jest.Mock;
    };
  };
  let crypto: { encrypt: jest.Mock };
  let agents: { findById: jest.Mock };
  let tracer: { logAuditEvent: jest.Mock };
  let service: WhatsappChannelService;

  const user = { id: 'u', organizationId: 'org' } as unknown as CurrentUserData;

  const channelRow = {
    id: 'c1',
    agentId: 'a1',
    wabaId: 'w1',
    phoneNumberId: 'p1',
    displayPhone: '+1 555 010 1234',
    verifiedName: null,
    accessTokenEnc: 'enc',
    tokenExpiresAt: null,
    status: 'CONNECTED',
    voiceReplyEnabled: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-02'),
  };

  beforeEach(() => {
    prisma = {
      whatsappChannel: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
        deleteMany: jest.fn(),
        update: jest.fn(),
      },
    };
    crypto = { encrypt: jest.fn().mockReturnValue('enc') };
    agents = { findById: jest.fn().mockResolvedValue({ id: 'a1' }) };
    tracer = { logAuditEvent: jest.fn().mockResolvedValue(undefined) };
    service = new WhatsappChannelService(
      prisma as unknown as PrismaService,
      crypto as unknown as CryptoService,
      agents as unknown as AgentsService,
      tracer as unknown as TracerService,
    );
  });

  const dto = {
    wabaId: 'w1',
    phoneNumberId: 'p1',
    displayPhone: '+1 555 010 1234',
    accessToken: 'PLAINTEXT_TOKEN',
  };

  it('connect: authorizes, encrypts the token, upserts, returns a token-free view', async () => {
    prisma.whatsappChannel.upsert.mockResolvedValue(channelRow);

    const view = await service.connect('a1', dto, user);

    expect(agents.findById).toHaveBeenCalledWith('a1', user);
    expect(crypto.encrypt).toHaveBeenCalledWith('PLAINTEXT_TOKEN');
    expect(prisma.whatsappChannel.upsert).toHaveBeenCalledTimes(1);
    expect(view.phoneNumberId).toBe('p1');
    expect(view.status).toBe('CONNECTED');
    expect(view).not.toHaveProperty('accessTokenEnc');
    expect(view).not.toHaveProperty('accessToken');
  });

  it('connect: writes a WHATSAPP_CHANNEL_CONNECTED audit event without the token', async () => {
    prisma.whatsappChannel.upsert.mockResolvedValue(channelRow);

    await service.connect('a1', dto, user);

    expect(tracer.logAuditEvent).toHaveBeenCalledWith(
      'a1',
      'WHATSAPP_CHANNEL_CONNECTED',
      expect.anything(),
      { agentId: 'a1' },
    );
    // The plaintext token must never reach the audit trail.
    const auditArg = JSON.stringify(tracer.logAuditEvent.mock.calls[0]);
    expect(auditArg).not.toContain('PLAINTEXT_TOKEN');
  });

  it('connect: maps a unique-constraint violation (P2002) to ConflictException', async () => {
    prisma.whatsappChannel.upsert.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('dup', {
        code: 'P2002',
        clientVersion: '7.3.0',
      }),
    );

    await expect(service.connect('a1', dto, user)).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('connect: refuses when agent authorization fails', async () => {
    agents.findById.mockRejectedValue(new Error('forbidden'));

    await expect(service.connect('a1', dto, user)).rejects.toThrow('forbidden');
    expect(prisma.whatsappChannel.upsert).not.toHaveBeenCalled();
  });

  it('getByAgent: returns null when no channel exists', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(null);

    expect(await service.getByAgent('a1', user)).toBeNull();
    expect(agents.findById).toHaveBeenCalledWith('a1', user);
  });

  it('getByAgent: returns a sanitized view (never the token)', async () => {
    prisma.whatsappChannel.findUnique.mockResolvedValue(channelRow);

    const view = await service.getByAgent('a1', user);

    expect(view?.id).toBe('c1');
    expect(view).not.toHaveProperty('accessTokenEnc');
  });

  it('disconnect: authorizes then deletes the channel', async () => {
    prisma.whatsappChannel.deleteMany.mockResolvedValue({ count: 1 });

    await service.disconnect('a1', user);

    expect(agents.findById).toHaveBeenCalledWith('a1', user);
    expect(prisma.whatsappChannel.deleteMany).toHaveBeenCalledWith({
      where: { agentId: 'a1' },
    });
    expect(tracer.logAuditEvent).toHaveBeenCalledWith(
      'a1',
      'WHATSAPP_CHANNEL_DISCONNECTED',
      expect.anything(),
      { agentId: 'a1' },
    );
  });

  it('setVoiceReply: authorizes then updates the flag', async () => {
    prisma.whatsappChannel.update.mockResolvedValue({
      ...channelRow,
      voiceReplyEnabled: true,
    });

    const view = await service.setVoiceReply(
      'a1',
      { voiceReplyEnabled: true },
      user,
    );

    expect(agents.findById).toHaveBeenCalledWith('a1', user);
    expect(prisma.whatsappChannel.update).toHaveBeenCalledWith({
      where: { agentId: 'a1' },
      data: { voiceReplyEnabled: true },
    });
    expect(view.voiceReplyEnabled).toBe(true);
    expect(tracer.logAuditEvent).toHaveBeenCalledWith(
      'a1',
      'WHATSAPP_CHANNEL_UPDATED',
      expect.anything(),
      { agentId: 'a1' },
    );
  });

  it('setVoiceReply: 404 when no channel exists (P2025)', async () => {
    prisma.whatsappChannel.update.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('missing', {
        code: 'P2025',
        clientVersion: '7.3.0',
      }),
    );

    await expect(
      service.setVoiceReply('a1', { voiceReplyEnabled: true }, user),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
