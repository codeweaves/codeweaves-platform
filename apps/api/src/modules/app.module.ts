import { Module, NestModule, MiddlewareConsumer } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { PrismaModule } from './prisma.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { InvitationsModule } from './invitations.module';
import { OrganizationsModule } from './organizations.module';
import { AgentsModule } from './agents.module';
import { ChatModule } from './chat.module';
import { VoiceModule } from './voice/voice.module';
import { AnalyticsModule } from './analytics.module';
import { AiTraceModule } from './ai/trace/ai-trace.module';
import { DevModule } from './dev.module';
import { AgentCacheModule } from '../common/cache/agent-cache.module';
import { WidgetCorsCacheModule } from '../common/cache/widget-cors-cache.module';
import { ConversationsModule } from './conversations.module';
import { HandoverModule } from './handover.module';
import { ConversationClassifierModule } from './conversation-classifier.module';
import { DataExtractionModule } from './data-extraction.module';
import { EventLogRetentionModule } from './event-log-retention.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { TracerModule } from '../common/tracer/tracer.module';
import { EventsModule } from '../common/events/events.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { PiiModule } from './pii/pii.module';
import { RedisModule } from '../common/redis/redis.module';
import { SentryModule } from '../common/sentry/sentry.module';
import { RbacModule } from '../common/rbac/rbac.module';
import { SecurityModule } from '../common/security/security.module';
import { SupabaseStorageModule } from './supabase-storage.module';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserSyncGuard } from '../guards/user-sync.guard';
import { RateLimitGuard } from '../guards/rate-limit.guard';
import { CorrelationIdMiddleware } from '../middleware/correlation-id.middleware';
import { WidgetCorsMiddleware } from '../middleware/widget-cors.middleware';
import { DashboardCorsMiddleware } from '../middleware/dashboard-cors.middleware';
import { LoggingInterceptor } from '../interceptors/logging.interceptor';
import { SentryInterceptor } from '../common/sentry/sentry.interceptor';
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
    ChatModule,
    VoiceModule,
    AnalyticsModule,
    AiTraceModule,
    DevModule,
    AgentCacheModule,
    WidgetCorsCacheModule,
    ConversationsModule,
    HandoverModule,
    ConversationClassifierModule,
    DataExtractionModule,
    EventLogRetentionModule,
    WhatsappModule,
    TracerModule,
    EventsModule,
    CryptoModule,
    PiiModule,
    RedisModule,
    SentryModule,
    RbacModule,
    SecurityModule,
    SupabaseStorageModule,
    HealthModule,
  ],
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
      provide: APP_GUARD,
      useClass: RateLimitGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: SentryInterceptor,
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
    consumer.apply(WidgetCorsMiddleware).forRoutes('public/*');
    consumer
      .apply(DashboardCorsMiddleware)
      .exclude('public/(.*)')
      .forRoutes('*');
  }
}
