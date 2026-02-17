import { Module } from '@nestjs/common';
import { Auth0ManagementService } from '../services/auth0-management.service';
import { LoggerModule } from '../common/logger/logger.module';

@Module({
  imports: [LoggerModule],
  providers: [Auth0ManagementService],
  exports: [Auth0ManagementService],
})
export class Auth0ManagementModule {}
