import { Module } from '@nestjs/common';
import { Auth0ManagementService } from '../services/auth0-management.service';

@Module({
  providers: [Auth0ManagementService],
  exports: [Auth0ManagementService],
})
export class Auth0ManagementModule {}
