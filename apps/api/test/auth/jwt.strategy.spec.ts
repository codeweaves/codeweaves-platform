import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from '../../src/auth/strategies/jwt.strategy';
import { JwtPayload } from '../../src/auth/interfaces/jwt-payload.interface';

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
              if (key === 'AUTH0_DOMAIN') return 'codeweaves.jp.auth0.com';
              if (key === 'AUTH0_AUDIENCE') return 'https://api.codeweaves.com';
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
    it('should validate a valid token payload and return user', async () => {
      const payload: JwtPayload = {
        sub: 'auth0|123456',
        email: 'test@example.com',
        'https://codeweaves.com/roles': ['user', 'admin'],
        'https://codeweaves.com/organizationId': 'org_123',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: ['user', 'admin'],
        organizationId: 'org_123',
      });
    });

    it('should validate payload without optional fields', async () => {
      const payload: JwtPayload = {
        sub: 'auth0|123456',
        email: 'test@example.com',
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: [],
        organizationId: undefined,
      });
    });

    it('should handle empty roles array', async () => {
      const payload: JwtPayload = {
        sub: 'auth0|123456',
        email: 'test@example.com',
        'https://codeweaves.com/roles': [],
      };

      const result = await strategy.validate(payload);

      expect(result).toEqual({
        auth0Id: 'auth0|123456',
        email: 'test@example.com',
        roles: [],
        organizationId: undefined,
      });
    });
  });

  describe('configuration', () => {
    it('should throw error if AUTH0_DOMAIN is not configured', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'AUTH0_DOMAIN') return null;
          if (key === 'AUTH0_AUDIENCE') return 'https://api.codeweaves.com';
          return null;
        }),
      };

      expect(() => {
        new JwtStrategy(mockConfigService as unknown as ConfigService);
      }).toThrow('AUTH0_DOMAIN and AUTH0_AUDIENCE must be configured');
    });

    it('should throw error if AUTH0_AUDIENCE is not configured', () => {
      const mockConfigService = {
        get: jest.fn((key: string) => {
          if (key === 'AUTH0_DOMAIN') return 'codeweaves.jp.auth0.com';
          if (key === 'AUTH0_AUDIENCE') return null;
          return null;
        }),
      };

      expect(() => {
        new JwtStrategy(mockConfigService as unknown as ConfigService);
      }).toThrow('AUTH0_DOMAIN and AUTH0_AUDIENCE must be configured');
    });
  });
});

/*
 * NOTE: Full JWT verification tests (expired, malformed, wrong issuer, etc.)
 * are handled by passport-jwt and jwks-rsa libraries, which validate:
 * 1. Token expiration (exp claim)
 * 2. Token not yet valid (nbf claim)
 * 3. Issuer validation (iss claim)
 * 4. Audience validation (aud claim)
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
