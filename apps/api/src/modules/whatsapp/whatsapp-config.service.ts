import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { DEFAULT_GRAPH_API_VERSION, GRAPH_API_HOST } from './whatsapp.constants';

/**
 * Reads WhatsApp platform-level config from env. Unlike CryptoService this does
 * NOT throw on boot when unset — WhatsApp is an optional channel, so a deployment
 * without it configured must still start. Consumers check `isConfigured` (or the
 * specific getter being non-null) and degrade gracefully (webhook 503 / skip).
 *
 * Env vars:
 *   WHATSAPP_APP_SECRET             — Meta App secret, for X-Hub-Signature-256 verification
 *   WHATSAPP_WEBHOOK_VERIFY_TOKEN   — arbitrary string we choose; echoed back in the GET handshake
 *   WHATSAPP_GRAPH_API_VERSION      — optional, defaults to DEFAULT_GRAPH_API_VERSION
 */
@Injectable()
export class WhatsappConfigService {
  private readonly logger = new Logger(WhatsappConfigService.name);

  constructor(private readonly config: ConfigService) {}

  get appSecret(): string | undefined {
    return this.config.get<string>('WHATSAPP_APP_SECRET');
  }

  get verifyToken(): string | undefined {
    return this.config.get<string>('WHATSAPP_WEBHOOK_VERIFY_TOKEN');
  }

  get graphApiVersion(): string {
    return (
      this.config.get<string>('WHATSAPP_GRAPH_API_VERSION') ??
      DEFAULT_GRAPH_API_VERSION
    );
  }

  /** Base URL for Graph API calls, e.g. "https://graph.facebook.com/v21.0". */
  get graphBaseUrl(): string {
    return `${GRAPH_API_HOST}/${this.graphApiVersion}`;
  }

  /** True when both secrets needed to receive webhooks are present. */
  get isConfigured(): boolean {
    return Boolean(this.appSecret) && Boolean(this.verifyToken);
  }
}
