# Sign-in, sign-out and password reset

A teammate signs in with email and password on a custom Clerk form, returns to the page they asked for, signs out from the account menu, and resets a forgotten password with a one-time code. Sign-up is invitation-only.

## Sub-features

- `signin-gate`: a signed-out visit to any `/dashboard/*` page redirects to `/sign-in?redirect_url=<path>`.
- `signin-password`: the email and password form signs in and returns to `redirect_url`, or to `/dashboard` when there is none.
- `signout`: Account menu > Log Out ends the Clerk session and lands on `/sign-in`.
- `reset-password`: a two-step code flow that ends on `/sign-in?reset=1` with a notice.
- `invite-signup`: `/sign-up?__clerk_ticket=...` from an invitation email. See Gotchas.

## How to get to it (user POV)

- Open any dashboard URL while signed out, or go to `/sign-in`.
- Signed in: header `Account menu` button > `Log Out`.
- `Forgot password?` link on the sign-in form. Also Profile Settings > `Reset Password`, which signs you out first.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Use the `teammate` user for reset: reset changes the password, and `cw-verify seed` restores it.

- **Gate.** Sign out (see below), then run `cw-verify browser goto http://localhost:3000/dashboard/agents`. Run `cw-verify browser eval --js "location.pathname + location.search"`. Expect `/sign-in?redirect_url=%2Fdashboard%2Fagents`. The form shows heading `Welcome back`, textboxes `Email` and `Password`, link `Forgot password?`, and button `Sign in`.
- **Sign in with return.** On that page, run `browser fill --label Email --value <email>`, `browser fill --label Password --value <password> --secret`, then `browser click --role button --name "Sign in"`. Then run `browser wait --url /dashboard/agents`. Credentials are in `.verify/credentials.json` under `users.<role>`.
- **Sign in, fast path.** Run `cw-verify dashboard login --as owner|teammate|superadmin`. It starts signed out, fills the same form, and fails unless Clerk reports the expected email.
- **Sign out.** Run `browser click --role button --name "Account menu"`, then `browser click --role menuitem --name "Log Out"`. Run `browser wait --url /sign-in`. `browser eval --js "window.Clerk?.user?.id ?? 'signed-out'"` returns `signed-out`.
- **Reset password.**
  1. Run `browser goto http://localhost:3000/reset-password` and wait for heading `Reset password`.
  2. Fill `Email` with the teammate email, then click `Send reset code`.
  3. Fill `One-time code` with `424242`. Fill `New password` and `Confirm new password` with the same new value (`--secret`). Click `Set new password`.
  4. Run `browser wait --url reset=1` and `browser wait --text "Your password was updated"`.
  5. **Restore:** run `cw-verify seed`, then `dashboard login --as teammate`.
- **Proof.** Take screenshots under `.verify/artifacts/sign-in/`: the redirect page, the landing page after sign-in, and the reset notice.

## Gotchas

- Clerk dev accepts code `424242` for `+clerk_test` addresses and sends no email. Reset uses Clerk's email, not Resend.
- Reset calls `signOutOfOtherSessions`, so any other browser signed in as the same user is logged out.
- The form has no field for a second factor. If the Clerk dev instance turns on device verification or MFA, sign-in stops at "Could not complete sign-in (status: needs_second_factor)".
- `invite-signup` needs a real invitation ticket, sent from Team (super admin only), and it emails through Resend. Verify it with a `delivered@resend.dev` or `+clerk_test` recipient, or report it as verified-unreachable.
- Git Bash rewrites arguments that start with `/`. Always call `.claude/skills/verify/cw-verify`, never `node ...cw-verify.mjs`, when a flag value starts with `/`.
