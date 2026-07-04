import { Injectable, Logger } from '@nestjs/common';
import { tool, type ToolSet } from 'ai';
import { hubspotCredentialsSchema } from '@repo/validation';
import { z } from 'zod';

import {
  TOOL_CALL_TIMEOUT_MS,
  truncateToolResult,
  type ConnectionTestResult,
  type IntegrationProviderDef,
  type ToolStepMeta,
} from './provider.interface';

/** Pinned API host — customer input can never redirect these calls. */
const HUBSPOT_API_BASE = 'https://api.hubapi.com';

/** CRM properties we read/write. Kept minimal on purpose. */
const CONTACT_PROPERTIES = [
  'firstname',
  'lastname',
  'email',
  'phone',
  'company',
  'lifecyclestage',
] as const;

/**
 * HubSpot CRM integration, authenticated with a Private App access token
 * (scopes: crm.objects.contacts.read + crm.objects.contacts.write).
 *
 * Why Private App tokens instead of OAuth: tokens don't expire (no refresh
 * machinery, no re-auth churn), the customer creates one in two minutes, and
 * we avoid hosting a public HubSpot app through review. OAuth + refresh (the
 * Nango-style token lifecycle) becomes worth it only when we need per-user
 * consent screens — revisit then.
 *
 * Tools exposed to the LLM:
 *   - hubspot_find_contact       (read)   — look up a contact by email
 *   - hubspot_save_contact       (write)  — create or update a contact (lead capture)
 */
@Injectable()
export class HubspotProvider implements IntegrationProviderDef {
  readonly provider = 'hubspot' as const;
  private readonly logger = new Logger(HubspotProvider.name);

  readonly toolStepMeta: Record<string, ToolStepMeta> = {
    hubspot_find_contact: {
      activeLabel: 'Looking up customer data…',
      doneLabel: 'Fetched customer data',
      errorLabel: 'Customer lookup failed',
    },
    hubspot_save_contact: {
      activeLabel: 'Saving contact to CRM…',
      doneLabel: 'Saved contact to CRM',
      errorLabel: 'CRM update failed',
    },
  };

  parseCredentials(raw: unknown): Record<string, string> {
    return hubspotCredentialsSchema.parse(raw);
  }

  credentialHint(credentials: Record<string, string>): string {
    const token = credentials.accessToken ?? '';
    return `${token.slice(0, 4)}…${token.slice(-4)}`;
  }

  async testConnection(
    credentials: Record<string, string>,
  ): Promise<ConnectionTestResult> {
    const result = await this.request(
      credentials.accessToken!,
      'GET',
      '/crm/v3/objects/contacts?limit=1',
    );
    if (result.ok) {
      return { ok: true, message: 'Connected — contacts API reachable.' };
    }
    return { ok: false, message: result.error };
  }

  buildTools(credentials: Record<string, string>): ToolSet {
    const accessToken = credentials.accessToken!;
    return {
      hubspot_find_contact: tool({
        description:
          "Look up an existing customer in the company's CRM (HubSpot) by their email address. Use when the user identifies themselves and knowing their account details would help (e.g. plan, lifecycle stage, phone on file). Do NOT use for people who haven't shared an email.",
        inputSchema: z.object({
          email: z
            .string()
            .email()
            .describe("The customer's email address, exactly as they gave it."),
        }),
        execute: async ({ email }) => this.findContact(accessToken, email),
      }),
      hubspot_save_contact: tool({
        description:
          "Create or update a contact in the company's CRM (HubSpot). Use when the user shares contact details and wants follow-up, a demo, a callback, or to be added as a lead. Requires at least an email. Updates the existing contact when the email is already in the CRM.",
        inputSchema: z.object({
          email: z.string().email().describe("The contact's email address."),
          firstName: z.string().max(100).optional().describe('First name, if shared.'),
          lastName: z.string().max(100).optional().describe('Last name, if shared.'),
          phone: z.string().max(40).optional().describe('Phone number, if shared.'),
          company: z.string().max(200).optional().describe('Company name, if shared.'),
        }),
        execute: async (input) => this.saveContact(accessToken, input),
      }),
    };
  }

  // --------------------------------------------------------------------------
  // Tool implementations — always resolve to a string the model can read.
  // --------------------------------------------------------------------------

