import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiParam } from '@nestjs/swagger';
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
}
