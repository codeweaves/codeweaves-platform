import { Test } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { Role, AccessScope } from '@prisma/client';
import { AgentDataFieldsService } from '../../../src/services/agent-data-fields.service';
import { PrismaService } from '../../../src/services/prisma.service';
import { AgentCacheService } from '../../../src/common/cache/agent-cache.service';
import { CryptoService } from '../../../src/common/crypto/crypto.service';
import { TracerService } from '../../../src/common/tracer/tracer.service';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentDataFieldsService', () => {
  let service: AgentDataFieldsService;

  const tx = {
    agentDataField: {
      deleteMany: jest.fn(),
      createMany: jest.fn(),
      findMany: jest.fn(),
    },
  };
  const mockPrisma = {
    agent: { findFirst: jest.fn() },
    agentDataField: { findMany: jest.fn() },
    collectedData: { findMany: jest.fn(), count: jest.fn() },
    $transaction: jest.fn(),
    $queryRaw: jest.fn(),
  };
  const mockCache = { invalidate: jest.fn() };
  // Passthrough: decryption behaviour is unit-tested in crypto.service.spec.ts.
  // Implementation applied in beforeEach (jest resetMocks: true).
  const mockCrypto = { decryptFieldValues: jest.fn() };
  const mockTracer = { logAuditEvent: jest.fn() };

  const agentId = 'agent-uuid';
  const adminUser = {
    id: 'u1',
    role: Role.ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.support', 'platform.ops', 'platform.privacy', 'platform.agent_admin'],
    organizationId: 'org1',
  } as CurrentUserData;
  const clientUser = {
    id: 'u2',
    role: Role.CLIENT,

    accessScope: AccessScope.ORG,

    roleKeys: ['org.owner'],
    organizationId: 'org2',
  } as CurrentUserData;

  beforeEach(async () => {
    jest.clearAllMocks();
    mockCrypto.decryptFieldValues.mockImplementation(
      (d: Record<string, unknown> | null | undefined) => d ?? {},
    );
    mockPrisma.$transaction.mockImplementation(
      async (cb: (t: typeof tx) => unknown) => cb(tx),
    );
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentDataFieldsService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AgentCacheService, useValue: mockCache },
        { provide: CryptoService, useValue: mockCrypto },
        { provide: TracerService, useValue: mockTracer },
      ],
    }).compile();
    service = moduleRef.get(AgentDataFieldsService);
  });

  describe('list()', () => {
    it('returns fields in order when the agent is accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([{ key: 'email' }]);

      const result = await service.list(agentId, adminUser);

      expect(result).toEqual([{ key: 'email' }]);
      expect(mockPrisma.agentDataField.findMany).toHaveBeenCalledWith({
        where: { agentId },
        orderBy: { order: 'asc' },
      });
    });

    it('throws NotFound when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(service.list(agentId, adminUser)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('scopes CLIENT users to their own organisation', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([]);

      await service.list(agentId, clientUser);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null, organizationId: 'org2' },
        select: { id: true, organizationId: true, name: true },
      });
    });

    it('does NOT org-scope ADMIN users', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      mockPrisma.agentDataField.findMany.mockResolvedValue([]);

      await service.list(agentId, adminUser);

      expect(mockPrisma.agent.findFirst).toHaveBeenCalledWith({
        where: { id: agentId, deletedAt: null },
        select: { id: true, organizationId: true, name: true },
      });
    });
  });

  describe('replaceAll()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId, organizationId: 'org1' });
    });

    it('wipes + recreates fields with order from array index, then busts cache', async () => {
      tx.agentDataField.findMany.mockResolvedValue([{ key: 'email', order: 0 }]);

      const result = await service.replaceAll(
        agentId,
        {
          fields: [
            {
              key: 'email',
              label: 'Email',
              type: 'EMAIL',
              required: true,
              description: null,
            },
          ],
        },
        adminUser,
      );

      expect(tx.agentDataField.deleteMany).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(tx.agentDataField.createMany).toHaveBeenCalledWith({
        data: [
          {
            agentId,
            key: 'email',
            label: 'Email',
            type: 'EMAIL',
            required: true,
            description: null,
            order: 0,
          },
        ],
      });
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
      expect(result).toEqual([{ key: 'email', order: 0 }]);
      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'AGENT_DATA_FIELDS_UPDATED',
        expect.anything(),
        { organizationId: 'org1', agentId },
      );
    });

    it('clears fields without createMany when the list is empty', async () => {
      tx.agentDataField.findMany.mockResolvedValue([]);

      await service.replaceAll(agentId, { fields: [] }, adminUser);

      expect(tx.agentDataField.deleteMany).toHaveBeenCalledWith({
        where: { agentId },
      });
      expect(tx.agentDataField.createMany).not.toHaveBeenCalled();
      expect(mockCache.invalidate).toHaveBeenCalledWith(agentId);
    });

    it('throws NotFound and writes nothing when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);

      await expect(
        service.replaceAll(agentId, { fields: [] }, adminUser),
      ).rejects.toThrow(NotFoundException);
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('getCollectedDataView()', () => {
    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({ id: agentId });
      // distinct keys present in stored data: two current fields (defined in
      // NON-alphabetical order) + one orphaned key — so the assertion proves
      // the alphabetical-by-label sort, not just insertion order.
      mockPrisma.$queryRaw.mockResolvedValue([
        { key: 'zname' },
        { key: 'aname' },
        { key: 'mid_field' },
      ]);
      mockPrisma.agentDataField.findMany.mockResolvedValue([
        { key: 'zname', label: 'Zebra' },
        { key: 'aname', label: 'Apple' },
      ]);
      mockPrisma.collectedData.findMany.mockResolvedValue([
        { chatSessionId: 's1', data: { aname: 'a@b.com' }, extractedAt: new Date() },
      ]);
      mockPrisma.collectedData.count.mockResolvedValue(1);
    });

    it('orders columns alphabetically by label (case-insensitive); orphaned keys use the raw key as label', async () => {
      const result = await service.getCollectedDataView(agentId, adminUser, 1, 20);

      expect(result.columns).toEqual([
        { key: 'aname', label: 'Apple' }, // current field → friendly label
        { key: 'mid_field', label: 'mid_field' }, // orphaned → raw key
        { key: 'zname', label: 'Zebra' }, // current field, sorted after the rest
      ]);
      expect(result.total).toBe(1);
      expect(result.rows).toHaveLength(1);
    });

    it('clamps page size to the max and paginates (skip = (page-1)*limit)', async () => {
      await service.getCollectedDataView(agentId, adminUser, 2, 99999);
      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 100, take: 100 }),
      );
    });

    it('defaults to newest-first and honors an explicit sort order', async () => {
      await service.getCollectedDataView(agentId, adminUser, 1, 20);
      expect(mockPrisma.collectedData.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { extractedAt: 'desc' } }),
      );

      await service.getCollectedDataView(agentId, adminUser, 1, 20, 'asc');
      expect(mockPrisma.collectedData.findMany).toHaveBeenLastCalledWith(
        expect.objectContaining({ orderBy: { extractedAt: 'asc' } }),
      );
    });

    it('throws NotFound when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.getCollectedDataView(agentId, adminUser),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('prepareCollectedDataExport()', () => {
    /** Drain the generator into the finished CSV text. */
    const collect = async (stream: AsyncGenerator<string>) => {
      let out = '';
      for await (const chunk of stream) out += chunk;
      return out;
    };

    beforeEach(() => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
        name: 'Support Bot',
      });
      mockPrisma.$queryRaw.mockResolvedValue([{ key: 'email' }, { key: 'name' }]);
      mockPrisma.agentDataField.findMany.mockResolvedValue([
        { key: 'name', label: 'Full Name' },
        { key: 'email', label: 'Email' },
      ]);
    });

    it('throws NotFound before any streaming when the agent is not accessible', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue(null);
      await expect(
        service.prepareCollectedDataExport(agentId, clientUser),
      ).rejects.toThrow(NotFoundException);
      // Nothing was read, so the controller never wrote a response header.
      expect(mockPrisma.collectedData.findMany).not.toHaveBeenCalled();
    });

    it('names the file after the agent, sanitised, with the export date', async () => {
      mockPrisma.agent.findFirst.mockResolvedValue({
        id: agentId,
        organizationId: 'org1',
        name: 'Acme / Support "Bot"',
      });
      const { filename } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      expect(filename).toMatch(
        /^collected-data-acme-support-bot-\d{4}-\d{2}-\d{2}\.csv$/,
      );
    });

    it('emits a BOM, label header and one row per record, columns alphabetical', async () => {
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            chatSessionId: 's1',
            data: { email: 'a@b.com', name: 'Ada' },
            extractedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ])
        .mockResolvedValue([]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      const csv = await collect(stream);

      expect(csv.startsWith('﻿')).toBe(true);
      const lines = csv.replace('﻿', '').trim().split('\r\n');
      expect(lines[0]).toBe('Email,Full Name,Captured At (UTC)');
      expect(lines[1]).toBe('a@b.com,Ada,2026-08-01 10:00:00');
    });

    it('renders timestamps in the caller time zone and names it in the header', async () => {
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            chatSessionId: 's1',
            data: { email: 'a@b.com' },
            // 19:30 UTC is 01:00 the NEXT day in IST — the case where a UTC
            // export puts a row on the wrong date entirely.
            extractedAt: new Date('2026-08-01T19:30:00.000Z'),
          },
        ])
        .mockResolvedValue([]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
        'desc',
        'Asia/Kolkata',
      );
      const lines = (await collect(stream))
        .replace('﻿', '')
        .trim()
        .split('\r\n');

      expect(lines[0]).toBe('Email,Full Name,Captured At (Asia/Kolkata)');
      expect(lines[1]).toBe('a@b.com,,2026-08-02 01:00:00');
    });

    it('falls back to UTC when the client sends an unusable time zone', async () => {
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            chatSessionId: 's1',
            data: { email: 'a@b.com' },
            extractedAt: new Date('2026-08-01T19:30:00.000Z'),
          },
        ])
        .mockResolvedValue([]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
        'desc',
        'Not/AZone',
      );
      const lines = (await collect(stream))
        .replace('﻿', '')
        .trim()
        .split('\r\n');

      expect(lines[0]).toBe('Email,Full Name,Captured At (UTC)');
      expect(lines[1]).toBe('a@b.com,,2026-08-01 19:30:00');
    });

    it('exports every row: no page or limit is ever applied', async () => {
      mockPrisma.collectedData.findMany.mockResolvedValue([]);
      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      await collect(stream);

      const [query] = mockPrisma.collectedData.findMany.mock
        .calls[0] as [Record<string, unknown>];
      // `take` is the batch size, not a user-facing page size, and the only
      // `skip` allowed is the cursor's 1 (absent on the first read).
      expect(query.take).toBe(500);
      expect(query.skip).toBeUndefined();
    });

    it('neutralises spreadsheet formulas and quotes separators in captured values', async () => {
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            chatSessionId: 's1',
            data: {
              email: '=HYPERLINK("http://evil","x")',
              name: 'Doe, Jane "JD"',
            },
            extractedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ])
        .mockResolvedValue([]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      const csv = await collect(stream);
      const row = csv.replace('﻿', '').trim().split('\r\n')[1]!;

      // Leading `=` defused with a quote prefix, then quoted for the comma.
      expect(row).toContain(`"'=HYPERLINK(""http://evil"",""x"")"`);
      expect(row).toContain('"Doe, Jane ""JD"""');
    });

    it('cursor-pages through batches instead of using offsets', async () => {
      const batch = (n: number) =>
        Array.from({ length: 500 }, (_, i) => ({
          id: `b${n}-r${i}`,
          chatSessionId: `s${n}-${i}`,
          data: { email: 'a@b.com' },
          extractedAt: new Date('2026-08-01T10:00:00.000Z'),
        }));
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce(batch(1))
        .mockResolvedValueOnce([
          {
            id: 'tail',
            chatSessionId: 'tail-s',
            data: { email: 'z@b.com' },
            extractedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      await collect(stream);

      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledTimes(2);
      // First read has no cursor; the second resumes after the last id and never
      // uses `skip` as an offset (which would re-scan the earlier rows).
      const [first, second] = mockPrisma.collectedData.findMany.mock.calls as [
        [Record<string, unknown>],
        [Record<string, unknown>],
      ];
      expect(first[0].cursor).toBeUndefined();
      expect(second[0]).toMatchObject({
        cursor: { id: 'b1-r499' },
        skip: 1,
        orderBy: [{ extractedAt: 'desc' }, { id: 'asc' }],
      });
    });

    it('honors an explicit ascending sort order', async () => {
      mockPrisma.collectedData.findMany.mockResolvedValue([]);
      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
        'asc',
      );
      await collect(stream);
      expect(mockPrisma.collectedData.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: [{ extractedAt: 'asc' }, { id: 'asc' }],
        }),
      );
    });

    it('audit-logs the export with a row count and no captured values', async () => {
      mockPrisma.collectedData.findMany
        .mockResolvedValueOnce([
          {
            id: 'r1',
            chatSessionId: 's1',
            data: { email: 'a@b.com' },
            extractedAt: new Date('2026-08-01T10:00:00.000Z'),
          },
        ])
        .mockResolvedValue([]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      await collect(stream);

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'COLLECTED_DATA_EXPORTED',
        {
          response: {
            rowCount: 1,
            truncated: false,
            sortOrder: 'desc',
            timeZone: 'UTC',
            columnKeys: ['email', 'name'],
            userId: 'u1',
          },
        },
        { organizationId: 'org1', agentId },
      );
      const logged = JSON.stringify(mockTracer.logAuditEvent.mock.calls[0]);
      expect(logged).not.toContain('a@b.com');
    });

    it('still audit-logs when the client aborts the download part-way', async () => {
      mockPrisma.collectedData.findMany.mockResolvedValue([
        {
          id: 'r1',
          chatSessionId: 's1',
          data: { email: 'a@b.com' },
          extractedAt: new Date('2026-08-01T10:00:00.000Z'),
        },
      ]);

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      // Consume the header only, then walk away — as a cancelled download does.
      await stream.next();
      await stream.return(undefined as never);

      expect(mockTracer.logAuditEvent).toHaveBeenCalledWith(
        agentId,
        'COLLECTED_DATA_EXPORTED',
        expect.objectContaining({
          response: expect.objectContaining({ rowCount: 0 }),
        }),
        { organizationId: 'org1', agentId },
      );
    });

    it('does not fail the download when the audit write throws', async () => {
      mockPrisma.collectedData.findMany.mockResolvedValue([]);
      mockTracer.logAuditEvent.mockRejectedValue(new Error('audit down'));

      const { stream } = await service.prepareCollectedDataExport(
        agentId,
        adminUser,
      );
      await expect(collect(stream)).resolves.toContain('Captured At (UTC)');
    });
  });
});
