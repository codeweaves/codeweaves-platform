import { Global, Module } from '@nestjs/common';
import { HmacService } from './hmac.service';

@Global()
@Module({
  providers: [HmacService],
  exports: [HmacService],
})
export class SecurityModule {}
