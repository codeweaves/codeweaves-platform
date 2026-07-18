import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { SupabaseStorageService } from '../../../src/services/supabase-storage.service';
import { ProviderEventLogger } from '../../../src/common/events/provider.logger';

const mockProviderLog = { log: jest.fn() } as unknown as ProviderEventLogger;

// Mock the @supabase/supabase-js createClient at module level so we can
// substitute a stub client without contacting Supabase.
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));
import { createClient } from '@supabase/supabase-js';

const mockedCreateClient = createClient as jest.MockedFunction<
  typeof createClient
>;

describe('SupabaseStorageService', () => {
  let service: SupabaseStorageService;
  const env = new Map<string, string | undefined>();
  const mockConfig = { get: jest.fn() };

  // Storage builder mocks.
  const storageUpload = jest.fn();
  const storageRemove = jest.fn();
  const storageGetPublicUrl = jest.fn();
  const mockStorageFrom = jest.fn();
  const mockClient = {
    storage: { from: mockStorageFrom },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;

  beforeEach(async () => {
    env.clear();
    jest.clearAllMocks();
    mockConfig.get.mockImplementation((k: string) => env.get(k));
    mockedCreateClient.mockReturnValue(mockClient);
    mockStorageFrom.mockReturnValue({
      upload: storageUpload,
      remove: storageRemove,
      getPublicUrl: storageGetPublicUrl,
    });
    storageGetPublicUrl.mockReturnValue({
      data: { publicUrl: 'https://cdn/file.png' },
    });

    const moduleRef = await Test.createTestingModule({
      providers: [
        SupabaseStorageService,
        { provide: ConfigService, useValue: mockConfig },
        { provide: ProviderEventLogger, useValue: mockProviderLog },
      ],
    }).compile();
    service = moduleRef.get(SupabaseStorageService);
  });

  describe('onModuleInit()', () => {
    it('initialises the client when both env vars present', () => {
      env.set('SUPABASE_URL', 'https://x.supabase.co');
      env.set('SUPABASE_SERVICE_ROLE_KEY', 'sk-test');
      service.onModuleInit();
      expect(mockedCreateClient).toHaveBeenCalledWith(
        'https://x.supabase.co',
        'sk-test',
        { auth: { persistSession: false } },
      );
    });

    it('logs warning and skips init when SUPABASE_URL missing', () => {
      env.set('SUPABASE_SERVICE_ROLE_KEY', 'sk-test');
      service.onModuleInit();
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });

    it('logs warning and skips init when SUPABASE_SERVICE_ROLE_KEY missing', () => {
      env.set('SUPABASE_URL', 'https://x.supabase.co');
      service.onModuleInit();
      expect(mockedCreateClient).not.toHaveBeenCalled();
    });
  });

  describe('upload()', () => {
    beforeEach(() => {
      env.set('SUPABASE_URL', 'https://x.supabase.co');
      env.set('SUPABASE_SERVICE_ROLE_KEY', 'sk-test');
      service.onModuleInit();
    });

    it('uploads bytes and returns the public URL', async () => {
      storageUpload.mockResolvedValue({ data: { path: 'a.png' }, error: null });
      const url = await service.upload(
        'assets',
        'agent-1/avatar.png',
        Buffer.from('xxx'),
        'image/png',
      );
      expect(mockStorageFrom).toHaveBeenCalledWith('assets');
      expect(storageUpload).toHaveBeenCalledWith(
        'agent-1/avatar.png',
        expect.any(Buffer),
        { contentType: 'image/png', upsert: true },
      );
      expect(url).toBe('https://cdn/file.png');
    });

    it('throws when Supabase returns an error', async () => {
      storageUpload.mockResolvedValue({
        data: null,
        error: { message: 'quota exceeded' },
      });
      await expect(
        service.upload('assets', 'a.png', Buffer.from('x'), 'image/png'),
      ).rejects.toThrow('Storage upload failed: quota exceeded');
    });

    it('throws when client is not configured', async () => {
      const unconfigured = new SupabaseStorageService(
        mockConfig as unknown as ConfigService,
        mockProviderLog,
      );
      // No onModuleInit() called — client stays unset.
      await expect(
        unconfigured.upload('a', 'b', Buffer.from('x'), 'image/png'),
      ).rejects.toThrow('Supabase Storage is not configured');
    });
  });

  describe('remove()', () => {
    beforeEach(() => {
      env.set('SUPABASE_URL', 'https://x.supabase.co');
      env.set('SUPABASE_SERVICE_ROLE_KEY', 'sk-test');
      service.onModuleInit();
    });

    it('returns silently for empty path list', async () => {
      await service.remove('assets', []);
      expect(storageRemove).not.toHaveBeenCalled();
    });

    it('calls supabase.remove with the path list', async () => {
      storageRemove.mockResolvedValue({ data: null, error: null });
      await service.remove('assets', ['a.png', 'b.png']);
      expect(storageRemove).toHaveBeenCalledWith(['a.png', 'b.png']);
    });

    it('swallows errors with a warn (non-throwing)', async () => {
      storageRemove.mockResolvedValue({
        data: null,
        error: { message: 'not found' },
      });
      await expect(
        service.remove('assets', ['a.png']),
      ).resolves.toBeUndefined();
    });
  });

  describe('getPublicUrl()', () => {
    it('returns the URL from the storage builder', () => {
      env.set('SUPABASE_URL', 'https://x.supabase.co');
      env.set('SUPABASE_SERVICE_ROLE_KEY', 'sk-test');
      service.onModuleInit();
      storageGetPublicUrl.mockReturnValue({
        data: { publicUrl: 'https://cdn/something.jpg' },
      });
      expect(service.getPublicUrl('assets', 'something.jpg')).toBe(
        'https://cdn/something.jpg',
      );
    });
  });
});
