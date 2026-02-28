import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from './prisma.service';
import { AgentsService } from './agents.service';
import { CryptoService } from '../common/crypto/crypto.service';

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly agentsService: AgentsService,
    private readonly cryptoService: CryptoService,
  ) {}
}
