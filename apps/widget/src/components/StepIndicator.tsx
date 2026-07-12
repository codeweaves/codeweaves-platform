import { Avatar } from './Avatar';
import { getBotAvatarIcon } from './avatar-icons';
import { streamSteps } from '../state/chat-store';

export interface StepIndicatorProps {
  /** Avatar shape — circle, square, or rounded */
  avatarShape: 'circle' | 'square' | 'rounded';
  /** Custom bot avatar image URL */
  botAvatarUrl?: string;
  /** Bot avatar type for icon rendering */
  botAvatarType?: string;
}

/**
 * Live progress steps — shown while the bot searches the knowledge base or
 * calls tools. Replaces the generic typing dots once the first `step` SSE
 * event arrives (upserted into the streamSteps signal by useChat).
 * Active = spinner, done = check, error = muted exclamation.
 */
export function StepIndicator({
  avatarShape,
  botAvatarUrl,
  botAvatarType,
}: StepIndicatorProps) {
  const steps = streamSteps.value;

  if (steps.length === 0) return null;

  const shapeClass =
    avatarShape === 'square'
      ? ' cw-msg-avatar-square'
      : avatarShape === 'rounded'
        ? ' cw-msg-avatar-rounded'
        : '';
  const avatarClass = 'cw-msg-avatar' + shapeClass;
  const avatarIcon = getBotAvatarIcon(botAvatarType);

  return (
    <div class="cw-msg cw-msg-bot" role="status" aria-label="Assistant is working">
      <Avatar imageUrl={botAvatarUrl} letter="A" avatarClass={avatarClass} icon={avatarIcon} />
      <div class="cw-msg-content">
        <div class="cw-msg-bubble cw-step-bubble">
          {steps.map((step) => (
            <div key={step.id} class="cw-step-row">
              {step.status === 'active' ? (
                <span class="cw-step-spinner" aria-hidden="true" />
              ) : step.status === 'done' ? (
                <span class="cw-step-glyph cw-step-glyph-done" aria-hidden="true">
                  ✓
                </span>
              ) : (
                <span class="cw-step-glyph cw-step-glyph-error" aria-hidden="true">
                  !
                </span>
              )}
              <span class="cw-step-label">{step.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
