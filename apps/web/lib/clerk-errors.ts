/** True if a Clerk error is about an invalid/expired/already-used invitation ticket. */
export function isInvitationTicketError(err: unknown): boolean {
  const e = err as { errors?: Array<{ code?: string }> };
  const code = e?.errors?.[0]?.code ?? '';
  return /ticket|invitation/i.test(code);
}

/** Extract the human-readable message from a Clerk error (or any thrown value). */
export function clerkErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const e = err as {
      errors?: Array<{ longMessage?: string; message?: string }>;
      message?: string;
    };
    return (
      e.errors?.[0]?.longMessage ??
      e.errors?.[0]?.message ??
      e.message ??
      'Something went wrong. Please try again.'
    );
  }
  return 'Something went wrong. Please try again.';
}
