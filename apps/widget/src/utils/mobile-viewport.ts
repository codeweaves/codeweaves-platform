/**
 * Mobile viewport handling — keyboard tracking + body scroll lock.
 *
 * Layered keyboard tracking (best API first):
 *   1. VirtualKeyboard API (Chromium / Android Chrome) — overlaysContent + geometrychange
 *   2. visualViewport API (iOS Safari, modern browsers) — resize + scroll, debounced
 *   3. focusin/focusout fallback (in-app webviews like Instagram, FB, TikTok)
 *
 * Body scroll lock:
 *   - iOS 16.3+ and other browsers: overflow: hidden on <html> and <body>
 *   - iOS <16.3 fallback: position: fixed; top: -scrollY with restore on cleanup
 *
 * Sets these CSS variables on the host element (read by mobile fullscreen styles):
 *   --cw-keyboard-height   : px height occupied by virtual keyboard (0 when closed)
 *   --cw-viewport-height   : px height of the currently visible viewport
 *   --cw-viewport-offset   : px offset from top to visible area (for pinch-zoom edge cases)
 */

const MOBILE_BREAKPOINT = 480;
const KEYBOARD_NOISE_THRESHOLD = 150;
const DEBOUNCE_MS = 80;
const FOCUSOUT_SETTLE_MS = 200;

export interface MobileViewportControl {
  destroy(): void;
}

interface VirtualKeyboardLike {
  overlaysContent: boolean;
  addEventListener(type: 'geometrychange', listener: () => void): void;
  removeEventListener(type: 'geometrychange', listener: () => void): void;
}

