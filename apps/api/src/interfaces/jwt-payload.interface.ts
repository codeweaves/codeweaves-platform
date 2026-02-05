export interface JwtPayload {
  sub: string; // Auth0 user ID
  email: string;
  'https://codeweaves.com/roles'?: string[];
  'https://codeweaves.com/organizationId'?: string;
}

export interface ValidatedUser {
  auth0Id: string;
  email: string;
  roles: string[];
  organizationId?: string;
}
