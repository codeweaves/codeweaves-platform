import { Test, TestingModule } from '@nestjs/testing';
import type { Job } from 'bullmq';

import { WhatsappInboundProcessor } from '../../../src/modules/whatsapp/whatsapp-inbound.processor';
import { WhatsappInboundService } from '../../../src/modules/whatsapp/whatsapp-inbound.service';
import type { WhatsappInboundJob } from '../../../src/modules/whatsapp/interfaces/whatsapp.interfaces';

describe('WhatsappInboundProcessor', () => {
  let processor: WhatsappInboundProcessor;
  const mockInbound = { handleInbound: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WhatsappInboundProcessor,
        { provide: WhatsappInboundService, useValue: mockInbound },
      ],
    }).compile();

    processor = module.get(WhatsappInboundProcessor);
    jest.clearAllMocks();
  });

  it('forwards the job payload to WhatsappInboundService', async () => {
    const data: WhatsappInboundJob = {
      phoneNumberId: 'p1',
      from: '15551234567',
      messageId: 'wamid.in',
      type: 'text',
      text: 'hi',
    };

    await processor.process({ data } as Job<WhatsappInboundJob>);

    expect(mockInbound.handleInbound).toHaveBeenCalledWith(data);
  });
});
