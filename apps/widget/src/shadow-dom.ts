/**
 * Shadow DOM initialization for CodeWeaves chat widget.
 *
 * Creates an isolated shadow DOM environment with:
 * - Closed mode shadow root (external scripts cannot access internals)
 * - Constructable stylesheets (CSP-safe, no inline <style> tags)
 * - MutationObserver protection against host element tampering
 * - Pointer-events pass-through for non-interactive areas
 * - iOS keyboard handling via VisualViewport API
 * - Mobile scroll locking
 * - SPA-safe destroy() cleanup
 */

import { render } from 'preact';
import type { ComponentChild } from 'preact';
import { resetCSS } from './styles/reset';
import { themeCSS } from './styles/theme';
import { componentCSS } from './styles/components';
import tailwindCSS from './styles/tailwind.css?inline';

// ── Constants ──────────────────────────────────────────────────────────

const HOST_ID = 'codeweaves-widget-host';
const MOUNT_CLASS = 'cw-widget-root';
const MOBILE_BREAKPOINT = 480;
const FONT_LOAD_TIMEOUT_MS = 3000;
const MAX_REAPPENDS = 5;
const REAPPEND_RESET_MS = 5000;
const SYSTEM_FONT_STACK =
  "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";

/**
 * Critical inline styles applied to the host element with !important.
 * These resist override by host page CSS and are re-applied by MutationObserver.
 */
const CRITICAL_STYLES = [
  'position: fixed !important',
  'z-index: 2147483647 !important',
  'top: 0 !important',
  'left: 0 !important',
  'right: 0 !important',
  'bottom: 0 !important',
  'width: 100% !important',
  'height: 100% !important',
  'margin: 0 !important',
  'padding: 0 !important',
  'border: none !important',
  'background: transparent !important',
  'pointer-events: none !important',
  'isolation: isolate !important',
  'transform: none !important',
  'opacity: 0 !important',
  'transition: opacity 0.2s ease-in !important',
  'overflow: visible !important',
  'display: block !important',
  'visibility: visible !important',
  'font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important',
  'font-size: 14px !important',
  'font-weight: 400 !important',
  'font-style: normal !important',
  'line-height: 1.5 !important',
  'color: #1f2937 !important',
  'text-transform: none !important',
  'text-decoration: none !important',
  'letter-spacing: normal !important',
  'word-spacing: normal !important',
  'text-shadow: none !important',
  'text-align: left !important',
  'white-space: normal !important',
  'direction: ltr !important',
  'cursor: default !important',
].join('; ');

/**
 * Apply critical styles using individual setProperty calls.
 * This preserves CSS custom properties (--cw-*) already set on the element,
 * unlike setAttribute('style', ...) which wipes the entire style attribute.
 */
function applyCriticalStyles(el: HTMLElement): void {
  el.style.setProperty('position', 'fixed', 'important');
  el.style.setProperty('z-index', '2147483647', 'important');
  el.style.setProperty('top', '0', 'important');
  el.style.setProperty('left', '0', 'important');
  el.style.setProperty('right', '0', 'important');
  el.style.setProperty('bottom', '0', 'important');
  el.style.setProperty('width', '100%', 'important');
  el.style.setProperty('height', '100%', 'important');
  el.style.setProperty('margin', '0', 'important');
  el.style.setProperty('padding', '0', 'important');
  el.style.setProperty('border', 'none', 'important');
  el.style.setProperty('background', 'transparent', 'important');
  el.style.setProperty('pointer-events', 'none', 'important');
  el.style.setProperty('isolation', 'isolate', 'important');
  el.style.setProperty('transform', 'none', 'important');
  el.style.setProperty('transition', 'opacity 0.2s ease-in', 'important');
  el.style.setProperty('overflow', 'visible', 'important');
  el.style.setProperty('display', 'block', 'important');
  el.style.setProperty('visibility', 'visible', 'important');
  el.style.setProperty('opacity', revealed ? '1' : '0', 'important');
  // Block inherited CSS properties from host page (these leak through Shadow DOM)
  el.style.setProperty('font-family', 'Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif', 'important');
  el.style.setProperty('font-size', '14px', 'important');
  el.style.setProperty('font-weight', '400', 'important');
  el.style.setProperty('font-style', 'normal', 'important');
  el.style.setProperty('line-height', '1.5', 'important');
  el.style.setProperty('color', '#1f2937', 'important');
  el.style.setProperty('text-transform', 'none', 'important');
  el.style.setProperty('text-decoration', 'none', 'important');
  el.style.setProperty('letter-spacing', 'normal', 'important');
  el.style.setProperty('word-spacing', 'normal', 'important');
  el.style.setProperty('text-shadow', 'none', 'important');
  el.style.setProperty('text-align', 'left', 'important');
  el.style.setProperty('white-space', 'normal', 'important');
  el.style.setProperty('direction', 'ltr', 'important');
  el.style.setProperty('cursor', 'default', 'important');
}

