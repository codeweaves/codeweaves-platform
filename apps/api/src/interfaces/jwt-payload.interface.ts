export interface JwtPayload {
  sub: string; // Clerk user ID (e.g. "user_2abc...")
  email?: string;
  aud?: string | string[];
}

export interface ValidatedUser {
  clerkId: string;
  email: string;
}
