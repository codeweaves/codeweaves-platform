import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { passportJwtSecret } from 'jwks-rsa';
import { ConfigService } from '@nestjs/config';
import { JwtPayload, ValidatedUser } from '../interfaces/jwt-payload.interface';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(private configService: ConfigService) {
    // Clerk Frontend API URL, e.g. https://clerk.klivo.app (prod custom domain)
    // or https://<slug>.clerk.accounts.dev (development instance). This is the
    // `iss` claim Clerk puts on its session tokens / JWT-template tokens.
    const issuer = configService.get<string>('CLERK_ISSUER');
    // Optional: the `aud` claim configured on the `klivo-api` JWT template.
    // If unset we skip audience validation and rely on issuer + signature.
    const audience = configService.get<string>('CLERK_JWT_AUDIENCE');

    if (!issuer) {
      throw new Error('CLERK_ISSUER must be configured');
    }

    const normalizedIssuer = issuer.replace(/\/$/, '');

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: normalizedIssuer,
      ...(audience ? { audience } : {}),
      algorithms: ['RS256'],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${normalizedIssuer}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    return {
      clerkId: payload.sub,
      email: payload.email ?? '',
    };
  }
}
