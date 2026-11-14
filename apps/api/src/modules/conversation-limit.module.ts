import { Module } from "@nestjs/common";
import { ConversationLimitService } from "../services/conversation-limit.service";
import { PrismaModule } from "./prisma.module";
import { EmailModule } from "./email.module";
import { LoggerModule } from "../common/logger/logger.module";

/**
 * The per-organization conversation limit (ADR-0022). Its own module so that
 * ChatModule (the alert hook) and OrganizationsModule (the staff routes) can
 * both use it without importing each other.
 */
@Module({
  imports: [PrismaModule, EmailModule, LoggerModule],
  providers: [ConversationLimitService],
  exports: [ConversationLimitService],
})
export class ConversationLimitModule {}
