import { ConfigService } from '@nestjs/config';

import { WhatsappConfigService } from '../../../src/modules/whatsapp/whatsapp-config.service';

describe('WhatsappConfigService', () => {
  const build = (env: Record<string, string | undefined>) => {
    const config = { get: (k: string) => env[k] } as unknown as ConfigService;
    return new WhatsappConfigService(config);
  };

  it('reports configured when app secret + verify token are present', () => {
    const s = build({
      WHATSAPP_APP_SECRET: 'sec',
      WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'tok',
    });
    expect(s.isConfigured).toBe(true);
    expect(s.appSecret).toBe('sec');
    expect(s.verifyToken).toBe('tok');
  });

  it('is not configured when either secret is missing', () => {
    expect(build({ WHATSAPP_APP_SECRET: 'sec' }).isConfigured).toBe(false);
    expect(build({ WHATSAPP_WEBHOOK_VERIFY_TOKEN: 'tok' }).isConfigured).toBe(false);
    expect(build({}).isConfigured).toBe(false);
  });

  it('defaults the Graph API version and builds the base URL', () => {
    const s = build({});
    expect(s.graphApiVersion).toBe('v21.0');
    expect(s.graphBaseUrl).toBe('https://graph.facebook.com/v21.0');
  });

  it('honours a Graph API version override', () => {
    const s = build({ WHATSAPP_GRAPH_API_VERSION: 'v23.0' });
    expect(s.graphBaseUrl).toBe('https://graph.facebook.com/v23.0');
  });
});
