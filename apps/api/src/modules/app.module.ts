import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { HealthController } from '../controllers/public/health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { InvitationsModule } from './invitations.module';
import { OrganizationsModule } from './organizations.module';
import { AgentsModule } from './agents.module';
import { TracerModule } from '../common/tracer/tracer.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserSyncGuard } from '../guards/user-sync.guard';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { AllExceptionsFilter } from '../filters/all-exceptions.filter';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
    InvitationsModule,
    OrganizationsModule,
    AgentsModule,
    TracerModule,
    CryptoModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: UserSyncGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
