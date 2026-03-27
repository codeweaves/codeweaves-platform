import { useState, useEffect, useRef } from 'preact/hooks';
import { showStarters } from '../state/chat-store';

const FADE_OUT_MS = 150;

export interface StarterItem {
  message: string;
}

export interface ConversationStartersProps {
  /** Array of starter items (max 4 rendered) */
  starters: StarterItem[];
  /** Called when user clicks a starter */
  onSelect: (message: string) => void;
}

/**
 * Renders up to 4 conversation starter pill buttons.
 * Reads visibility from the centralized store's showStarters signal (Story 5-21).
 * Fades out and unmounts when showStarters becomes false.
 */
export function ConversationStarters({
  starters,
  onSelect,
}: ConversationStartersProps) {
  const visible = showStarters.value;

  const [mounted, setMounted] = useState(true);
  const fadingRef = useRef(false);
  const fadeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [fading, setFading] = useState(false);

  // Handle fade-out when visible becomes false
  useEffect(() => {
    if (!visible && !fadingRef.current) {
      fadingRef.current = true;
      setFading(true);
      fadeTimerRef.current = setTimeout(() => {
        fadeTimerRef.current = null;
        setMounted(false);
      }, FADE_OUT_MS);
    }
  }, [visible]);

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (fadeTimerRef.current !== null) {
        clearTimeout(fadeTimerRef.current);
        fadeTimerRef.current = null;
      }
    };
  }, []);

  if (!mounted) return null;

  // Render up to 4 starters
  const items = starters.slice(0, 4);

  if (items.length === 0) return null;

  const containerClass = fading
    ? 'cw-starters cw-starters-fade-out'
    : 'cw-starters';

  return (
    <div
      class={containerClass}
      aria-hidden={fading ? 'true' : undefined}
    >
      {items.map((item) => (
        <button
          key={item.message}
          type="button"
          class="cw-starter-btn"
          onClick={() => onSelect(item.message)}
        >
          <span class="cw-starter-text">{item.message}</span>
        </button>
      ))}
    </div>
  );
}
