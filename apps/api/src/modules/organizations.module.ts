import { Module } from '@nestjs/common';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationMembersService } from '../services/organization-members.service';
import { OrganizationsController } from '../controllers/organizations/organizations.controller';
import { OrganizationMembersController } from '../controllers/organizations/organization-members.controller';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController, OrganizationMembersController],
  providers: [OrganizationsService, OrganizationMembersService],
  exports: [OrganizationsService, OrganizationMembersService],
})
export class OrganizationsModule {}
