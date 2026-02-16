import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { HealthController } from '../controllers/public/health.controller';
import { PrismaModule } from './prisma.module';
import { AuthModule } from './auth.module';
import { UsersModule } from './users.module';
import { InvitationsModule } from './invitations.module';
import { OrganizationsModule } from './organizations.module';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { UserSyncGuard } from '../guards/user-sync.guard';

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
  ],
})
export class AppModule {}
