import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

// PrismaModule, RedisModule and ConfigModule are all global, so the readiness
// probes resolve without importing them here.
@Module({
  controllers: [HealthController],
})
export class HealthModule {}
