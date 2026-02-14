# Story 1.7: Implement Invitation Acceptance Flow

Status: done

## Story

As an **invited user**,
I want to accept my invitation and create an account,
So that I can access the platform.

## Acceptance Criteria

1. **Given** I received an invitation email
   **When** I click the invitation link
   **Then** I'm directed to Auth0 signup with pre-filled email

2. **And** after Auth0 signup, invitation is marked as accepted

3. **And** my user record is created with assigned role

4. **And** I'm redirected to the dashboard

5. **And** expired invitations show appropriate error

## Tasks / Subtasks

- [x] Task 1: Create invitation validation endpoint (AC: 1, 5)
  - [x] GET `/api/invitations/validate/:token` - Validate invitation
  - [x] Return invitation details if valid
  - [x] Return error if expired or already used
  - [x] Public endpoint (no auth required)

- [x] Task 2: Create signup page in dashboard (AC: 1)
  - [x] Create `/signup` page in Next.js
  - [x] Extract token from URL query params
  - [x] Validate token with API
  - [x] Show error if invalid/expired
  - [x] Redirect to Auth0 signup with email hint

- [x] Task 3: Configure Auth0 signup flow (AC: 1)
  - [x] Pass email as login_hint to Auth0
  - [x] Configure redirect back to dashboard
  - [x] Handle Auth0 callback

- [x] Task 4: Handle post-signup flow (AC: 2, 3, 4)
  - [x] Auth0 callback redirects to dashboard
  - [x] User sync interceptor creates user (Story 1.5)
  - [x] Invitation marked as accepted
  - [x] User lands on dashboard home

- [x] Task 5: Create invitation expired page (AC: 5)
  - [x] Show user-friendly error message
  - [x] Provide option to request new invitation
  - [x] Show reissue form with reissue token

- [x] Task 6: Test complete flow
  - [x] Test valid invitation → signup → dashboard
  - [x] Test expired invitation shows error
  - [x] Test already-used invitation shows error
  - [x] Test invalid token shows error

## Dev Notes

### Invitation Validation Endpoint

```typescript
// apps/api/src/invitations/invitations.controller.ts

@Get('validate/:token')
@Public()
@ApiOperation({ summary: 'Validate invitation token' })
async validate(@Param('token') token: string) {
  return this.invitationsService.validate(token);
}

// In service:
async validate(token: string) {
  const invitation = await this.prisma.userInvitation.findUnique({
    where: { token },
  });

  if (!invitation) {
    throw new NotFoundException('Invalid invitation token');
  }

  if (invitation.status === InvitationStatus.ACCEPTED) {
    throw new BadRequestException('Invitation has already been used');
  }

  if (invitation.expiresAt < new Date()) {
    throw new BadRequestException({
      message: 'Invitation has expired',
      reissueToken: invitation.reissueToken,
    });
  }

  return {
    email: invitation.email,
    organizationId: invitation.organizationId,
    role: invitation.role,
  };
}
```

### Signup Page (Next.js)

