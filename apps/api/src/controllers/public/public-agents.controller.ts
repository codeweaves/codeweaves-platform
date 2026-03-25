import { Controller, Get, Param, ParseUUIDPipe, Res, Headers } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam, ApiHeader } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { AgentsService } from '../../services/agents.service';

@ApiTags('Public Agents')
@Controller('public/agents')
export class PublicAgentsController {
  constructor(private readonly agentsService: AgentsService) {}

  @Public()
  @Get(':id/demo')
  @ApiOperation({ summary: 'Get public agent info for demo page' })
  @ApiParam({ name: 'id', description: 'Agent UUID' })
  @ApiResponse({ status: 200, description: 'Agent demo info' })
  @ApiResponse({ status: 404, description: 'Agent not found or inactive' })
  async getDemoInfo(@Param('id', ParseUUIDPipe) id: string) {
    return this.agentsService.getDemoInfo(id);
  }

  @Public()
  @Get(':publicId/config')
  @ApiOperation({ summary: 'Get widget configuration by public ID (ETag-cacheable)' })
  @ApiParam({ name: 'publicId', description: 'Agent public ID (8-char slug)' })
  @ApiHeader({ name: 'If-None-Match', required: false, description: 'Cached ETag value' })
  @ApiResponse({ status: 200, description: 'Widget configuration' })
  @ApiResponse({ status: 304, description: 'Not Modified — cached config is still valid' })
  @ApiResponse({ status: 404, description: 'Agent not found or inactive' })
  async getWidgetConfig(
    @Param('publicId') publicId: string,
    @Headers('if-none-match') ifNoneMatch: string | undefined,
    @Res({ passthrough: true }) res: { setHeader: (name: string, value: string) => void; status: (code: number) => void },
  ) {
    const { config, version } = await this.agentsService.getWidgetConfig(publicId);
    const etag = `"${version}"`;

    res.setHeader('ETag', etag);
    res.setHeader('Cache-Control', 'no-cache');

    if (ifNoneMatch && ifNoneMatch === etag) {
      res.status(304);
      return;
    }

    return config;
  }
}
