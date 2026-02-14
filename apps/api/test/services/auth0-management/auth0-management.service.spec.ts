import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { Auth0ManagementService } from '../../../src/services/auth0-management.service';

// Mock global fetch
const mockFetch = jest.fn();
global.fetch = mockFetch;

describe('Auth0ManagementService', () => {
  let service: Auth0ManagementService;

  const configValues: Record<string, string> = {
    AUTH0_DOMAIN: 'test-tenant.auth0.com',
    AUTH0_M2M_CLIENT_ID: 'test-client-id',
    AUTH0_M2M_CLIENT_SECRET: 'test-client-secret',
    DASHBOARD_URL: 'http://localhost:3000',
  };

  const mockConfigService = {
    get: (key: string, defaultValue?: string) =>
      configValues[key] ?? defaultValue,
  };

  const mockTokenResponse = {
    access_token: 'mock-management-token',
    expires_in: 86400,
    token_type: 'Bearer',
  };

  beforeEach(async () => {
    mockFetch.mockReset();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Auth0ManagementService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<Auth0ManagementService>(Auth0ManagementService);
  });

  describe('getManagementToken', () => {
    it('should fetch a new M2M token', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });

      const token = await service.getManagementToken();

      expect(token).toBe('mock-management-token');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://test-tenant.auth0.com/oauth/token',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: 'test-client-id',
            client_secret: 'test-client-secret',
            audience: 'https://test-tenant.auth0.com/api/v2/',
            grant_type: 'client_credentials',
          }),
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('should use cached token on subsequent calls', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });

      await service.getManagementToken();
      const token2 = await service.getManagementToken();

      expect(token2).toBe('mock-management-token');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should refetch token when expired', async () => {
      // First call with very short expiry
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ...mockTokenResponse, expires_in: 100 }),
      });

      await service.getManagementToken();

      // Simulate time passing beyond expiry (100 - 300 safety margin = negative, so cache is already expired)
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });

      const token2 = await service.getManagementToken();

      expect(token2).toBe('mock-management-token');
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('should deduplicate concurrent token fetches', async () => {
      let resolveToken: (value: unknown) => void;
      const tokenPromise = new Promise((resolve) => {
        resolveToken = resolve;
      });

      mockFetch.mockReturnValueOnce(tokenPromise);

      // Fire two concurrent calls before resolving
      const call1 = service.getManagementToken();
      const call2 = service.getManagementToken();

      // Resolve the single fetch
      resolveToken!({
        ok: true,
        json: async () => mockTokenResponse,
      });

      const [token1, token2] = await Promise.all([call1, call2]);

      expect(token1).toBe('mock-management-token');
      expect(token2).toBe('mock-management-token');
      // Only ONE fetch call should have been made
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('should throw on token fetch failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Unauthorized',
      });

      await expect(service.getManagementToken()).rejects.toThrow(
        'Failed to get Auth0 M2M token: Unauthorized',
      );
    });
  });

  describe('createUser', () => {
    beforeEach(() => {
      // Mock token fetch for all createUser tests
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });
    });

    it('should create a new Auth0 user', async () => {
      const mockUser = { user_id: 'auth0|123', email: 'test@example.com' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 201,
        json: async () => mockUser,
      });

      const result = await service.createUser('test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      const createCall = mockFetch.mock.calls[1];
      expect(createCall[0]).toBe('https://test-tenant.auth0.com/api/v2/users');
      const body = JSON.parse(createCall[1].body);
      expect(body.email).toBe('test@example.com');
      expect(body.connection).toBe('Username-Password-Authentication');
      expect(body.email_verified).toBe(false);
    });

    it('should reuse existing Auth0 user on 409 conflict', async () => {
      const existingUser = {
        user_id: 'auth0|existing',
        email: 'test@example.com',
      };

      // Mock 409 response for create
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'User already exists',
      });

      // Mock token fetch for getUserByEmail (cached, so no new token call)
      // Mock getUserByEmail response
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [existingUser],
      });

      const result = await service.createUser('test@example.com');

      expect(result).toEqual(existingUser);
    });

    it('should throw on 409 when existing user not found', async () => {
      // Mock 409 response
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 409,
        text: async () => 'User already exists',
      });

      // Mock getUserByEmail returns empty
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      await expect(service.createUser('test@example.com')).rejects.toThrow(
        'Auth0 user conflict for test@example.com but could not find existing user',
      );
    });

    it('should throw on other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error',
      });

      await expect(service.createUser('test@example.com')).rejects.toThrow(
        'Failed to create Auth0 user: Internal Server Error',
      );
    });
  });

  describe('getUserByEmail', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });
    });

    it('should return user when found', async () => {
      const mockUser = { user_id: 'auth0|123', email: 'test@example.com' };
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [mockUser],
      });

      const result = await service.getUserByEmail('test@example.com');

      expect(result).toEqual(mockUser);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://test-tenant.auth0.com/api/v2/users-by-email?email=test%40example.com',
      );
    });

    it('should return null when user not found', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => [],
      });

      const result = await service.getUserByEmail('unknown@example.com');

      expect(result).toBeNull();
    });

    it('should throw on API error', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'Forbidden',
      });

      await expect(
        service.getUserByEmail('test@example.com'),
      ).rejects.toThrow('Failed to get Auth0 user by email: Forbidden');
    });
  });

  describe('deleteUser', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });
    });

    it('should delete user successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
      });

      await expect(
        service.deleteUser('auth0|123'),
      ).resolves.toBeUndefined();

      expect(mockFetch.mock.calls[1][0]).toBe(
        'https://test-tenant.auth0.com/api/v2/users/auth0%7C123',
      );
      expect(mockFetch.mock.calls[1][1].method).toBe('DELETE');
    });

    it('should handle 404 gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
      });

      await expect(
        service.deleteUser('auth0|not-found'),
      ).resolves.toBeUndefined();
    });

    it('should throw on other errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        text: async () => 'Server Error',
      });

      await expect(service.deleteUser('auth0|123')).rejects.toThrow(
        'Failed to delete Auth0 user: Server Error',
      );
    });
  });

  describe('createPasswordChangeTicket', () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTokenResponse,
      });
    });

    it('should create password change ticket and return URL', async () => {
      const ticketUrl = 'https://test-tenant.auth0.com/lo/reset?ticket=abc123';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ ticket: ticketUrl }),
      });

      const result = await service.createPasswordChangeTicket('auth0|123');

      expect(result).toBe(ticketUrl);
      const callBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(callBody).toEqual({
        user_id: 'auth0|123',
        result_url: 'http://localhost:3000/login',
        ttl_sec: 604800,
        mark_email_as_verified: true,
        includeEmailInRedirect: false,
      });
    });

    it('should throw on failure', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        text: async () => 'User not found',
      });

      await expect(
        service.createPasswordChangeTicket('auth0|bad'),
      ).rejects.toThrow(
        'Failed to create password change ticket: User not found',
      );
    });
  });
});
