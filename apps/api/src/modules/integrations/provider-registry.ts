import { BadRequestException, Injectable } from '@nestjs/common';
import type { IntegrationProvider } from '@repo/validation';

import { HubspotProvider } from './providers/hubspot.provider';
import type { IntegrationProviderDef } from './providers/provider.interface';
import { SlackProvider } from './providers/slack.provider';

/**
 * Static registry of concrete integration providers. Adding a provider =
 * one provider class + one entry here + the enum value in @repo/validation.
 * Deliberately NOT dynamic/config-driven — see the integrations plan: we
 * build the integrations we have, not a connector platform for ones we don't.
 */
@Injectable()
export class ProviderRegistry {
  private readonly providers: Record<IntegrationProvider, IntegrationProviderDef>;

  constructor(hubspot: HubspotProvider, slack: SlackProvider) {
    this.providers = { hubspot, slack };
  }

  get(provider: string): IntegrationProviderDef {
    const def = this.providers[provider as IntegrationProvider];
    if (!def) {
      throw new BadRequestException(`Unknown integration provider "${provider}".`);
    }
    return def;
  }

  has(provider: string): boolean {
    return provider in this.providers;
  }
}
