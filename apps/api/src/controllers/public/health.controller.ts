import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { SkipRateLimit } from '../../decorators/rate-limit.decorator';

@ApiTags('Health')
@SkipRateLimit()
@Controller('public')
export class HealthController {
  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Health check' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
  getHealth(): { status: string; timestamp: string; version: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Public()
  @Get('ping')
  @ApiOperation({ summary: 'Ping' })
  @ApiResponse({ status: 200, description: 'Pong' })
  ping(): { message: string } {
    return { message: 'pong' };
  }
}
