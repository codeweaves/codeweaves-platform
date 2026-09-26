# Widget privacy notice and consent

With the privacy notice turned on in "Ask for consent" mode, the widget locks chat until the visitor accepts. After accepting, the "Chat options" menu offers the policy link and "Opt out", which clears the chat and locks it again. Each grant and withdrawal is recorded.

## Sub-features

- `consent-lock`: `region "Privacy notice"` replaces the input. It shows the notice text, the policy link and the accept button.
- `consent-grant`: the accept button unlocks the input and records a GRANTED row.
- `consent-menu`: `button "Chat options"` opens `menu "Chat options"`, with the policy link (opens in a new tab) and `Opt out`.
- `consent-withdraw`: `Opt out` clears the conversation, locks the widget again and records a WITHDRAWN row.
- `consent-notice-mode`: "Show a notice only" puts a line above the input instead of locking it.
- `consent-remembered`: a grant is stored per device (`cw_consent_<publicId>`). The same browser is not asked again until the notice text changes.

## How to get to it (user POV)

- Dashboard: agent editor > `Privacy Notice`. Set a policy link that starts with `https://`, turn on `Show the privacy notice`, choose `Ask for consent`, and save.
- Visitor: open the widget.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Change only the `editor` agent. The seed does not turn consent on.

- **Enable (owner).**
  1. Open the editor for `agents.editor.id` and click `Privacy Notice`.
  2. `switch "Show the privacy notice"` is disabled until a link is entered.
  3. `browser fill --role textbox --name "Privacy policy link" --value "https://example.com/privacy"`.
  4. `browser click --role switch --name "Show the privacy notice"`, then `--role radio --name "Ask for consent"`.
  5. Save and wait for "Changes saved successfully". The public config now carries `agent.consentNoticeHash`.
- **Lock.** Run `widget open --agent editor --page visitor`. It reports `consentRequired: true`.
- **Grant.** Run `widget consent --page visitor`, then `widget send --page visitor --text "Say hi in two words."`. Expect `outcome: "replied"`.
- **Menu.** Run `browser click --page visitor --role button --name "Chat options"`. The snapshot shows `menuitem "Privacy Policy (opens in a new tab)"` and `menuitem "Opt out"`.
- **Withdraw.** `browser click --page visitor --role menuitem --name "Opt out"`, then `browser wait --page visitor --role region --name "Privacy notice"`. `widget messages` shows only the local greeting.
- **Records.** Run `db query "select action, method from visitor_consents where \"agentId\" = '<agents.editor.id>' order by \"createdAt\" desc limit 2"`. Expect WITHDRAWN / WIDGET_WITHDRAW_LINK, then GRANTED / WIDGET_BUTTON.
- **Restore.** In the editor, `Reset to Defaults` turns the notice off, because consent lives in the theme.
- **Proof.** Save screenshots under `.verify/artifacts/widget-consent/` of the locked state and the menu, plus the DB rows.

## Gotchas

- The policy link must start with `https://`. The server rejects enabling without it, with only the generic save toast.
- A grant is remembered per browser. Clearing `cw_consent_<publicId>` from localStorage brings the lock back. Clearing all `cw_*` keys to fix stale config also clears consent.
- `Opt out` is disabled while a reply streams, a recording runs, or a handover is active.
- Withdrawing expires the visitor's active sessions (sets `chat_sessions.status` to EXPIRED) when no handover is running.
- Consent mode also hides the voice mic and the handover button until the visitor accepts.