  private async findContact(
    accessToken: string,
    email: string,
  ): Promise<string> {
    const result = await this.request(
      accessToken,
      'POST',
      '/crm/v3/objects/contacts/search',
      {
        filterGroups: [
          {
            filters: [
              { propertyName: 'email', operator: 'EQ', value: email },
            ],
          },
        ],
        properties: [...CONTACT_PROPERTIES],
        limit: 1,
      },
    );
    if (!result.ok) return `Lookup failed: ${result.error}`;

    const body = result.body as {
      total?: number;
      results?: Array<{ id: string; properties?: Record<string, string | null> }>;
    };
    const contact = body.results?.[0];
    if (!contact) {
      return `No contact found in the CRM for ${email}.`;
    }
    const p = contact.properties ?? {};
    return truncateToolResult(
      [
        `Contact found (id ${contact.id}):`,
        `- name: ${[p.firstname, p.lastname].filter(Boolean).join(' ') || 'unknown'}`,
        `- email: ${p.email ?? email}`,
        `- phone: ${p.phone ?? 'not on file'}`,
        `- company: ${p.company ?? 'not on file'}`,
        `- lifecycle stage: ${p.lifecyclestage ?? 'unknown'}`,
      ].join('\n'),
    );
  }

  private async saveContact(
    accessToken: string,
    input: {
      email: string;
      firstName?: string;
      lastName?: string;
      phone?: string;
      company?: string;
    },
  ): Promise<string> {
    const properties: Record<string, string> = { email: input.email };
    if (input.firstName) properties.firstname = input.firstName;
    if (input.lastName) properties.lastname = input.lastName;
    if (input.phone) properties.phone = input.phone;
    if (input.company) properties.company = input.company;

    // Create first; on the documented 409 "contact already exists" fall back
    // to an update. One write round-trip in the common (new lead) case.
    const created = await this.request(
      accessToken,
      'POST',
      '/crm/v3/objects/contacts',
      { properties },
    );
    if (created.ok) {
      const id = (created.body as { id?: string }).id ?? 'unknown';
      return `Created new CRM contact (id ${id}) for ${input.email}.`;
    }

    if (created.status === 409) {
      // "Contact already exists. Existing ID: 12345" — parse the id.
      const idMatch = /Existing ID:\s*(\d+)/i.exec(created.error);
      const existingId = idMatch?.[1];
      if (existingId) {
        const updated = await this.request(
          accessToken,
          'PATCH',
          `/crm/v3/objects/contacts/${existingId}`,
          { properties },
        );
        return updated.ok
          ? `Updated existing CRM contact (id ${existingId}) for ${input.email}.`
          : `Contact exists (id ${existingId}) but update failed: ${updated.error}`;
      }
    }
    return `Could not save contact: ${created.error}`;
  }

  // --------------------------------------------------------------------------
  // HTTP plumbing — pinned host, hard timeout, error → structured string
  // --------------------------------------------------------------------------

  private async request(
    accessToken: string,
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    body?: unknown,
  ): Promise<
    | { ok: true; status: number; body: unknown; error?: never }
    | { ok: false; status: number | null; error: string; body?: never }
  > {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TOOL_CALL_TIMEOUT_MS);
    try {
      const res = await fetch(`${HUBSPOT_API_BASE}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      const text = await res.text();
      if (!res.ok) {
        // HubSpot error bodies carry a useful `message`; never echo the token.
        let message = `HubSpot returned HTTP ${res.status}`;
        try {
          const parsed = JSON.parse(text) as { message?: string };
          if (parsed.message) message = `${message}: ${parsed.message}`;
        } catch {
          /* non-JSON error body — keep the generic message */
        }
        return { ok: false, status: res.status, error: message.slice(0, 500) };
      }
      return { ok: true, status: res.status, body: text ? JSON.parse(text) : {} };
    } catch (err) {
      const timedOut = err instanceof Error && err.name === 'AbortError';
      this.logger.warn(
        `HubSpot ${method} ${path} failed: ${timedOut ? 'timeout' : err instanceof Error ? err.message : String(err)}`,
      );
      return {
        ok: false,
        status: null,
        error: timedOut
          ? `HubSpot did not respond within ${TOOL_CALL_TIMEOUT_MS / 1000}s.`
          : 'Network error reaching HubSpot.',
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
