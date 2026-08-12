'use client';

import { useEffect, useState } from 'react';
import { useAuth, useSignIn, useClerk } from '@clerk/nextjs';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { clerkErrorMessage } from '@/lib/clerk-errors';
import { AuthShell, AuthNotice } from '@/components/features/auth/auth-shell';

/** Mask an email for display, e.g. d•••@g•••.com (keeps first letters + TLD). */
function maskEmail(email: string): string {
  const at = email.indexOf('@');
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  const dot = domain.indexOf('.');
  const maskedDomain =
    dot > 0 ? `${domain[0]}•••${domain.slice(dot)}` : `${domain[0]}•••`;
  return `${local[0]}•••@${maskedDomain}`;
}

/**
 * Code-based password reset on Clerk Core 3 hooks. Reached from "Forgot
 * password?" (sign-in) or from Settings (which signs the user out first, since
 * Clerk requires a signed-out state to run a sign-in/reset flow). The user
 * enters their email → gets a code → sets a new password → is sent to sign in.
 */
export default function ResetPasswordPage() {
  const { signIn } = useSignIn();
  const { signOut } = useClerk();
  const { isLoaded: authLoaded, isSignedIn } = useAuth();
  const router = useRouter();

  // `signIn.create()` cannot run over a live session — Clerk rejects it with
  // `session_exists`, stranding the user on a form asking for an email we
  // already know. Settings signs out before sending anyone here, so reaching
  // this page signed in means a direct URL or a stale tab. Route them into the
  // app rather than let them walk into that dead end.
  useEffect(() => {
    if (authLoaded && isSignedIn) {
      router.replace('/dashboard');
    }
  }, [authLoaded, isSignedIn, router]);

  // The redirect above cannot fire until after the first paint, so the form has
  // to be withheld until we know the session state — otherwise a signed-in user
  // sees a flash of "Reset password" before being bounced. Withheld while auth
  // is still resolving too, since at that point `isSignedIn` is not yet false,
  // it is unknown.
  const redirecting = !authLoaded || isSignedIn;

  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const sendResetCode = async (target: string): Promise<boolean> => {
    if (!signIn) return false;
    const { error: createError } = await signIn.create({ identifier: target });
    if (createError) {
      setError(clerkErrorMessage(createError));
      return false;
    }
    const { error: sendError } = await signIn.resetPasswordEmailCode.sendCode();
    if (sendError) {
      setError(clerkErrorMessage(sendError));
      return false;
    }
    return true;
  };

  const requestCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn || submitting) return;
    setError(null);
    setSubmitting(true);
    const ok = await sendResetCode(email);
    if (ok) {
      setStep('reset');
      setNotice(`A one-time code has been sent to ${maskEmail(email)}.`);
    }
    setSubmitting(false);
  };

  const submitReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn || submitting) return;
    if (password !== confirmPassword) {
      setError("Passwords don't match.");
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      const { error: verifyError } =
        await signIn.resetPasswordEmailCode.verifyCode({ code });
      if (verifyError) {
        setError(clerkErrorMessage(verifyError));
        setSubmitting(false);
        return;
      }
      const { error: submitError } =
        await signIn.resetPasswordEmailCode.submitPassword({
          password,
          signOutOfOtherSessions: true,
        });
      if (submitError) {
        setError(clerkErrorMessage(submitError));
        setSubmitting(false);
        return;
      }

      if (signIn.status === 'complete') {
        // Force a fresh login with the new password.
        await signOut({ redirectUrl: '/sign-in?reset=1' });
      } else {
        setError(`Could not complete reset (status: ${signIn.status}).`);
        setSubmitting(false);
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
      setSubmitting(false);
    }
  };

  if (redirecting) {
    return (
      <AuthShell>
        <div className="flex min-h-40 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-muted-foreground" />
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Reset password</h2>
        <p className="text-sm text-muted-foreground">
          {step === 'request'
            ? "Enter your email and we'll send you a one-time code."
            : 'Enter the code we emailed you and choose a new password.'}
        </p>
      </div>

      {step === 'request' ? (
        <form onSubmit={requestCode} className="mt-8 space-y-5">
          {error && <AuthNotice variant="error">{error}</AuthNotice>}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@company.com"
              className="h-11"
            />
          </div>
          <Button type="submit" className="h-11 w-full" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Send reset code
          </Button>
          <p className="text-center text-sm">
            <Link
              href="/sign-in"
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </form>
      ) : (
        <form onSubmit={submitReset} className="mt-8 space-y-5">
          {notice && <AuthNotice>{notice}</AuthNotice>}
          {error && <AuthNotice variant="error">{error}</AuthNotice>}
          <div className="space-y-2">
            <Label htmlFor="code">One-time code</Label>
            <Input
              id="code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              className="h-11"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">New password</Label>
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
            <Label htmlFor="confirmPassword">Confirm new password</Label>
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
          <Button type="submit" className="h-11 w-full" disabled={submitting}>
            {submitting && <Loader2 className="size-4 animate-spin" />}
            Set new password
          </Button>
          <p className="text-center text-sm">
            <button
              type="button"
              onClick={() => {
                setStep('request');
                setError(null);
                setNotice(null);
              }}
              className="text-muted-foreground underline-offset-4 hover:underline"
            >
              Use a different email
            </button>
          </p>
        </form>
      )}
    </AuthShell>
  );
}