function isMobile(): boolean {
  return window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`).matches;
}

/**
 * Heuristic: WebKit fixed the iOS body-scroll-lock-via-overflow regression in 16.3.
 * On older iOS, fall back to the position:fixed pattern.
 */
function supportsModernScrollLock(): boolean {
  const match = navigator.userAgent.match(/OS (\d+)_(\d+)/);
  if (!match) return true;
  const major = parseInt(match[1] ?? '0', 10);
  const minor = parseInt(match[2] ?? '0', 10);
  return major > 16 || (major === 16 && minor >= 3);
}

function lockBodyScroll(): () => void {
  const body = document.body;
  const html = document.documentElement;

  if (supportsModernScrollLock()) {
    const prevBodyOverflow = body.style.overflow;
    const prevHtmlOverflow = html.style.overflow;
    const prevBodyOverscroll = body.style.overscrollBehavior;
    body.style.overflow = 'hidden';
    html.style.overflow = 'hidden';
    body.style.overscrollBehavior = 'contain';
    return () => {
      body.style.overflow = prevBodyOverflow;
      html.style.overflow = prevHtmlOverflow;
      body.style.overscrollBehavior = prevBodyOverscroll;
    };
  }

  const scrollY = window.scrollY;
  const prev = {
    position: body.style.position,
    top: body.style.top,
    left: body.style.left,
    right: body.style.right,
    width: body.style.width,
    overflow: body.style.overflow,
  };
  body.style.position = 'fixed';
  body.style.top = `-${scrollY}px`;
  body.style.left = '0';
  body.style.right = '0';
  body.style.width = '100%';
  body.style.overflow = 'hidden';
  return () => {
    body.style.position = prev.position;
    body.style.top = prev.top;
    body.style.left = prev.left;
    body.style.right = prev.right;
    body.style.width = prev.width;
    body.style.overflow = prev.overflow;
    window.scrollTo(0, scrollY);
  };
}

function trackKeyboard(host: HTMLElement): () => void {
  let timer: number | undefined;
  let lastKeyboardHeight = -1;

  const apply = (keyboardHeight: number, visibleHeight: number, offsetTop: number) => {
    if (keyboardHeight === lastKeyboardHeight) return;
    lastKeyboardHeight = keyboardHeight;
    host.style.setProperty('--cw-keyboard-height', `${keyboardHeight}px`);
    host.style.setProperty('--cw-viewport-height', `${visibleHeight}px`);
    host.style.setProperty('--cw-viewport-offset', `${offsetTop}px`);
  };

  const cleanup = () => {
    host.style.removeProperty('--cw-keyboard-height');
    host.style.removeProperty('--cw-viewport-height');
    host.style.removeProperty('--cw-viewport-offset');
  };

  const vk = (navigator as Navigator & { virtualKeyboard?: VirtualKeyboardLike }).virtualKeyboard;
  if (vk) {
    vk.overlaysContent = true;
    const update = () => {
      const innerHeight = window.innerHeight;
      const vv = window.visualViewport;
      const visibleHeight = vv?.height ?? innerHeight;
      const offsetTop = vv?.offsetTop ?? 0;
      let keyboardHeight = innerHeight - visibleHeight;
      if (keyboardHeight < KEYBOARD_NOISE_THRESHOLD) keyboardHeight = 0;
      apply(keyboardHeight, visibleHeight, offsetTop);
    };
    const debounced = () => {
      if (timer) clearTimeout(timer);
      timer = window.setTimeout(update, DEBOUNCE_MS);
    };
    vk.addEventListener('geometrychange', debounced);
    update();
    return () => {
      vk.removeEventListener('geometrychange', debounced);
      if (timer) clearTimeout(timer);
      vk.overlaysContent = false;
      cleanup();
    };
  }

  const vv = window.visualViewport;
  if (!vv) {
    apply(0, window.innerHeight, 0);
    return cleanup;
  }

  const update = () => {
    const innerHeight = window.innerHeight;
    let keyboardHeight = innerHeight - vv.height;
    // iOS 26 regression: visualViewport.height can lag innerHeight even with no keyboard.
    if (keyboardHeight < KEYBOARD_NOISE_THRESHOLD) keyboardHeight = 0;
    apply(keyboardHeight, vv.height, vv.offsetTop);
  };

  const debounced = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(update, DEBOUNCE_MS);
  };

  // Some in-app webviews don't fire visualViewport events on focus changes.
  // Re-read after focusin/focusout as a third safety net.
  const onFocusIn = () => debounced();
  const onFocusOut = () => {
    if (timer) clearTimeout(timer);
    timer = window.setTimeout(update, FOCUSOUT_SETTLE_MS);
  };

  vv.addEventListener('resize', debounced);
  vv.addEventListener('scroll', debounced);
  document.addEventListener('focusin', onFocusIn);
  document.addEventListener('focusout', onFocusOut);
  update();

  return () => {
    vv.removeEventListener('resize', debounced);
    vv.removeEventListener('scroll', debounced);
    document.removeEventListener('focusin', onFocusIn);
    document.removeEventListener('focusout', onFocusOut);
    if (timer) clearTimeout(timer);
    cleanup();
  };
}

function warnIfTransformedAncestor(host: HTMLElement): void {
  let el: HTMLElement | null = host.parentElement;
  while (el && el !== document.documentElement) {
    const s = window.getComputedStyle(el);
    if (
      s.transform !== 'none' ||
      s.filter !== 'none' ||
      s.perspective !== 'none' ||
      s.willChange.includes('transform') ||
      s.contain.includes('paint') ||
      s.contain.includes('layout')
    ) {
      console.warn(
        `[CodeWeaves] Host ancestor <${el.tagName.toLowerCase()}> has transform/filter/contain — ` +
          `position: fixed will anchor to it instead of the viewport. Mobile fullscreen may misposition.`,
      );
      return;
    }
    el = el.parentElement;
  }
}

/**
 * Activate mobile viewport handling (body scroll lock + keyboard tracking).
 * No-op on viewports wider than the mobile breakpoint.
 * Always call destroy() on cleanup, even on non-mobile (returns a noop in that case).
 */
export function setupMobileViewport(host: HTMLElement): MobileViewportControl {
  if (!isMobile()) return { destroy: () => {} };

  warnIfTransformedAncestor(host);
  const releaseScroll = lockBodyScroll();
  const releaseKeyboard = trackKeyboard(host);

  return {
    destroy() {
      releaseKeyboard();
      releaseScroll();
    },
  };
}
