interface TriggerButtonProps {
  onClick: () => void;
}

/** Floating trigger button — opens the chat widget */
export function TriggerButton({ onClick }: TriggerButtonProps) {
  return (
    <button
      class="cw-trigger-button"
      onClick={onClick}
      aria-label="Open chat"
    >
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      </svg>
    </button>
  );
}
