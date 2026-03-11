import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { SkipRateLimit } from '../../decorators/rate-limit.decorator';

@ApiTags('Health')
@SkipRateLimit()
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Liveness health check' })
  @ApiResponse({ status: 200, description: 'Service is alive' })
  getHealth(): {
    status: string;
    timestamp: string;
    version: string;
    uptime: number;
  } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '0.0.0',
      uptime: process.uptime(),
    };
  }
}
