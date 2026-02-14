import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { EmailService } from '../../../src/services/email.service';

// Mock Resend with a class so `new Resend()` works correctly
jest.mock('resend', () => ({
  Resend: class MockResend {
    emails = { send: jest.fn() };
  },
}));

describe('EmailService', () => {
  let service: EmailService;
  let mockSend: jest.Mock;

  const configValues: Record<string, string> = {
    RESEND_API_KEY: 're_test_key',
    EMAIL_FROM: 'Test <test@example.com>',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, defaultValue?: string) =>
              configValues[key] ?? defaultValue,
          },
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
    // Access the mock send via the service's internal resend instance
    mockSend = (
      service as unknown as { resend: { emails: { send: jest.Mock } } }
    ).resend.emails.send;
    mockSend.mockReset();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should send email successfully', async () => {
    mockSend.mockResolvedValue({
      data: { id: 'email-123' },
      error: null,
    });

    const result = await service.send({
      to: 'recipient@example.com',
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });

    expect(result).toEqual({ id: 'email-123' });
    expect(mockSend).toHaveBeenCalledWith({
      from: 'Test <test@example.com>',
      to: ['recipient@example.com'],
      subject: 'Test Subject',
      html: '<p>Hello</p>',
    });
  });

  it('should return null when Resend returns an error', async () => {
    mockSend.mockResolvedValue({
      data: null,
      error: { message: 'Invalid API key' },
    });

    const result = await service.send({
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result).toBeNull();
  });

  it('should return null and not throw on send failure', async () => {
    mockSend.mockRejectedValue(new Error('Network error'));

    const result = await service.send({
      to: 'recipient@example.com',
      subject: 'Test',
      html: '<p>Hello</p>',
    });

    expect(result).toBeNull();
  });
});
