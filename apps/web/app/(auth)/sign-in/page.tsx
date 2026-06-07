'use client';

import { useState, useEffect } from 'react';
import { useSignIn, useAuth } from '@clerk/nextjs';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { clerkErrorMessage } from '@/lib/clerk-errors';
import { AuthShell, AuthNotice } from '@/components/features/auth/auth-shell';

/**
 * Custom password sign-in on Clerk Core 3 hooks (`useSignIn`). Invitation-only:
 * no sign-up link (new users arrive via the invitation ticket on /sign-up).
 */
export default function SignInPage() {
  const { signIn } = useSignIn();
  const { isLoaded, isSignedIn } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const redirectUrl = searchParams.get('redirect_url') || '/dashboard';
  const justReset = searchParams.get('reset') === '1';
  const justSignedUp = searchParams.get('welcome') === '1';

  // If a session is already active (a stale tab, or an incomplete logout), don't
  // let the form authenticate over it — route into the app instead. This
  // prevents "typed email A, but the already-active session B wins".
  useEffect(() => {
    if (isLoaded && isSignedIn) {
      router.replace(redirectUrl);
    }
  }, [isLoaded, isSignedIn, router, redirectUrl]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!signIn || submitting) return;

    setError(null);
    setSubmitting(true);
    try {
      const { error: signInError } = await signIn.password({
        emailAddress: email,
        password,
      });
      if (signInError) {
        setError(clerkErrorMessage(signInError));
        setSubmitting(false);
        return;
      }

      if (signIn.status === 'complete') {
        await signIn.finalize({
          navigate: ({ decorateUrl }) => {
            const url = decorateUrl(redirectUrl);
            if (url.startsWith('http')) {
              window.location.href = url;
            } else {
              router.push(url);
            }
          },
        });
      } else {
        setError(`Could not complete sign-in (status: ${signIn.status}).`);
        setSubmitting(false);
      }
    } catch (err) {
      setError(clerkErrorMessage(err));
      setSubmitting(false);
    }
  };

  // Auth state still resolving, or a session is active and we're redirecting:
  // hold the form so it can never authenticate over an existing session.
  if (!isLoaded || isSignedIn) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center justify-center gap-3 py-10 text-center text-muted-foreground">
          <Loader2 className="size-6 animate-spin" />
          <p className="text-sm">Loading…</p>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <div className="space-y-1.5">
        <h2 className="text-2xl font-semibold tracking-tight">Welcome back</h2>
        <p className="text-sm text-muted-foreground">
          Sign in to your Klivo dashboard.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="mt-8 space-y-5">
        {justSignedUp && (
          <AuthNotice>Your account is ready — please sign in.</AuthNotice>
        )}
        {justReset && (
          <AuthNotice>Your password was updated. Please sign in.</AuthNotice>
        )}
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

        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link
              href="/reset-password"
              className="text-xs font-medium text-sidebar-primary underline-offset-4 hover:underline"
            >
              Forgot password?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            className="h-11"
          />
        </div>

        <Button type="submit" className="h-11 w-full" disabled={submitting}>
          {submitting && <Loader2 className="mr-2 size-4 animate-spin" />}
          Sign in
        </Button>
      </form>
    </AuthShell>
  );
}
