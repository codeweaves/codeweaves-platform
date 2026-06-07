'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth } from '@/hooks/use-auth';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { apiUrl } from '@/config/api';

interface InvitationData {
  email: string;
  organizationId: string;
  role: string;
}

interface ValidationError {
  message: string;
  reissueToken?: string;
}

type PageState =
  | { status: 'loading' }
  | { status: 'no-token' }
  | { status: 'valid'; invitation: InvitationData }
  | { status: 'error'; error: ValidationError };

export function InvitationContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const [state, setState] = useState<PageState>({ status: 'loading' });

  const token = searchParams.get('token');

  useEffect(() => {
    if (authLoading) return;

    if (isAuthenticated) {
      router.push('/dashboard');
      return;
    }

    if (!token) {
      setState({ status: 'no-token' });
      return;
    }

    const controller = new AbortController();

    fetch(apiUrl(`/invitations/validate/${encodeURIComponent(token)}`), {
      signal: controller.signal,
    })
      .then(async (res) => {
        const data = await res.json();
        if (!res.ok) {
          setState({
            status: 'error',
            error: {
              message: data.message || 'Invalid invitation',
              reissueToken: data.reissueToken,
            },
          });
        } else {
          setState({ status: 'valid', invitation: data });
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setState({
            status: 'error',
            error: { message: 'Failed to validate invitation. Please try again.' },
          });
        }
      });

    return () => controller.abort();
  }, [token, isAuthenticated, authLoading, router]);

  const handleLogin = () => {
    router.push('/sign-in');
  };

  if (authLoading || state.status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <div className="text-center">
          <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-4 text-muted-foreground">Validating invitation...</p>
        </div>
      </div>
    );
  }

  if (state.status === 'no-token') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Invitation Only</CardTitle>
            <CardDescription>
              Registration is by invitation only. If you received an invitation,
              please check your email for the setup link.
            </CardDescription>
          </CardHeader>
          <CardFooter>
            <Button
              variant="outline"
              className="w-full"
              onClick={() => router.push('/sign-in')}
            >
              Go to Sign In
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">Invitation Error</CardTitle>
            <CardDescription>{state.error.message}</CardDescription>
          </CardHeader>
          {state.error.reissueToken && (
            <CardFooter>
              <Button
                variant="outline"
                className="w-full"
                onClick={() =>
                  router.push(
                    `/reissue-invitation?token=${encodeURIComponent(state.error.reissueToken!)}`
                  )
                }
              >
                Request New Invitation
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    );
  }

  const roleLabel = state.invitation.role.replaceAll('_', ' ').toLowerCase();

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-2xl">Welcome to Klivo</CardTitle>
          <CardDescription>
            You&apos;ve been invited to join as a{' '}
            <span className="font-medium text-foreground">{roleLabel}</span>.
            Please check your email for the password setup link, or log in if
            you&apos;ve already set your password.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Email: <span className="font-medium text-foreground">{state.invitation.email}</span>
          </p>
        </CardContent>
        <CardFooter>
          <Button className="w-full" size="lg" onClick={handleLogin}>
            Log In
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
