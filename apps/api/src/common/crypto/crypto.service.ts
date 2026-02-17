import { Injectable, OnModuleInit, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

@Injectable()
export class CryptoService implements OnModuleInit {
  private readonly logger = new Logger(CryptoService.name);
  private key!: Buffer;

  constructor(private configService: ConfigService) {}

  onModuleInit() {
    const hex = this.configService.get<string>('AGENT_SECRET_KEY');
    if (!hex) {
      throw new Error('AGENT_SECRET_KEY environment variable is required');
    }
    this.key = Buffer.from(hex, 'hex');
    if (this.key.length !== 32) {
      throw new Error(
        'AGENT_SECRET_KEY must be a 64-character hex string (32 bytes)',
      );
    }
    this.logger.log('CryptoService initialized');
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(16);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('hex')}:${encrypted.toString('hex')}:${tag.toString('hex')}`;
  }

  decrypt(encrypted: string): string {
    const parts = encrypted.split(':');
    if (parts.length !== 3) {
      throw new Error('Invalid encrypted value format');
    }
    const ivHex = parts[0]!;
    const dataHex = parts[1]!;
    const tagHex = parts[2]!;
    const iv = Buffer.from(ivHex, 'hex');
    const data = Buffer.from(dataHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(data).toString('utf8') + decipher.final('utf8');
  }
}
