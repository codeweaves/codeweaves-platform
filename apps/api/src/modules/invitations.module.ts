import { Module } from '@nestjs/common';
import { InvitationsService } from '../services/invitations.service';
import { InvitationsController } from '../controllers/invitations/invitations.controller';
import { PrismaModule } from './prisma.module';
import { EmailModule } from './email.module';

@Module({
  imports: [PrismaModule, EmailModule],
  controllers: [InvitationsController],
  providers: [InvitationsService],
  exports: [InvitationsService],
})
export class InvitationsModule {}
