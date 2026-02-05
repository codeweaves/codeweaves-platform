import { Controller, Get } from '@nestjs/common';
import { Public } from '../../decorators/public.decorator';

@Controller('public')
export class HealthController {
  @Public()
  @Get('health')
  getHealth(): { status: string; timestamp: string; version: string } {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
    };
  }

  @Public()
  @Get('ping')
  ping(): { message: string } {
    return { message: 'pong' };
  }
}
