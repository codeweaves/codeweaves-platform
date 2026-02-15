import { Module } from '@nestjs/common';
import { OrganizationsService } from '../services/organizations.service';
import { OrganizationsController } from '../controllers/organizations/organizations.controller';
import { PrismaModule } from './prisma.module';

@Module({
  imports: [PrismaModule],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}
