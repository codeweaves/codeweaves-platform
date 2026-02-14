import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { HealthController } from '../controllers/public/health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserSyncInterceptor } from '../interceptors/user-sync.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    PrismaModule,
    AuthModule,
    UsersModule,
  ],
  controllers: [HealthController],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: UserSyncInterceptor,
    },
  ],
})
export class AppModule {}
