/** Component CSS strings — minimal stubs, expanded in later stories */
export const componentCSS = `
.cw-widget-root {
  pointer-events: none;
}

.cw-widget {
  font-family: var(--cw-font-family, Inter, system-ui, sans-serif);
  font-size: var(--cw-font-size, 14px);
  line-height: var(--cw-line-height, 1.5);
  color: var(--cw-foreground, #1f2937);
  position: fixed;
  bottom: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-bottom, 0px));
  right: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-right, 0px));
  z-index: var(--cw-z-index, 2147483000);
}

.cw-widget[data-position="left"] {
  right: auto;
  left: calc(var(--cw-trigger-offset, 24px) + env(safe-area-inset-left, 0px));
}

/* ── Trigger Button ────────────────────────────────────────────────── */

.cw-trigger-button {
  pointer-events: auto;
  width: var(--cw-trigger-size, 64px);
  height: var(--cw-trigger-size, 64px);
  border-radius: var(--cw-trigger-radius, 50%);
  border: none;
  cursor: pointer;
  background: var(--cw-trigger-bg, #3b82f6);
  color: var(--cw-trigger-fg, #ffffff);
  box-shadow: var(--cw-trigger-shadow, 0 4px 12px rgba(0, 0, 0, 0.15));
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: transform 150ms ease;
  outline: none;
}

.cw-trigger-button:hover {
  transform: scale(1.1);
}

.cw-trigger-button:focus-visible {
  outline: 2px solid var(--cw-primary, #3b82f6);
  outline-offset: 2px;
}

.cw-trigger-button:active {
  transform: scale(0.95);
}

/* Custom icon image */
.cw-trigger-custom-icon {
  width: 60%;
  height: 60%;
  border-radius: 50%;
  object-fit: cover;
  pointer-events: none;
}

/* Default SVG icon */
.cw-trigger-icon {
  pointer-events: none;
}

/* Optional pulse animation */
.cw-trigger-pulse {
  animation: cw-pulse 2s ease-in-out infinite;
}

@keyframes cw-pulse {
  0% { transform: scale(1); }
  50% { transform: scale(1.05); }
  100% { transform: scale(1); }
}

.cw-trigger-pulse:hover {
  animation: none;
  transform: scale(1.1);
}

/* ── Chat Window ───────────────────────────────────────────────────── */

.cw-chat-window {
  pointer-events: auto;
  width: var(--cw-chat-width, 380px);
  height: var(--cw-chat-height, 520px);
  max-height: var(--cw-chat-max-height, 80vh);
  background: var(--cw-background, #ffffff);
  border-radius: var(--cw-chat-radius, 12px);
  border: 1px solid var(--cw-border, #e5e7eb);
  box-shadow: 0 8px 30px rgba(0, 0, 0, 0.2);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  overscroll-behavior: contain;
  position: absolute;
  bottom: calc(var(--cw-trigger-size, 64px) + 12px);
  right: 0;
}

/* Height transition only for minimize/expand toggle — avoids animating keyboard/resize changes */
.cw-chat-window--minimized,
.cw-chat-window--expanding {
  transition: height 300ms ease;
}

/* Minimized state — header-only view (AC #1) */
.cw-chat-window--minimized {
  height: 80px;
  max-height: 80px;
}

/* Chat body wrapper — hidden in minimized state via overflow on parent */
.cw-chat-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  overflow: hidden;
}

.cw-widget[data-position="left"] .cw-chat-window {
  right: auto;
  left: 0;
}

/* Open animation */
@keyframes cw-chat-open {
  from {
    opacity: 0;
    transform: scale(0.5);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

.cw-chat-opening {
  animation: cw-chat-open 300ms ease-out forwards;
}

.cw-chat-open {
  opacity: 1;
  transform: scale(1);
}

/* Mobile fullscreen (<480px) */
@media (max-width: 479px) {
  .cw-chat-window.cw-chat-mobile {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100svh;
    max-height: none;
    border-radius: 0;
    padding-top: env(safe-area-inset-top, 0px);
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Minimized on mobile: not fullscreen, positioned at bottom */
  .cw-chat-window.cw-chat-mobile.cw-chat-window--minimized {
    position: absolute;
    top: auto;
    bottom: calc(var(--cw-trigger-size, 64px) + 12px);
    width: var(--cw-chat-width, 380px);
    max-width: calc(100vw - 16px);
    height: 80px;
    max-height: 80px;
    border-radius: var(--cw-chat-radius, 12px);
    padding-top: 0;
    padding-bottom: 0;
  }
}

/* Reduced motion: disable height transition */
@media (prefers-reduced-motion: reduce) {
  .cw-chat-window--minimized,
  .cw-chat-window--expanding {
    transition: none;
  }
}

/* ── Chat Header ──────────────────────────────────────────────────── */

.cw-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: var(--cw-header-height, 56px);
  min-height: var(--cw-header-height, 56px);
  padding: 0 12px;
  background: var(--cw-header-bg, #3b82f6);
  color: var(--cw-header-fg, #ffffff);
  border-radius: var(--cw-chat-radius, 12px) var(--cw-chat-radius, 12px) 0 0;
  flex-shrink: 0;
}

/* When minimized, header gets full border-radius */
.cw-chat-window--minimized .cw-chat-header {
  border-radius: var(--cw-chat-radius, 12px);
}

@media (max-width: 479px) {
  .cw-chat-mobile .cw-chat-header {
    border-radius: 0;
  }
}

.cw-header-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.cw-header-logo {
  max-height: 32px;
  width: auto;
  border-radius: 4px;
  object-fit: contain;
  flex-shrink: 0;
}

.cw-header-avatar {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.2);
  color: inherit;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 14px;
  flex-shrink: 0;
}

.cw-header-text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.cw-header-name {
  font-weight: 600;
  font-size: 15px;
  line-height: 1.2;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cw-header-subtitle {
  font-size: 12px;
  line-height: 1.2;
  opacity: 0.85;
  color: var(--cw-header-subtitle, #e0e7ff);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.cw-header-actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-shrink: 0;
  margin-left: 8px;
}

.cw-header-btn {
  pointer-events: auto;
  width: 32px;
  height: 32px;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  transition: background 150ms ease;
  opacity: 0.8;
}

.cw-header-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  opacity: 1;
}

.cw-header-btn:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.6);
  outline-offset: -2px;
  opacity: 1;
}

/* ── Message Area ─────────────────────────────────────────────────── */

.cw-message-area {
  flex: 1;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-overflow-scrolling: touch;
  background: var(--cw-chat-bg, var(--cw-body-bg, var(--cw-background, #ffffff)));
  padding: 16px;
}

.cw-message-area-inner {
  min-height: 100%;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

/* ── Message Bubbles ──────────────────────────────────────────────── */

.cw-msg {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  max-width: 100%;
}

.cw-msg-user {
  flex-direction: row-reverse;
}

.cw-msg-bot {
  flex-direction: row;
}

/* Avatar */
.cw-msg-avatar {
  width: 32px;
  height: 32px;
  min-width: 32px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 13px;
  font-weight: 600;
  flex-shrink: 0;
}

.cw-msg-avatar-square {
  border-radius: 6px;
}

.cw-msg-avatar-img {
  width: 100%;
  height: 100%;
  border-radius: inherit;
  object-fit: cover;
}

.cw-msg-bot .cw-msg-avatar {
  background: var(--cw-avatar-bot-bg, #e0e7ff);
  color: var(--cw-avatar-bot-color, #3b82f6);
}

.cw-msg-user .cw-msg-avatar {
  background: var(--cw-avatar-user-bg, #dbeafe);
  color: var(--cw-avatar-user-color, #3b82f6);
}

/* Content wrapper */
.cw-msg-content {
  max-width: 80%;
  min-width: 0;
  overflow: hidden;
}

.cw-msg-user .cw-msg-content {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
}

/* Bubble */
.cw-msg-bubble {
  padding: 10px 14px;
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
  line-height: 1.45;
}

.cw-msg-user .cw-msg-bubble {
  background: var(--cw-msg-user-bg, #3b82f6);
  color: var(--cw-msg-user-fg, var(--cw-msg-user-text, #ffffff));
  border-radius: var(--cw-msg-user-radius, 16px) var(--cw-msg-user-radius, 16px) 4px var(--cw-msg-user-radius, 16px);
}

.cw-msg-bot .cw-msg-bubble {
  background: var(--cw-msg-bot-bg, #f3f4f6);
  color: var(--cw-msg-bot-fg, var(--cw-msg-bot-text, #1f2937));
  border-radius: var(--cw-msg-bot-radius, 16px) var(--cw-msg-bot-radius, 16px) var(--cw-msg-bot-radius, 16px) 4px;
}

/* Message text — explicit resets for host page inheritance */
.cw-msg-text {
  word-break: break-word;
  overflow-wrap: break-word;
  white-space: pre-wrap;
}

/* Timestamp */
.cw-msg-time {
  display: block;
  margin-top: 4px;
  font-size: 11px;
  color: var(--cw-timestamp-color, #9ca3af);
  line-height: 1;
}

/* Streaming cursor */
.cw-msg-cursor {
  display: inline-block;
  width: 2px;
  height: 1em;
  background: currentColor;
  margin-left: 2px;
  vertical-align: text-bottom;
  animation: cw-cursor-blink 1s step-end infinite;
}

@keyframes cw-cursor-blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}

/* Empty state */
.cw-msg-empty {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--cw-muted-foreground, #64748b);
  font-size: 13px;
}

/* ── Typing Indicator ─────────────────────────────────────────────── */

.cw-typing-bubble {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 12px 16px;
}

.cw-typing-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--cw-msg-bot-fg, var(--cw-msg-bot-text, #1f2937));
  animation: cw-bounce 1.2s infinite;
}

.cw-typing-dot:nth-child(2) {
  animation-delay: 0.15s;
}

.cw-typing-dot:nth-child(3) {
  animation-delay: 0.3s;
}

@keyframes cw-bounce {
  0%, 60%, 100% { transform: translateY(0); }
  30% { transform: translateY(-8px); }
}

@media (prefers-reduced-motion: reduce) {
  .cw-typing-dot {
    animation: none;
    opacity: 0.6;
  }
}

/* ── Chat Input ───────────────────────────────────────────────────── */

.cw-chat-input {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--cw-border, #e5e7eb);
  background: var(--cw-input-bg, #ffffff);
}

.cw-chat-input-field {
  pointer-events: auto;
  flex: 1;
  height: 38px;
  padding: 0 12px;
  border: 1px solid var(--cw-input-border, #e5e7eb);
  border-radius: var(--cw-input-radius, 12px);
  background: var(--cw-input-bg, #ffffff);
  color: var(--cw-input-fg, var(--cw-input-text, #1f2937));
  font-family: inherit;
  font-size: inherit;
  outline: none;
  transition: border-color 150ms ease;
}

.cw-chat-input-field::placeholder {
  color: var(--cw-input-placeholder, #9ca3af);
}

.cw-chat-input-field:focus {
  border-color: var(--cw-primary, #3b82f6);
}

.cw-chat-send-btn {
  pointer-events: auto;
  width: 36px;
  height: 36px;
  border: none;
  border-radius: var(--cw-send-radius, 12px);
  background: var(--cw-send-bg, #3b82f6);
  color: var(--cw-send-icon, #ffffff);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0;
  flex-shrink: 0;
  transition: background 150ms ease;
}

.cw-chat-send-btn:hover:not(:disabled) {
  background: var(--cw-send-hover-bg, #2563eb);
}

.cw-chat-send-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.cw-chat-send-btn:focus-visible {
  outline: 2px solid var(--cw-primary, #3b82f6);
  outline-offset: 2px;
}

/* ── Bubble Notification ───────────────────────────────────────────── */

.cw-bubble-notification {
  pointer-events: auto;
  position: relative;
  background: var(--cw-bubble-bg, #ffffff);
  color: var(--cw-bubble-fg, #1f2937);
  box-shadow: var(--cw-bubble-shadow, 0 4px 16px rgba(0, 0, 0, 0.12));
  border-radius: var(--cw-bubble-radius, var(--cw-border-radius, 0.5rem));
  padding: 10px 32px 10px 14px;
  max-width: 280px;
  margin-bottom: 12px;
  cursor: pointer;
  word-break: break-word;
}

@media (max-width: 320px) {
  .cw-bubble-notification {
    max-width: calc(100vw - 40px);
  }
}

/* Bubble text */
.cw-bubble-text {
  display: -webkit-box;
  -webkit-line-clamp: 4;
  -webkit-box-orient: vertical;
  overflow: hidden;
  text-overflow: ellipsis;
  line-height: 1.4;
  font-size: 13px;
}

/* Close (X) button */
.cw-bubble-close {
  position: absolute;
  top: 4px;
  right: 4px;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--cw-bubble-text, var(--cw-bubble-fg, #1f2937));
  opacity: 0.5;
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  pointer-events: auto;
  transition: opacity 150ms ease;
}

.cw-bubble-close:hover {
  opacity: 1;
}

.cw-bubble-close:focus-visible {
  outline: 2px solid var(--cw-primary, #3b82f6);
  outline-offset: 1px;
  opacity: 1;
}

/* CSS triangle arrow pointing toward trigger button */
.cw-bubble-arrow {
  position: absolute;
  bottom: -6px;
  width: 0;
  height: 0;
  border-left: 6px solid transparent;
  border-right: 6px solid transparent;
  border-top: 6px solid var(--cw-bubble-bg, #ffffff);
  pointer-events: none;
}

/* Right-side trigger (default) — arrow on the right */
.cw-widget[data-position="right"] .cw-bubble-arrow {
  right: 24px;
  left: auto;
}

/* Left-side trigger — arrow on the left */
.cw-widget[data-position="left"] .cw-bubble-arrow {
  left: 24px;
  right: auto;
}

/* Entrance animation: fade-in + slide-up */
@keyframes cw-bubble-in {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.cw-bubble-animate-in {
  animation: cw-bubble-in 200ms ease-out forwards;
}

/* ── Domain Error ────────────────────────────────────────────────── */

.cw-domain-error {
  pointer-events: auto;
  padding: 10px 16px;
  background: var(--cw-background, #ffffff);
  color: var(--cw-foreground, #1f2937);
  border: 1px solid var(--cw-border, #e5e7eb);
  border-radius: 8px;
  font-size: 13px;
  line-height: 1.4;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
  max-width: 260px;
  text-align: center;
}

/* ── Conversation Starters ───────────────────────────────────────── */

.cw-starters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 0 16px 12px;
  opacity: 1;
  transition: opacity 150ms ease;
}

.cw-starters-fade-out {
  opacity: 0;
  pointer-events: none;
}

.cw-starter-btn {
  pointer-events: auto;
  display: inline-flex;
  align-items: center;
  max-width: 100%;
  min-width: 0;
  padding: 6px 14px;
  border: 1px solid var(--cw-primary, #3b82f6);
  border-radius: 9999px;
  background: transparent;
  color: var(--cw-primary, #3b82f6);
  font-family: inherit;
  font-size: 13px;
  line-height: 1.4;
  cursor: pointer;
  transition: background 150ms ease, color 150ms ease;
  outline: none;
}

@media (hover: hover) {
  .cw-starter-btn:hover {
    background: var(--cw-primary, #3b82f6);
    color: #ffffff;
  }
}

.cw-starter-btn:focus-visible {
  outline: 2px solid var(--cw-primary, #3b82f6);
  outline-offset: 2px;
}

.cw-starter-btn:active {
  background: var(--cw-primary, #3b82f6);
  color: #ffffff;
}

.cw-starter-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

/* ── Chat Error Display (Story 5-18) ─────────────────────────────── */

.cw-chat-error {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 6px 12px;
  background: transparent;
}

.cw-chat-error-text {
  flex: 1;
  font-size: 12px;
  line-height: 1.3;
  color: var(--cw-error-text, #ef4444);
}

.cw-chat-error-dismiss {
  pointer-events: auto;
  width: 20px;
  height: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: none;
  background: transparent;
  color: var(--cw-error-text, #ef4444);
  cursor: pointer;
  padding: 0;
  border-radius: 50%;
  font-size: 16px;
  line-height: 1;
  opacity: 0.6;
  flex-shrink: 0;
  transition: opacity 150ms ease;
}

.cw-chat-error-dismiss:hover {
  opacity: 1;
}

.cw-chat-error-dismiss:focus-visible {
  outline: 2px solid var(--cw-error-text, #ef4444);
  outline-offset: 1px;
  opacity: 1;
}

/* Disabled input visual feedback */
.cw-chat-input-field:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
`;
