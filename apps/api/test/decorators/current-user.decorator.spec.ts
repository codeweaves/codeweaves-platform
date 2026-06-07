import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser, CurrentUserData } from '../../src/decorators/current-user.decorator';

describe('CurrentUser Decorator', () => {
  const mockUser: CurrentUserData = {
    clerkId: 'user_123456',
    email: 'test@example.com',
    id: 'user-123',
    role: 'CLIENT' as CurrentUserData['role'],
    organizationId: 'org-123',
    organization: { id: 'org-123', name: 'Test Org', slug: 'test-org' },
  };

  function getParamDecoratorFactory() {
    class TestController {
      testMethod(@CurrentUser() user: CurrentUserData) {
        return user;
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'testMethod') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
    const key = Object.keys(metadata)[0]!;
    return metadata[key]!.factory;
  }

  function createMockExecutionContext(user: CurrentUserData | null): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ user }),
      }),
    } as unknown as ExecutionContext;
  }

  it('should return the full user object when no data key specified', () => {
    const factory = getParamDecoratorFactory();
    const context = createMockExecutionContext(mockUser);

    const result = factory(undefined, context);

    expect(result).toEqual(mockUser);
  });

  it('should return specific property when data key is specified', () => {
    class TestController {
      testMethod(@CurrentUser('email') email: string) {
        return email;
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'testMethod') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
    const key = Object.keys(metadata)[0]!;
    const factory = metadata[key]!.factory;
    const context = createMockExecutionContext(mockUser);

    const result = factory('email', context);

    expect(result).toBe('test@example.com');
  });

  it('should return clerkId when specified', () => {
    class TestController {
      testMethod(@CurrentUser('clerkId') clerkId: string) {
        return clerkId;
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'testMethod') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
    const key = Object.keys(metadata)[0]!;
    const factory = metadata[key]!.factory;
    const context = createMockExecutionContext(mockUser);

    const result = factory('clerkId', context);

    expect(result).toBe('user_123456');
  });

  it('should return null organizationId for SUPER_ADMIN', () => {
    const superAdminUser: CurrentUserData = {
      clerkId: 'user_superadmin',
      email: 'admin@codeweaves.com',
      id: 'superadmin-123',
      role: 'SUPER_ADMIN' as CurrentUserData['role'],
      organizationId: null,
      organization: null,
    };

    const factory = getParamDecoratorFactory();
    const context = createMockExecutionContext(superAdminUser);

    const result = factory(undefined, context) as CurrentUserData;

    expect(result.organizationId).toBeNull();
    expect(result.organization).toBeNull();
  });

  it('should return undefined when user is not set', () => {
    const factory = getParamDecoratorFactory();
    const context = createMockExecutionContext(null);

    const result = factory(undefined, context);

    expect(result).toBeNull();
  });
});
