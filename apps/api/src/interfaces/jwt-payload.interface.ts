export interface JwtPayload {
  sub: string; // Clerk user ID (e.g. "user_2abc...")
  sid?: string; // Clerk session ID; present on session tokens only
  email?: string; // added to the session token in the Clerk dashboard (ADR-0008)
}

export interface ValidatedUser {
  clerkId: string;
  email: string;
}
