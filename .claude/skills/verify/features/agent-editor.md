# Agent editor

The editor at `/dashboard/agents/<id>` configures one agent across permission-gated sections, with one manual save, a reset menu, an Active/Inactive switch and a live preview. Agent-level fields and the theme save through different endpoints, and only theme saves change what an already-loaded widget sees.

## Sub-features

- `editor-nav`: left "Configuration" nav of plain buttons. Each section shows only when the user holds its permission.
- `editor-save`: `Save Changes` sends only the changed fields. Toast "Changes saved successfully", or "Failed to save changes" with `Retry`.
- `editor-reset`: `Reset` (to last save), plus an unnamed chevron menu with `Reset to Last Saved` and `Reset to Defaults`. Defaults persists at once, after a confirm.
- `editor-status`: switch `Toggle agent status`, saved immediately. Toasts "Agent deactivated" and "Agent activated".
- `editor-preview`: "Live Preview" renders unsaved form state and gives a canned reply. No LLM call.
- `editor-sections`: covered in [agent-editor-sections.md](./agent-editor-sections.md).

## How to get to it (user POV)

- Agents list > agent name link, or the overview "Your agents" card.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Change only the `editor` agent ("Verify Editor Bot"). Finish with `Reset to Defaults` and `cw-verify seed`.

- **Open.** As `owner`, run `browser goto http://localhost:3000/dashboard/agents/<agents.editor.id>`, then `browser wait --text "Live Preview"`.
- **Nav per role.** Snapshot the nav buttons:
  - `owner`: General, Appearance, Chat Interface, Behavior, Voice, Prompt, Classification, Human Handover, Privacy Notice
  - `superadmin`: all 13, which adds Data Capture, Integration, WhatsApp and Branding
- **Agent-field save.**
  1. `browser click --role button --name "Behavior" --exact`.
  2. `browser fill --css 'textarea[placeholder="Hello! How can I help you today?"]' --value "<text>"`.
  3. `browser click --role button --name "Save Changes"`, then wait for "Changes saved successfully".
  4. Reload the page, reopen Behavior, and read the textarea: the value persists.
  5. `curl .../public/agents/<publicId>/config` returns it as `agent.greeting`.
- **Theme save reaches the widget.**
  1. Open the widget once with `widget open --agent editor --page visitor`.
  2. In `Chat Interface`, the Header tab: `browser fill --role textbox --name "Chat Support" --value "Verify Header Test"`. The name is the placeholder, because the label is not linked. Save.
  3. The config ETag goes up by one. `widget open --agent editor --page visitor` shows `dialog "Verify Header Test chat"`.
- **Status.** `browser click --role switch --name "Toggle agent status"`, then wait for "Agent deactivated". The public config returns 404. Click again and wait for "Agent activated". The config returns 200. `audit_logs` gains `AGENT_STATUS_CHANGED`.
- **Reset to Defaults.**
  1. `browser click --css 'button:has-text("Reset") + button'` (the unnamed chevron).
  2. `--role menuitem --name "Reset to Defaults"`.
  3. Confirm in `alertdialog "Reset theme to defaults?"` with `--css '[role=alertdialog] button:has-text("Reset to Defaults")'`.
  4. Toast "Theme reset to defaults". The ETag goes up. The widget header shows the default "Chat with us".
- **Proof.** Save the editor snapshot, the widget screenshot after the theme save, and the audit query under `.verify/artifacts/agent-editor/`.

## Gotchas

- **Stale widget config (open finding F-07, high).** The public config ETag is only the theme version. Saving an agent-level field (greeting, name, voice on/off, handover toggles) leaves the ETag unchanged. A visitor whose browser cached the config gets 304 and keeps the old values. It showed the old greeting until an unrelated theme save bumped the version. When verifying an agent-field change in the widget, either also change a theme field or clear the host page's `cw_config_<publicId>` and `cw_etag_<publicId>` localStorage keys. Report the stale value, do not hide it.
- The default section is always General, even when the user cannot see the General nav item.
- The header `Back to agents` button leaves without the unsaved-changes warning. Only reload and browser Back warn.
- Save errors are generic: a server 400 or 403 shows only "Failed to save changes".
- Many field labels are not linked to their inputs, so the accessible name is the placeholder. The reset chevron has no name (open finding F-08).
