import { useState, useEffect } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export interface AvatarProps {
  /** Optional custom image URL */
  imageUrl?: string;
  /** Fallback letter when no image, icon, or image fails to load */
  letter: string;
  /** CSS class string for the avatar container */
  avatarClass: string;
  /** Optional Preact children for SVG icon rendering */
  icon?: ComponentChildren;
}

/** Avatar with optional custom image, SVG icon, or letter fallback */
export function Avatar({ imageUrl, letter, avatarClass, icon }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // Reset imgFailed when imageUrl changes so a new URL gets a fresh attempt
  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

  // Priority: custom image → SVG icon → letter fallback
  if (imageUrl && !imgFailed) {
    return (
      <div class={avatarClass} aria-hidden="true">
        <img
          class="cw-msg-avatar-img"
          src={imageUrl}
          alt=""
          onError={() => setImgFailed(true)}
        />
      </div>
    );
  }

  if (icon) {
    return (
      <div class={avatarClass} aria-hidden="true">
        {icon}
      </div>
    );
  }

  return (
    <div class={avatarClass} aria-hidden="true">
      {letter}
    </div>
  );
}
