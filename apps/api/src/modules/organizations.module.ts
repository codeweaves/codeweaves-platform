import { Module } from "@nestjs/common";
import { OrganizationsService } from "../services/organizations.service";
import { OrganizationMembersService } from "../services/organization-members.service";
import { OrganizationsController } from "../controllers/organizations/organizations.controller";
import { OrganizationMembersController } from "../controllers/organizations/organization-members.controller";
import { OrganizationContractController } from "../controllers/organizations/organization-contract.controller";
import { PrismaModule } from "./prisma.module";
import { LoggerModule } from "../common/logger/logger.module";
import { ConversationLimitModule } from "./conversation-limit.module";

@Module({
  imports: [PrismaModule, LoggerModule, ConversationLimitModule],
  controllers: [
    OrganizationsController,
    OrganizationMembersController,
    OrganizationContractController,
  ],
  providers: [OrganizationsService, OrganizationMembersService],
  exports: [OrganizationsService, OrganizationMembersService],
})
export class OrganizationsModule {}
