import { Test, TestingModule } from '@nestjs/testing';
import { Reflector } from '@nestjs/core';
import { Role } from '@prisma/client';
import { DocumentsController } from '../../../src/modules/rag/documents.controller';
import { DocumentsService } from '../../../src/modules/rag/documents.service';
import { RolesGuard } from '../../../src/guards/roles.guard';
import type { CurrentUserData } from '../../../src/decorators/current-user.decorator';

describe('DocumentsController', () => {
  let controller: DocumentsController;

  const mockService = {
    list: jest.fn(),
    uploadFile: jest.fn(),
    ingestUrl: jest.fn(),
    reindex: jest.fn(),
    remove: jest.fn(),
  };

  const user = {
    id: 'u1',
    role: Role.CLIENT,
    organizationId: 'org1',
  } as CurrentUserData;
  const agentId = '11111111-1111-4111-8111-111111111111';
  const documentId = '22222222-2222-4222-8222-222222222222';

  const makeFile = (): Express.Multer.File =>
    ({
      fieldname: 'file',
      originalname: 'doc.txt',
      mimetype: 'text/plain',
      size: 10,
      buffer: Buffer.from('hello'),
    }) as Express.Multer.File;

  beforeEach(async () => {
    jest.clearAllMocks();
    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [DocumentsController],
      providers: [
        { provide: DocumentsService, useValue: mockService },
        Reflector,
      ],
    })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();
    controller = moduleRef.get(DocumentsController);
  });

  it('is defined', () => {
    expect(controller).toBeDefined();
  });

  it('list() delegates to the service with the current user (tenancy input)', async () => {
    mockService.list.mockResolvedValue([{ id: documentId }]);
    const res = await controller.list(agentId, user);
    expect(res).toEqual([{ id: documentId }]);
    expect(mockService.list).toHaveBeenCalledWith(agentId, user);
  });

  it('upload() forwards the multipart file and user', async () => {
    const file = makeFile();
    mockService.uploadFile.mockResolvedValue({ id: documentId, status: 'PENDING' });
    const res = await controller.upload(agentId, file, user);
    expect(res).toMatchObject({ status: 'PENDING' });
    expect(mockService.uploadFile).toHaveBeenCalledWith(agentId, file, user);
  });

  it('ingestUrl() forwards the dto and user', async () => {
    const dto = { url: 'https://example.com/pricing', name: 'Pricing' };
    mockService.ingestUrl.mockResolvedValue({ id: documentId });
    await controller.ingestUrl(agentId, dto, user);
    expect(mockService.ingestUrl).toHaveBeenCalledWith(agentId, dto, user);
  });

  it('reindex() forwards both ids and the user', async () => {
    mockService.reindex.mockResolvedValue({ id: documentId, status: 'PENDING' });
    await controller.reindex(agentId, documentId, user);
    expect(mockService.reindex).toHaveBeenCalledWith(agentId, documentId, user);
  });

  it('remove() forwards both ids and the user and resolves void', async () => {
    mockService.remove.mockResolvedValue(undefined);
    await expect(
      controller.remove(agentId, documentId, user),
    ).resolves.toBeUndefined();
    expect(mockService.remove).toHaveBeenCalledWith(agentId, documentId, user);
  });

  it('propagates service errors (e.g. cross-tenant 404) unchanged', async () => {
    const err = new Error('Agent not found or inactive.');
    mockService.list.mockRejectedValue(err);
    await expect(controller.list(agentId, user)).rejects.toBe(err);
  });
});
