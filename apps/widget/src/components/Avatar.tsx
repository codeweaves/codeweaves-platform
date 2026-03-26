import { useState, useEffect } from 'preact/hooks';

export interface AvatarProps {
  /** Optional custom image URL */
  imageUrl?: string;
  /** Fallback letter when no image or image fails to load */
  letter: string;
  /** CSS class string for the avatar container */
  avatarClass: string;
}

/** Avatar with optional custom image, falling back to letter */
export function Avatar({ imageUrl, letter, avatarClass }: AvatarProps) {
  const [imgFailed, setImgFailed] = useState(false);

  // Reset imgFailed when imageUrl changes so a new URL gets a fresh attempt
  useEffect(() => {
    setImgFailed(false);
  }, [imageUrl]);

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

  return (
    <div class={avatarClass} aria-hidden="true">
      {letter}
    </div>
  );
}
