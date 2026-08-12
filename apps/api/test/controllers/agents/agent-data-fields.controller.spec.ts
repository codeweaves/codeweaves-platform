import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role, AccessScope } from '@prisma/client';
import type { UpdateDataFieldsDto } from '@repo/validation';
import { AgentDataFieldsController } from '../../../src/controllers/agents/agent-data-fields.controller';
import { AgentDataFieldsService } from '../../../src/services/agent-data-fields.service';
import { PermissionGuard } from '../../../src/guards/permission.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('AgentDataFieldsController', () => {
  let controller: AgentDataFieldsController;

  const mockService = {
    list: jest.fn(),
    replaceAll: jest.fn(),
    getCollectedDataView: jest.fn(),
    prepareCollectedDataExport: jest.fn(),
  };

  /** Minimal Express `Response` double that records what was written. */
  const mockResponse = () => {
    const headers: Record<string, string> = {};
    const chunks: string[] = [];
    return {
      headers,
      chunks,
      writableEnded: false,
      setHeader: jest.fn((k: string, v: string) => {
        headers[k] = v;
      }),
      write: jest.fn((chunk: string) => {
        chunks.push(chunk);
        return true; // no backpressure
      }),
      once: jest.fn(),
      end: jest.fn(),
    };
  };

  async function* csvStream(...chunks: string[]) {
    for (const chunk of chunks) yield chunk;
  }

  const user = {
    id: 'u1',
    role: Role.ADMIN,

    accessScope: AccessScope.PLATFORM,

    roleKeys: ['platform.support', 'platform.ops', 'platform.privacy', 'platform.agent_admin'],
    organizationId: 'org1',
  } as CurrentUserData;
  const agentId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [AgentDataFieldsController],
      providers: [
        { provide: AgentDataFieldsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(PermissionGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(AgentDataFieldsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('list() delegates to the service with the current user', async () => {
    mockService.list.mockResolvedValue([{ key: 'email' }]);
    const res = await controller.list(agentId, user);
    expect(res).toEqual([{ key: 'email' }]);
    expect(mockService.list).toHaveBeenCalledWith(agentId, user);
  });

  it('replace() forwards the dto and user to the service', async () => {
    const dto: UpdateDataFieldsDto = {
      fields: [
        { key: 'email', label: 'Email', type: 'EMAIL', required: true },
      ],
    };
    mockService.replaceAll.mockResolvedValue([]);
    await controller.replace(agentId, dto, user);
    expect(mockService.replaceAll).toHaveBeenCalledWith(agentId, dto, user);
  });

  it('collected() delegates to the paginated view with page + limit', async () => {
    mockService.getCollectedDataView.mockResolvedValue({
      columns: [],
      rows: [],
      total: 0,
      page: 2,
      limit: 50,
    });
    await controller.collected(agentId, user, '2', '50');
    expect(mockService.getCollectedDataView).toHaveBeenCalledWith(
      agentId,
      user,
      2,
      50,
      'desc',
    );
  });

  it('collected() defaults page to 1, limit to undefined, sort to desc', async () => {
    mockService.getCollectedDataView.mockResolvedValue({
      columns: [],
      rows: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await controller.collected(agentId, user, undefined, undefined);
    expect(mockService.getCollectedDataView).toHaveBeenCalledWith(
      agentId,
      user,
      1,
      undefined,
      'desc',
    );
  });

  it('collected() forwards sortOrder=asc and ignores anything else', async () => {
    mockService.getCollectedDataView.mockResolvedValue({
      columns: [],
      rows: [],
      total: 0,
      page: 1,
      limit: 20,
    });
    await controller.collected(agentId, user, undefined, undefined, 'asc');
    expect(mockService.getCollectedDataView).toHaveBeenLastCalledWith(
      agentId,
      user,
      1,
      undefined,
      'asc',
    );

    await controller.collected(agentId, user, undefined, undefined, 'garbage');
    expect(mockService.getCollectedDataView).toHaveBeenLastCalledWith(
      agentId,
      user,
      1,
      undefined,
      'desc',
    );
  });

  describe('exportCollected()', () => {
    it('sends CSV attachment headers and streams every chunk', async () => {
      mockService.prepareCollectedDataExport.mockResolvedValue({
        filename: 'collected-data-support-bot-2026-08-11.csv',
        stream: csvStream('header\r\n', 'row1\r\n'),
      });
      const res = mockResponse();

      await controller.exportCollected(agentId, user, res as never);

      expect(mockService.prepareCollectedDataExport).toHaveBeenCalledWith(
        agentId,
        user,
        'desc',
        undefined,
      );
      expect(res.headers['Content-Type']).toBe('text/csv; charset=utf-8');
      expect(res.headers['Content-Disposition']).toBe(
        'attachment; filename="collected-data-support-bot-2026-08-11.csv"',
      );
      // PII must not sit in a proxy or browser cache.
      expect(res.headers['Cache-Control']).toBe('no-store');
      expect(res.chunks.join('')).toBe('header\r\nrow1\r\n');
      expect(res.end).toHaveBeenCalled();
    });

    it('forwards sortOrder=asc and falls back to desc for anything else', async () => {
      mockService.prepareCollectedDataExport.mockResolvedValue({
        filename: 'f.csv',
        stream: csvStream(''),
      });

      await controller.exportCollected(agentId, user, mockResponse() as never, 'asc');
      expect(mockService.prepareCollectedDataExport).toHaveBeenLastCalledWith(
        agentId,
        user,
        'asc',
        undefined,
      );

      await controller.exportCollected(
        agentId,
        user,
        mockResponse() as never,
        'garbage',
      );
      expect(mockService.prepareCollectedDataExport).toHaveBeenLastCalledWith(
        agentId,
        user,
        'desc',
        undefined,
      );
    });

    it("forwards the caller's time zone", async () => {
      mockService.prepareCollectedDataExport.mockResolvedValue({
        filename: 'f.csv',
        stream: csvStream(''),
      });

      await controller.exportCollected(
        agentId,
        user,
        mockResponse() as never,
        'desc',
        'Asia/Kolkata',
      );

      expect(mockService.prepareCollectedDataExport).toHaveBeenCalledWith(
        agentId,
        user,
        'desc',
        'Asia/Kolkata',
      );
    });

    it('stops writing once the client has hung up', async () => {
      mockService.prepareCollectedDataExport.mockResolvedValue({
        filename: 'f.csv',
        stream: csvStream('a', 'b'),
      });
      const res = mockResponse();
      res.writableEnded = true;

      await controller.exportCollected(agentId, user, res as never);

      expect(res.write).not.toHaveBeenCalled();
    });

    it('lets an access failure surface before any header is written', async () => {
      mockService.prepareCollectedDataExport.mockRejectedValue(
        new Error('Agent not found'),
      );
      const res = mockResponse();

      await expect(
        controller.exportCollected(agentId, user, res as never),
      ).rejects.toThrow('Agent not found');
      expect(res.setHeader).not.toHaveBeenCalled();
    });
  });
});