```typescript
// apps/web/app/signup/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import { useAuth0 } from '@auth0/auth0-react';

export default function SignupPage() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const { loginWithRedirect, isAuthenticated } = useAuth0();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [invitation, setInvitation] = useState<any>(null);

  const token = searchParams.get('token');

  useEffect(() => {
    if (isAuthenticated) {
      router.push('/dashboard');
      return;
    }

    if (!token) {
      setError('No invitation token provided');
      setLoading(false);
      return;
    }

    // Validate invitation
    fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/invitations/validate/${token}`)
      .then(res => res.json())
      .then(data => {
        if (data.error) {
          setError(data.message);
          if (data.reissueToken) {
            // Store for reissue flow
            localStorage.setItem('reissueToken', data.reissueToken);
          }
        } else {
          setInvitation(data);
        }
        setLoading(false);
      })
      .catch(() => {
        setError('Failed to validate invitation');
        setLoading(false);
      });
  }, [token, isAuthenticated, router]);

  const handleSignup = () => {
    loginWithRedirect({
      authorizationParams: {
        screen_hint: 'signup',
        login_hint: invitation.email,
      },
      appState: {
        returnTo: '/dashboard',
        invitationToken: token,
      },
    });
  };

  if (loading) {
    return <div>Validating invitation...</div>;
  }

  if (error) {
    return (
      <div className="error-page">
        <h1>Invitation Error</h1>
        <p>{error}</p>
        {localStorage.getItem('reissueToken') && (
          <button onClick={() => router.push('/reissue-invitation')}>
            Request New Invitation
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="signup-page">
      <h1>Welcome to CodeWeaves</h1>
      <p>You've been invited to join as a {invitation.role}.</p>
      <p>Email: {invitation.email}</p>
      <button onClick={handleSignup}>
        Create Your Account
      </button>
    </div>
  );
}
```

### Auth0 Callback Handling

```typescript
// apps/web/app/callback/page.tsx
'use client';

import { useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
import { useRouter } from 'next/navigation';

export default function CallbackPage() {
  const { isAuthenticated, isLoading, error } = useAuth0();
  const router = useRouter();

  useEffect(() => {
    if (!isLoading && isAuthenticated) {
      // User sync happens automatically on first API call
      router.push('/dashboard');
    }
  }, [isLoading, isAuthenticated, router]);

  if (isLoading) {
    return <div>Processing login...</div>;
  }

  if (error) {
    return <div>Login error: {error.message}</div>;
  }

  return <div>Redirecting...</div>;
}
```

### Reissue Invitation Page

```typescript
// apps/web/app/reissue-invitation/page.tsx
'use client';

import { useState } from 'react';

export default function ReissueInvitationPage() {
  const [reissueToken, setReissueToken] = useState(
    localStorage.getItem('reissueToken') || ''
  );
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleReissue = async () => {
    setStatus('loading');
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/invitations/reissue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reissueToken }),
      });
      const data = await res.json();

      if (res.ok) {
        setStatus('success');
        setMessage('New invitation sent! Check your email.');
        localStorage.removeItem('reissueToken');
      } else {
        setStatus('error');
        setMessage(data.message);
      }
    } catch {
      setStatus('error');
      setMessage('Failed to reissue invitation');
    }
  };

  return (
    <div className="reissue-page">
      <h1>Request New Invitation</h1>
      <p>Enter your reissue token to receive a new invitation email.</p>

      <input
        type="text"
        value={reissueToken}
        onChange={(e) => setReissueToken(e.target.value)}
        placeholder="Reissue Token"
      />

      <button onClick={handleReissue} disabled={status === 'loading'}>
        {status === 'loading' ? 'Processing...' : 'Request New Invitation'}
      </button>

      {message && <p className={status}>{message}</p>}
    </div>
  );
}
```

### Flow Diagram

```
┌─────────────────┐
│ Invitation Email│
│   (with token)  │
└────────┬────────┘
         │
         ▼
┌─────────────────┐
│  /signup?token= │
│  Validate Token │
└────────┬────────┘
         │
    ┌────┴────┐
    │         │
    ▼         ▼
┌───────┐ ┌───────────┐
│ Valid │ │ Invalid/  │
│       │ │ Expired   │
└───┬───┘ └─────┬─────┘
    │           │
    ▼           ▼
┌───────────┐ ┌─────────────┐
│ Auth0     │ │ Error Page  │
│ Signup    │ │ + Reissue   │
└─────┬─────┘ └─────────────┘
      │
      ▼
┌───────────┐
│ /callback │
│ Auth0     │
└─────┬─────┘
      │
      ▼
┌───────────────────┐
│ First API Call    │
│ → User Sync       │
│ → Invitation      │
│   Accepted        │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐
│    Dashboard      │
└───────────────────┘
```

### Architecture Compliance

- **FR2:** Users can sign up using email/password after invitation
- **FR5:** Reissue expired invitations (up to 5 attempts)
- **ADR-005:** Auth0 for Authentication

### Testing Requirements

```typescript
describe('Invitation Acceptance Flow', () => {
  it('should validate valid invitation token', async () => {
    const invitation = await createTestInvitation();

    const response = await request(app.getHttpServer())
      .get(`/api/invitations/validate/${invitation.token}`)
      .expect(200);

    expect(response.body.email).toBe(invitation.email);
  });

  it('should reject expired invitation', async () => {
    const invitation = await createExpiredInvitation();

    const response = await request(app.getHttpServer())
      .get(`/api/invitations/validate/${invitation.token}`)
      .expect(400);

    expect(response.body.message).toContain('expired');
    expect(response.body.reissueToken).toBeDefined();
  });

  it('should reject already-used invitation', async () => {
    const invitation = await createAcceptedInvitation();

    const response = await request(app.getHttpServer())
      .get(`/api/invitations/validate/${invitation.token}`)
      .expect(400);

    expect(response.body.message).toContain('already been used');
  });
});
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-1.7]
- [Auth0 Signup: https://auth0.com/docs/authenticate/login/auth0-universal-login/new-experience#signup]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Completion Notes List

### File List

Files to create:
- `apps/web/app/signup/page.tsx`
- `apps/web/app/callback/page.tsx`
- `apps/web/app/reissue-invitation/page.tsx`

Files to modify:
- `apps/api/src/invitations/invitations.controller.ts` (add validate endpoint)
- `apps/api/src/invitations/invitations.service.ts` (add validate method)
