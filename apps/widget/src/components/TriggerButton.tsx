import { useState, useEffect, useRef } from 'preact/hooks';

export interface TriggerButtonProps {
  onClick: () => void;
  /** Custom icon image URL — falls back to default SVG on load error */
  iconCustomImage?: string;
  /** Enable subtle pulse animation on the trigger button */
  pulse?: boolean;
}

/** Default inline SVG chat bubble icon — no external asset requests */
function DefaultIcon() {
  return (
    <svg
      class="cw-trigger-icon"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

/** Floating trigger button — opens the chat widget */
export function TriggerButton({ onClick, iconCustomImage, pulse }: TriggerButtonProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset imgFailed when the URL changes
  useEffect(() => {
    setImgFailed(false);
  }, [iconCustomImage]);

  const handleKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };

  const handleImgError = () => {
    if (mountedRef.current) {
      setImgFailed(true);
    }
  };

  const showCustomImage = iconCustomImage && !imgFailed;
  const buttonClass = pulse ? 'cw-trigger-button cw-trigger-pulse' : 'cw-trigger-button';

  return (
    <button
      class={buttonClass}
      onClick={onClick}
      onKeyDown={handleKeyDown}
      aria-label="Open chat"
      role="button"
      tabIndex={0}
    >
      {showCustomImage ? (
        <img
          class="cw-trigger-custom-icon"
          src={iconCustomImage}
          alt=""
          aria-hidden="true"
          onError={handleImgError}
        />
      ) : (
        <DefaultIcon />
      )}
    </button>
  );
}
