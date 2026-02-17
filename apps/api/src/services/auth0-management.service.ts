import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { Auth0LoggerService } from '../common/logger/auth0.logger';

interface Auth0User {
  user_id: string;
  email: string;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

@Injectable()
export class Auth0ManagementService {
  private readonly logger = new Logger(Auth0ManagementService.name);
  private cachedToken: CachedToken | null = null;
  private pendingTokenFetch: Promise<string> | null = null;

  private readonly domain: string;
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly audience: string;

  private static readonly FETCH_TIMEOUT_MS = 10_000;

  constructor(
    private configService: ConfigService,
    private readonly auth0Logger: Auth0LoggerService,
  ) {
    this.domain = this.configService.get<string>('AUTH0_DOMAIN', '');
    this.clientId = this.configService.get<string>('AUTH0_M2M_CLIENT_ID', '');
    this.clientSecret = this.configService.get<string>(
      'AUTH0_M2M_CLIENT_SECRET',
      '',
    );
    this.audience = `https://${this.domain}/api/v2/`;
  }

  private async fetchWithTimeout(
    url: string,
    init: RequestInit,
    timeoutMs = Auth0ManagementService.FETCH_TIMEOUT_MS,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      return await fetch(url, { ...init, signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
  }

  async getManagementToken(): Promise<string> {
    if (this.cachedToken && Date.now() < this.cachedToken.expiresAt) {
      return this.cachedToken.token;
    }

    // Prevent concurrent token fetches — reuse in-flight request
    if (this.pendingTokenFetch) {
      return this.pendingTokenFetch;
    }

    this.pendingTokenFetch = this.fetchManagementToken();

    try {
      return await this.pendingTokenFetch;
    } finally {
      this.pendingTokenFetch = null;
    }
  }

  private async fetchManagementToken(): Promise<string> {
    const response = await this.fetchWithTimeout(`https://${this.domain}/oauth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        audience: this.audience,
        grant_type: 'client_credentials',
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Auth0 M2M token: ${error}`);
    }

    const data = (await response.json()) as {
      access_token: string;
      expires_in: number;
    };

    // Cache with 5-minute safety margin
    this.cachedToken = {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000,
    };

    return data.access_token;
  }

  async createUser(email: string): Promise<Auth0User> {
    const token = await this.getManagementToken();

    const response = await this.fetchWithTimeout(`https://${this.domain}/api/v2/users`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        password: randomUUID() + 'Aa1!',
        connection: 'Username-Password-Authentication',
        email_verified: false,
      }),
    });

    if (response.status === 409) {
      // User already exists — fetch and return existing user
      this.logger.warn(
        `Auth0 user already exists for ${email}, fetching existing user`,
      );
      const existingUser = await this.getUserByEmail(email);
      if (existingUser) {
        return existingUser;
      }
      throw new Error(
        `Auth0 user conflict for ${email} but could not find existing user`,
      );
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Failed to create Auth0 user: ${errorText}`);
      await this.auth0Logger.logAuth0UserCreationFailed(email, error, { request: { email } });
      throw error;
    }

    const user = (await response.json()) as Auth0User;
    await this.auth0Logger.logAuth0UserCreated(user.user_id, { email, user_id: user.user_id });
    return user;
  }

  async getUserByEmail(email: string): Promise<Auth0User | null> {
    const token = await this.getManagementToken();

    const response = await this.fetchWithTimeout(
      `https://${this.domain}/api/v2/users-by-email?email=${encodeURIComponent(email)}`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to get Auth0 user by email: ${error}`);
    }

    const users = (await response.json()) as Auth0User[];
    return users[0] ?? null;
  }

  async deleteUser(auth0UserId: string): Promise<void> {
    const token = await this.getManagementToken();

    const response = await this.fetchWithTimeout(
      `https://${this.domain}/api/v2/users/${encodeURIComponent(auth0UserId)}`,
      {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      },
    );

    if (response.status === 404) {
      this.logger.warn(`Auth0 user ${auth0UserId} not found, skipping delete`);
      return;
    }

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Failed to delete Auth0 user: ${errorText}`);
      await this.auth0Logger.logAuth0UserDeletionFailed(auth0UserId, error, { request: { auth0UserId } });
      throw error;
    }

    await this.auth0Logger.logAuth0UserDeleted(auth0UserId, { auth0UserId });
  }

  async createPasswordChangeTicket(auth0UserId: string): Promise<string> {
    const token = await this.getManagementToken();
    const spaClientId = this.configService.get<string>('AUTH0_SPA_CLIENT_ID', '');

    const response = await this.fetchWithTimeout(
      `https://${this.domain}/api/v2/tickets/password-change`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          user_id: auth0UserId,
          client_id: spaClientId || undefined,
          ttl_sec: 604800, // 7 days
          mark_email_as_verified: true,
          includeEmailInRedirect: false,
        }),
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      const error = new Error(`Failed to create password change ticket: ${errorText}`);
      await this.auth0Logger.logAuth0PasswordTicketFailed(auth0UserId, error, { request: { auth0UserId } });
      throw error;
    }

    const data = (await response.json()) as { ticket: string };
    await this.auth0Logger.logAuth0PasswordTicketCreated(auth0UserId, { auth0UserId });
    return data.ticket;
  }
}
