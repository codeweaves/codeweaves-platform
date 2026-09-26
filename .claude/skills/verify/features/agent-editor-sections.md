# Agent editor sections

The sections inside the agent editor. Each writes either agent-level columns (saved with `PATCH /agents/:id`) or the theme (`PUT /agents/:id/theme`, which bumps the config version). Which kind a field is decides whether an already-loaded widget sees the change (open finding F-07). Shell, save, reset and status are in [agent-editor.md](./agent-editor.md).

## Sub-features

- `section-behavior` (agent + theme): Greeting Message, Typing Indicator, Session lifetime, Conversation Starters, Fallback Phrases. Proven: greeting.
- `section-chat-interface` (theme): tabs Header, Avatars, Messages, Typography. Proven: header title.
- `section-privacy-notice` (theme): policy link, on/off, Ask for consent / Show a notice only, texts. Proven.
- `section-human-handover` (agent + theme): takeover, the "Talk to a human" button and its tooltip, messages, email alerts. Proven: takeover, button, tooltip.
- `section-prompt` (agent): System Prompt, and the Knowledge Base as one text blob per agent, pasted or extracted from a file. Proven: file upload, save, used in replies.
- `section-classification` (agent): topic categories (max 24, duplicates rejected ignoring case) and supported languages. Proven: categories.
- `section-appearance` (theme): tabs Chat Icon and Bubble Prompt. Proven: launcher position and bubble color.
- `section-voice` (agent): Enable Voice, STT and TTS providers, voice picker with preview. Proven.
- `section-data-capture`, `section-branding`, `section-integration`, `section-whatsapp`: super admin only for the seeded roles. Not yet driven.

## How to get to it (user POV)

- Agent editor > the section's button in the left "Configuration" nav.

## Driving it with cw-verify

Preconditions:

- Baseline from the index. Change only the `editor` agent. As `owner` unless noted. Save each change with `Save Changes` and wait for "Changes saved successfully".

- **Behavior.** `browser fill --css 'textarea[placeholder="Hello! How can I help you today?"]'` for the greeting. It persists across a reload. The public config returns `agent.greeting`.
- **Chat Interface.** On the Header tab, `browser fill --role textbox --name "Chat Support" --value "<title>"`. The name is the placeholder. The widget dialog becomes `"<title> chat"`.
- **Privacy Notice.** See [widget-consent.md](./widget-consent.md).
- **Human Handover.**
  1. `browser click --role switch --name "Enable human takeover"`. It reveals the message fields and two more switches.
  2. `--role switch --name 'Show "Talk to a human" button'`, then `browser fill --role textbox --name "Button tooltip" --value "Ask our team"`.
  3. The `agents` columns `humanTakeoverEnabled` and `showTalkToHumanButton` turn true. The widget shows `button "Ask our team"` (accept consent first if it is on).
- **Prompt and knowledge.**
  1. `browser upload --css 'input[type=file]' --file .verify/fixtures/faq.txt`, then wait for text "Click Save to apply". The counter shows "26 tokens (est.)" and the filename.
  2. Save. `agent_knowledge` holds `sourceFileName` faq.txt and `contentTokens` 26.
  3. Ask the widget "What are your opening hours?". The reply quotes the file.
- **Classification.**
  1. `browser fill --css 'input[placeholder^="Type a category"]' --value "Billing"`, then `browser press --key Enter`. The chip `Remove category Billing` appears.
  2. Add "billing" into `input[placeholder^="Add another"]`. The text `"billing" is already in the list.` appears.
  3. Save. `agents.categoryKeywords` is `["Billing"]`.
- **Appearance.**
  1. Click `--role button --name "Bottom Left"`, then open tab `Bubble Prompt`. Fill `--role textbox --name "Bubble Background Color" --value "#123456"` and press Tab.
  2. Save. The config theme has `icon.position` left and `bubble.backgroundColor` #123456. The widget launcher renders on the left.
- **Voice.**
  1. The Enable Voice switch has no name. Click it with `--css 'text=Enable Voice >> xpath=following::*[@role="switch"][1]'`.
  2. Open the voice picker with `--css '[role=combobox]:has-text("Use provider default")'` and pick `--role option --name "Aditya male"`.
  3. `Play voice preview` sends `POST /voices/preview` (201).
  4. Save. `agents.voiceEnabled` is true and `voiceConfig` has `ttsProvider` sarvam and `ttsVoiceId` aditya. The widget mic needs a fresh config (see Gotchas).
- **Restore.** Run `Reset to Defaults` in the editor (theme), then `cw-verify seed` (agent fields, knowledge and categories on the editor agent).
- **Proof.** Save a snapshot per section under `.verify/artifacts/agent-editor-sections/`, plus the DB rows and widget screenshots.

## Gotchas

- **Agent-level fields do not reach an already-loaded widget (open finding F-07).** Greeting, name, voice, and the takeover and button switches keep the old ETag. Handover and consent looked immediate here only because the same save also changed theme fields.
- Voice STT and TTS switches, provider pickers, the Enable Bubble switch, and the Greeting and Header labels have no accessible names (open finding F-08). Target them as shown.
- The Integration section on this branch has routing and model fields only. There are no HubSpot, Slack or Salesforce connections.
- WhatsApp connect calls Meta Graph. Without a real phone-number ID and token it is verified-unreachable.
- Branding, Data Capture, Integration and WhatsApp are hidden for the owner. Use `superadmin`.
- Knowledge is saved only on `Save Changes`. Upload alone extracts text into the form.
