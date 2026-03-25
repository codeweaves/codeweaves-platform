/** Component CSS strings — minimal stubs, expanded in later stories */
export const componentCSS = `
.cw-widget {
  font-family: var(--cw-font-family);
  font-size: var(--cw-font-size);
  line-height: var(--cw-line-height);
  color: var(--cw-foreground);
  position: fixed;
  bottom: var(--cw-widget-bottom);
  right: var(--cw-widget-right);
  z-index: var(--cw-z-index);
}

.cw-trigger-button {
  width: var(--cw-trigger-size);
  height: var(--cw-trigger-size);
  border-radius: 50%;
  border: none;
  cursor: pointer;
  background: var(--cw-trigger-bg);
  color: var(--cw-trigger-fg);
  box-shadow: var(--cw-trigger-shadow);
  display: flex;
  align-items: center;
  justify-content: center;
  transition: transform var(--cw-transition-duration) var(--cw-transition-easing);
}

.cw-trigger-button:hover {
  transform: scale(1.05);
}

.cw-chat-window {
  width: var(--cw-widget-width);
  height: var(--cw-widget-height);
  background: var(--cw-background);
  border-radius: var(--cw-border-radius);
  border: 1px solid var(--cw-border);
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.12);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.cw-bubble-notification {
  background: var(--cw-bubble-bg);
  color: var(--cw-bubble-fg);
  box-shadow: var(--cw-bubble-shadow);
  border-radius: var(--cw-border-radius);
  padding: var(--cw-spacing-sm) var(--cw-spacing-md);
  max-width: 280px;
  margin-bottom: var(--cw-spacing-sm);
}
`;