// ── Module State ───────────────────────────────────────────────────────

let initialized = false;
let revealed = false;
let host: HTMLElement | null = null;
let shadowRoot: ShadowRoot | null = null;
let mountPoint: HTMLDivElement | null = null;
let attributeObserver: MutationObserver | null = null;
let bodyObserver: MutationObserver | null = null;
let viewportResizeHandler: (() => void) | null = null;
let savedScrollY = 0;
let isScrollLocked = false;
let savedBodyStyles: {
  position: string;
  top: string;
  left: string;
  right: string;
} | null = null;
let loadedFontFace: FontFace | null = null;

// ── Task 1: Host Element Creation ──────────────────────────────────────

function createHostElement(): HTMLElement {
  const el = document.createElement('div');
  el.id = HOST_ID;
  el.setAttribute('style', CRITICAL_STYLES);
  document.body.appendChild(el);
  return el;
}

// ── Task 2: Closed Shadow DOM Root ─────────────────────────────────────

function attachClosedShadow(hostEl: HTMLElement): ShadowRoot {
  const root = hostEl.attachShadow({ mode: 'closed' });

  // Verify closed mode: host.shadowRoot must return null
  if (hostEl.shadowRoot !== null) {
    console.warn('[CodeWeaves] Shadow root is not closed — external access possible.');
  }

  const mount = document.createElement('div');
  mount.className = MOUNT_CLASS;
  root.appendChild(mount);
  mountPoint = mount;

  return root;
}

// ── Task 3: Constructable Stylesheets ──────────────────────────────────

function adoptStylesheets(root: ShadowRoot): void {
  const resetSheet = new CSSStyleSheet();
  resetSheet.replaceSync(resetCSS);

  const themeSheet = new CSSStyleSheet();
  themeSheet.replaceSync(themeCSS);

  const twSheet = new CSSStyleSheet();
  twSheet.replaceSync(tailwindCSS);

  const componentSheet = new CSSStyleSheet();
  componentSheet.replaceSync(componentCSS);

  // Order: reset → theme vars → tailwind utilities → component overrides
  root.adoptedStyleSheets = [resetSheet, themeSheet, twSheet, componentSheet];
}

// ── Task 5: MutationObserver Protection ────────────────────────────────

function setupMutationObservers(hostEl: HTMLElement): void {
  let isReapplying = false;

  // Observe host element for attribute mutations (style, class, id)
  attributeObserver = new MutationObserver((mutations) => {
    if (isReapplying) return;
    for (const mutation of mutations) {
      if (mutation.type === 'attributes' && mutation.target === hostEl) {
        isReapplying = true;
        applyCriticalStyles(hostEl);
        requestAnimationFrame(() => {
          isReapplying = false;
        });
        break;
      }
    }
  });
  attributeObserver.observe(hostEl, {
    attributes: true,
    attributeFilter: ['style', 'class', 'id'],
  });

  // Observe document.body childList to re-append host if removed (with rate limit)
  let reappendCount = 0;
  bodyObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === 'childList' && mutation.target === document.body) {
        if (!document.body.contains(hostEl)) {
          if (reappendCount >= MAX_REAPPENDS) {
            console.warn(
              '[CodeWeaves] Host element removed too many times, giving up.',
            );
            bodyObserver?.disconnect();
            return;
          }
          reappendCount++;
          document.body.appendChild(hostEl);
          setTimeout(() => {
            reappendCount = Math.max(0, reappendCount - 1);
          }, REAPPEND_RESET_MS);
        }
      }
    }
  });
  bodyObserver.observe(document.body, { childList: true });
}

// ── Task 8: @font-face Light DOM Loading ───────────────────────────────

function sanitizeCSSValue(value: string): string {
  return value.replace(/[\\'";\n\r(){}]/g, '');
}

export async function loadCustomFont(
  fontFamily: string,
  fontUrl: string,
): Promise<void> {
  const safeFontFamily = sanitizeCSSValue(fontFamily);
  const safeFontUrl = sanitizeCSSValue(fontUrl);

  const font = new FontFace(safeFontFamily, `url(${safeFontUrl})`);
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(
      () => reject(new Error('Font load timeout')),
      FONT_LOAD_TIMEOUT_MS,
    );
  });
  try {
    const loaded = await Promise.race([font.load(), timeoutPromise]);
    if (timeoutId !== null) clearTimeout(timeoutId);
    loadedFontFace = loaded as FontFace;
    document.fonts.add(loadedFontFace);
  } catch {
    if (timeoutId !== null) clearTimeout(timeoutId);
    console.warn(
      `[CodeWeaves] Font "${safeFontFamily}" failed to load, using system font stack: ${SYSTEM_FONT_STACK}`,
    );
  }
}

