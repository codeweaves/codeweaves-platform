'use client';

import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
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

type ReissueState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'success' }
  | { status: 'error'; message: string };

export function ReissueContent() {
  const searchParams = useSearchParams();
  const reissueToken = searchParams.get('token') || '';
  const [state, setState] = useState<ReissueState>(() =>
    reissueToken
      ? { status: 'idle' as const }
      : { status: 'error' as const, message: 'No reissue token found. Please use the link from your original invitation email.' }
  );

  const handleReissue = async () => {
    setState({ status: 'loading' });

    try {
      const res = await fetch(apiUrl('/invitations/reissue'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reissueToken }),
      });

      if (res.ok) {
        setState({ status: 'success' });
      } else {
        const data = await res.json().catch(() => ({}));
        setState({
          status: 'error',
          message: data.message || 'Failed to reissue invitation.',
        });
      }
    } catch {
      setState({
        status: 'error',
        message: 'Network error. Please try again.',
      });
    }
  };

  if (state.status === 'success') {
    return (
      <div className="flex min-h-screen items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="text-xl">New Invitation Sent</CardTitle>
            <CardDescription>
              A new invitation has been sent to your email. Please check your
              inbox and click the link to set your password.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-xl">Request New Invitation</CardTitle>
          <CardDescription>
            Your invitation has expired. Click below to receive a new invitation
            email.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {state.status === 'error' && (
            <p className="text-sm text-destructive">{state.message}</p>
          )}
        </CardContent>
        <CardFooter>
          <Button
            className="w-full"
            onClick={handleReissue}
            disabled={state.status === 'loading' || !reissueToken}
          >
            {state.status === 'loading'
              ? 'Sending...'
              : 'Request New Invitation'}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
