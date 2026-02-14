import { Module } from '@nestjs/common';
import { InvitationsService } from '../services/invitations.service';
import { InvitationsController } from '../controllers/invitations/invitations.controller';
import { PrismaModule } from './prisma.module';
import { EmailModule } from './email.module';
import { Auth0ManagementModule } from './auth0-management.module';

@Module({
  imports: [PrismaModule, EmailModule, Auth0ManagementModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
