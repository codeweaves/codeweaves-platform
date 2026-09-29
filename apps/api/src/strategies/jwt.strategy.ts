import { Injectable, UnauthorizedException } from "@nestjs/common";
import { PassportStrategy } from "@nestjs/passport";
import { ExtractJwt, Strategy } from "passport-jwt";
import { passportJwtSecret } from "jwks-rsa";
import { ConfigService } from "@nestjs/config";
import { JwtPayload, ValidatedUser } from "../interfaces/jwt-payload.interface";
import { AppLogger } from "../common/logger/app-logger";

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly log = new AppLogger(JwtStrategy.name);

  constructor(private configService: ConfigService) {
    // Clerk Frontend API URL, e.g. https://clerk.klivo.app (prod custom domain)
    // or https://<slug>.clerk.accounts.dev (development instance). This is the
    // `iss` claim on Clerk session tokens. They carry no audience; issuer plus
    // signature is the check, the same one the socket gateway makes (ADR-0008).
    const issuer = configService.get<string>("CLERK_ISSUER");

    if (!issuer) {
      throw new Error("CLERK_ISSUER must be configured");
    }

    const normalizedIssuer = issuer.replace(/\/$/, "");

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      issuer: normalizedIssuer,
      algorithms: ["RS256"],
      secretOrKeyProvider: passportJwtSecret({
        cache: true,
        rateLimit: true,
        jwksRequestsPerMinute: 5,
        jwksUri: `${normalizedIssuer}/.well-known/jwks.json`,
      }),
    });
  }

  async validate(payload: JwtPayload): Promise<ValidatedUser> {
    // Only session tokens carry `sid`. Without this check any JWT the Clerk
    // instance signs (every template, whatever its lifetime) would pass.
    if (!payload.sid) {
      throw new UnauthorizedException("Not a Clerk session token");
    }
    this.log.debug("validate", "token validated", { clerkId: payload.sub });
    return {
      clerkId: payload.sub,
      email: payload.email ?? "",
    };
  }
}