// ── Task 10: iOS Keyboard Handling ─────────────────────────────────────

function setupKeyboardHandling(root: ShadowRoot): void {
  const vv = window.visualViewport;
  if (!vv) return;

  viewportResizeHandler = () => {
    const keyboardHeight = window.innerHeight - vv.height;
    const widgetRoot = root.querySelector(`.${MOUNT_CLASS}`) as HTMLElement;
    if (!widgetRoot) return;

    if (keyboardHeight > 50) {
      widgetRoot.style.paddingBottom = `${keyboardHeight}px`;
    } else {
      widgetRoot.style.paddingBottom = '';
    }
  };

  vv.addEventListener('resize', viewportResizeHandler);
}

// ── Task 12: Mobile Scroll Locking ─────────────────────────────────────

export function lockScroll(): void {
  if (isScrollLocked) return;
  if (window.innerWidth > MOBILE_BREAKPOINT) return;

  savedBodyStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
  };
  savedScrollY = window.scrollY;
  document.body.style.position = 'fixed';
  document.body.style.top = `-${savedScrollY}px`;
  document.body.style.left = '0';
  document.body.style.right = '0';
  isScrollLocked = true;
}

export function unlockScroll(): void {
  if (!isScrollLocked) return;

  document.body.style.position = savedBodyStyles?.position ?? '';
  document.body.style.top = savedBodyStyles?.top ?? '';
  document.body.style.left = savedBodyStyles?.left ?? '';
  document.body.style.right = savedBodyStyles?.right ?? '';
  if (!savedBodyStyles?.position) {
    window.scrollTo(0, savedScrollY);
  }
  savedBodyStyles = null;
  isScrollLocked = false;
}

// ── Task 11: SPA Navigation Cleanup ────────────────────────────────────

export function destroy(): void {
  // Disconnect MutationObservers
  if (attributeObserver) {
    attributeObserver.disconnect();
    attributeObserver = null;
  }
  if (bodyObserver) {
    bodyObserver.disconnect();
    bodyObserver = null;
  }

  // Remove VisualViewport listener
  if (viewportResizeHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', viewportResizeHandler);
    viewportResizeHandler = null;
  }

  // Unlock scroll if locked
  unlockScroll();

  // Unmount Preact component tree
  if (shadowRoot && mountPoint) {
    render(null, mountPoint);
  }

  // Remove host element from DOM
  if (host) {
    host.remove();
    host = null;
  }

  // Clean up loaded font from document.fonts
  if (loadedFontFace) {
    document.fonts.delete(loadedFontFace);
    loadedFontFace = null;
  }

  shadowRoot = null;
  mountPoint = null;
  initialized = false;
  revealed = false;

  // Clear window references
  window.__codeweaves_loaded = false;
  delete window.CodeWeaves;
}

// ── Anti-FOUC: Reveal widget after config loads (Story 5-4) ──────────

/**
 * Transition the widget from hidden (opacity: 0) to visible (opacity: 1).
 * Called after config is loaded to prevent flash of unstyled content.
 */
export function revealWidget(): void {
  revealed = true;
  if (host) {
    applyCriticalStyles(host);
  }
}

// ── Main Initialization ────────────────────────────────────────────────

export interface ShadowDomResult {
  host: HTMLElement;
  mountPoint: HTMLDivElement;
  destroy: () => void;
}

/**
 * Initialize the Shadow DOM environment for the widget.
 * Returns the mount point for Preact rendering and a destroy function for cleanup.
 */
export function initShadowDom(): ShadowDomResult {
  // Guard against double-init — clean up previous instance first
  if (initialized) {
    destroy();
  }

  // Task 1: Create host element with defensive inline styles
  host = createHostElement();

  // Task 2: Attach closed shadow root + mount point
  shadowRoot = attachClosedShadow(host);

  // Task 3: Adopt constructable stylesheets (reset, theme, components)
  adoptStylesheets(shadowRoot);

  // Task 5: Setup MutationObserver protection
  setupMutationObservers(host);

  // Task 10: iOS keyboard handling
  setupKeyboardHandling(shadowRoot);

  initialized = true;

  return {
    host,
    mountPoint: mountPoint!,
    destroy,
  };
}

/**
 * Render a Preact component into the shadow DOM mount point.
 * Task 7: Wire up Preact rendering into shadow root.
 */
export function renderInShadow(vnode: ComponentChild): void {
  if (!mountPoint) {
    throw new Error(
      '[CodeWeaves] Shadow DOM not initialized. Call initShadowDom() first.',
    );
  }
  render(vnode, mountPoint);
}
