# Profile settings

A signed-in user changes their display name and starts a password reset. Email, roles and organization are shown read-only.

## Sub-features

- `profile-name`: edit `Name` and click `Save Changes`. It persists to the user record.
- `profile-readonly`: Email (managed by Clerk), Roles and Organization are disabled.
- `profile-reset-password`: `Reset Password` opens a confirm dialog, signs out, then opens `/reset-password`.

## How to get to it (user POV)

- Header `Account menu` > `Profile Settings`. The page title reads "Settings".

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Use the `teammate` user so a failed restore never renames the owner.

- **Open.** Run `cw-verify browser goto http://localhost:3000/dashboard/profile-settings`, then `browser settle`. The snapshot shows `textbox "Name"`, disabled `textbox "Email"`, two unnamed disabled textboxes (Roles, Organization), `button "Save Changes" [disabled]`, and `button "Reset Password"`.
- **Save.** Run `browser fill --role textbox --name "Name" --value "Verify Teammate Renamed"`, then `browser click --role button --name "Save Changes"`, then `browser wait --text "Profile updated"`.
- **Persistence.** Reload with `browser goto` on the same URL and read the field: `browser eval --js "document.querySelector('input[placeholder=\"Enter your name\"]')?.value"`. Cross-check with `cw-verify db query "select name from users where id = '<users.teammate.id from .verify/state.json>'"`.
- **Restore.** Fill `Verify Teammate` and save again.
- **Reset password.** Click `Reset Password`. The alertdialog "Reset your password?" has `Cancel` and `Sign out and continue`. Continue only when running [sign-in.md](./sign-in.md) reset, then run `cw-verify seed` to restore.
- **Proof.** Save a screenshot and an ARIA snapshot under `.verify/artifacts/profile-settings/`.

## Gotchas

- The name is not synced to Clerk. The account menu shows the database name.
- `Save Changes` stays disabled until the trimmed name differs from the saved one.
- The server strips `<` and `>` and caps the name at 100 characters.
- Roles and Organization have no accessible name (open finding F-04). Do not target them by name.
