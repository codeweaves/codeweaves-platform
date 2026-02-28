import { Controller } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../decorators/public.decorator';
import { ChatService } from '../../services/chat.service';

@ApiTags('Public Chat')
@Public()
@Controller('public/chat')
export class PublicChatController {
  constructor(private readonly chatService: ChatService) {}
}
