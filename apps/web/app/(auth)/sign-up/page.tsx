'use client';

import { useState, useEffect } from 'react';
import { useSignUp, useClerk, useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import Link from 'next/link';
import { clerkErrorMessage, isInvitationTicketError } from '@/lib/clerk-errors';
import { AuthShell, AuthNotice } from '@/components/features/auth/auth-shell';

/**
 * Invitation sign-up on Clerk Core 3 hooks (`useSignUp`). Users arrive from the
 * invitation email with a `__clerk_ticket` (email pre-verified); they set a
 * password. Public sign-up is disabled in Clerk, so this is only usable with a
 * valid ticket.
 */
export default function SignUpPage() {
  const { signUp } = useSignUp();
  const { signOut } = useClerk();
  const { isLoaded, isSignedIn } = useAuth();
  const searchParams = useSearchParams();
  const ticket = searchParams.get('__clerk_ticket');

  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [linkExpired, setLinkExpired] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Clerk won't let you accept an invitation ticket while a session is active.
  // If someone opens the invite while signed in (e.g. an admin in the same
  // browser), sign them out and reload this exact URL (ticket preserved) so the
  // ticket is created cleanly in a signed-out state.
  useEffect(() => {
    if (isLoaded && isSignedIn && ticket) {
      void signOut({
        redirectUrl: window.location.pathname + window.location.search,
      });
    }
  }, [isLoaded, isSignedIn, ticket, signOut]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signUp || submitting || !ticket) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }

    setError(null);
    setSubmitting(true);
    try {
      // Accept the invitation ticket AND set the password in one call via
      // create() with the ticket strategy. (signUp.ticket() doesn't take a
      // password, and a separate signUp.password() doesn't attach to a ticket
      // sign-up — both leave status 'missing_requirements'.)
      const { error: ticketError } = await signUp.create({
        strategy: 'ticket',
        ticket,
        password,
      });
      if (ticketError) {
        // A dead ticket (expired/used/invalid) → clear "link expired" screen.
        // Anything else (e.g. breached/weak password) → keep them on the form.
        if (isInvitationTicketError(ticketError)) {
          setLinkExpired(true);
        } else {
          setError(clerkErrorMessage(ticketError));
        }
        setSubmitting(false);
        return;
      }

      if (signUp.status === 'complete') {
        // Account created — send them to sign in fresh with their new password
        // (don't drop them straight into the dashboard).
        await signOut({ redirectUrl: '/sign-in?welcome=1' });
      } else {
        const su = signUp as unknown as {
          missingFields?: string[];
          unverifiedFields?: string[];
        };
        const detail = [
          su.missingFields?.length
            ? `missing: ${su.missingFields.join(', ')}`
            : '',
          su.unverifiedFields?.length
            ? `unverified: ${su.unverifiedFields.join(', ')}`
            : '',
        ]
          .filter(Boolean)
          .join('; ');
        setError(
          `Could not complete sign-up (${signUp.status}${detail ? `: ${detail}` : ''}).`,
        );
        setSubmitting(false);
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
      setSubmitting(false);
    }
  };

  if (!ticket) {
    return (
      <AuthShell>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">
            Invitation required
          </h2>
          <p className="text-sm text-muted-foreground">
            Sign-up is by invitation only. Please open the link from your
            invitation email to set your password.
          </p>
        </div>
      </AuthShell>
    );
  }

  if (linkExpired) {
    return (
      <AuthShell>
        <div className="space-y-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">
            This invitation link has expired
          </h2>
          <p className="text-sm text-muted-foreground">
            It may have already been used or expired. Please ask your
            administrator to send you a new invitation.
          </p>
        </div>
        <p className="mt-8 text-sm">
          <Link
            href="/sign-in"
            className="font-medium text-sidebar-primary underline-offset-4 hover:underline"
          >
            Already have an account? Sign in
          </Link>
        </p>
      </AuthShell>
    );
  }

  // While we sign out an existing session (or auth state is still loading),
  // hold the form so nothing is submitted in a signed-in state.
  if (!isLoaded || isSignedIn) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Preparing your invitation…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome to Klivo
        </h2>
        <p className="text-sm text-muted-foreground">
          Set a password to finish creating your account.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {error && <AuthNotice variant="error">{error}</AuthNotice>}

        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11"
          />
        </div>

        {/* Clerk bot-protection mount point (renders only if enabled) */}
        <div id="clerk-captcha" />

        <Button type="submit" className="h-11 w-full" disabled={submitting}>
          {submitting && <Loader2 className="size-4 animate-spin" />}
          Create account
        </Button>
      </form>
    </AuthShell>
  );
}
