import type { ComponentChildren, JSX } from "preact";
import { useEffect, useState } from "preact/hooks";

type ImgProps = Omit<
  JSX.ImgHTMLAttributes<HTMLImageElement>,
  "src" | "onError"
>;

/**
 * An uploaded theme image (launcher icon, header logo, avatars, brand logo)
 * that falls back to the widget's own default when the file fails to load,
 * for example after it was deleted from storage. Without this the browser's
 * broken-image icon shows, and on the launcher that is the only way to open
 * the chat. A new `src` gets a fresh attempt.
 */
export function FallbackImage({
  src,
  fallback,
  ...img
}: ImgProps & { src: string; fallback: ComponentChildren }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) return <>{fallback}</>;
  return <img {...img} src={src} onError={() => setFailed(true)} />;
}
