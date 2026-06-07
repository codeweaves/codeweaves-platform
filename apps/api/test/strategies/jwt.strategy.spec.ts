import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../src/strategies/jwt.strategy';
import { JwtPayload } from '../../src/interfaces/jwt-payload.interface';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        JwtStrategy,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'CLERK_ISSUER')
                return 'https://test.clerk.accounts.dev';
              if (key === 'CLERK_JWT_AUDIENCE') return 'klivo-api';
              return null;
            }),
          },
        },
      ],
    }).compile();

    strategy = module.get<JwtStrategy>(JwtStrategy);
  });

  it('should be defined', () => {
    expect(strategy).toBeDefined();
  });

  describe('validate', () => {
    it('should map a Clerk payload to { clerkId, email }', async () => {
      const payload: JwtPayload = {
        sub: 'user_123456',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        clerkId: 'user_123456',
        email: 'test@example.com',
      });
    });

    it('should default email to empty string when absent', async () => {
      const payload: JwtPayload = {
        sub: 'user_123456',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        clerkId: 'user_123456',
        email: '',
      });
    });
  });

  describe('configuration', () => {
    it('should throw error if CLERK_ISSUER is not configured', () => {
      const mockConfigService = {
        get: jest.fn(() => null),
      };

      expect(() => {
        new JwtStrategy(mockConfigService as unknown as ConfigService);
      }).toThrow('CLERK_ISSUER must be configured');
    });

    it('should construct without an audience (audience is optional)', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'CLERK_ISSUER') return 'https://test.clerk.accounts.dev';
          return null; // CLERK_JWT_AUDIENCE intentionally absent
        }),
      };

      expect(
        () => new JwtStrategy(mockConfigService as unknown as ConfigService),
      ).not.toThrow();
    });
  });
});

/*
 * NOTE: Full JWT verification tests (expired, malformed, wrong issuer, etc.)
 * are handled by passport-jwt and jwks-rsa libraries, which validate:
 * 1. Token expiration (exp claim)
 * 2. Token not yet valid (nbf claim)
 * 3. Issuer validation (iss claim) — Clerk Frontend API URL
 * 4. Audience validation (aud claim) — the klivo-api JWT template, when set
 * 5. Signature verification via JWKS
 * 6. Algorithm validation (RS256 only)
 * 7. Token format validation
 *
 * These validations are tested via E2E tests where actual HTTP requests
 * with various JWT tokens are made to protected endpoints.
 *
 * The unit tests above focus on the custom validation logic in the
 * validate() method, which transforms the JWT payload into the user object.
 */
