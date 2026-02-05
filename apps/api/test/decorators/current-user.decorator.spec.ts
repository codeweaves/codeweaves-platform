import { ExecutionContext } from '@nestjs/common';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants';
import { CurrentUser, CurrentUserData } from '../../src/decorators/current-user.decorator';

describe('CurrentUser Decorator', () => {
  const mockUser: CurrentUserData = {
    auth0Id: 'auth0|123456',
    email: 'test@example.com',
    roles: ['user', 'admin'],
    organizationId: 'org-123',
    userId: 'user-123',
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

  it('should return auth0Id when specified', () => {
    class TestController {
      testMethod(@CurrentUser('auth0Id') auth0Id: string) {
        return auth0Id;
      }
    }

    const metadata = Reflect.getMetadata(ROUTE_ARGS_METADATA, TestController, 'testMethod') as Record<string, { factory: (data: unknown, ctx: ExecutionContext) => unknown }>;
    const key = Object.keys(metadata)[0]!;
    const factory = metadata[key]!.factory;
    const context = createMockExecutionContext(mockUser);

    const result = factory('auth0Id', context);

    expect(result).toBe('auth0|123456');
  });

  it('should return undefined when user is not set', () => {
    const factory = getParamDecoratorFactory();
    const context = createMockExecutionContext(null);

    const result = factory(undefined, context);

    expect(result).toBeNull();
  });
});
