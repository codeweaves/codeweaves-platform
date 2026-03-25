import { Widget, triggerOpen, triggerClose, unregisterWidgetControls } from './components/Widget';
import { initShadowDom, renderInShadow, destroy as shadowDestroy } from './shadow-dom';
import { debug, warn, enableDebug } from './utils/debug';

/**
 * CodeWeaves Widget — IIFE auto-init entry point (Story 5-3).
 *
 * Reads `data-agent-id` from the embedding script tag, waits for DOM-ready,
 * creates a closed Shadow DOM, renders the Preact widget, and exposes
 * window.CodeWeaves global API for programmatic control.
 */

// ── Module State ──────────────────────────────────────────────────────

let domReadyHandler: (() => void) | null = null;

// SPA navigation patching state
let originalPushState: typeof history.pushState | null = null;
let originalReplaceState: typeof history.replaceState | null = null;
let popstateHandler: (() => void) | null = null;
let navigationHandler: (() => void) | null = null;

// ── Task 1: IIFE entry with singleton guard + script tag reading ──────

(function autoInit() {
  // Task 1a: Singleton guard
  if (window.__codeweaves_loaded) return;

  // Task 1c/1d: Read data-agent-id from script tag
  const script = document.currentScript || document.querySelector('script[data-agent-id]');

  // Task 7: Detect debug mode (data-debug attribute or Vite dev mode)
  const hasDebugAttr = script?.hasAttribute('data-debug') ?? false;
  if (hasDebugAttr || import.meta.env.DEV) {
    enableDebug();
  }

  const agentId = script?.getAttribute('data-agent-id')?.trim() || null;
  const apiBaseUrl = script?.getAttribute('data-api-url')?.trim() || '';

  // Task 6: Handle missing agent-id gracefully
  if (!agentId) {
    warn('Missing data-agent-id attribute on script tag');
    // Expose stub API so programmatic init is still possible
    exposeStubAPI();
    return;
  }

  debug('Agent ID detected:', agentId);
  if (apiBaseUrl) debug('API base URL:', apiBaseUrl);

  // Task 2: DOM-ready wait
  initWidget(agentId, apiBaseUrl);
})();

// ── Task 2: DOM-ready wait logic ──────────────────────────────────────

function onReady(callback: () => void): void {
  // Remove any previously registered handler (prevents race on rapid init/destroy)
  if (domReadyHandler) {
    document.removeEventListener('DOMContentLoaded', domReadyHandler);
    domReadyHandler = null;
  }

  if (document.readyState === 'loading') {
    debug('DOM still loading, deferring initialization');
    domReadyHandler = callback;
    document.addEventListener('DOMContentLoaded', domReadyHandler, { once: true });
  } else {
    debug('DOM already ready, proceeding immediately');
    callback();
  }
}

// ── Core initialization (used by auto-init and programmatic init) ─────

// Track apiBaseUrl for re-init scenarios
let currentApiBaseUrl = '';

function initWidget(agentId: string, apiBaseUrl: string = ''): void {
  currentApiBaseUrl = apiBaseUrl;
  onReady(() => bootstrap(agentId, apiBaseUrl));
}

function bootstrap(agentId: string, apiBaseUrl: string = ''): void {
  // Re-check singleton (may have been set between auto-init and DOMContentLoaded)
  if (window.__codeweaves_loaded) return;
  if (!document.body) return;

  window.__codeweaves_loaded = true;

  // Clean up DOMContentLoaded listener reference
  domReadyHandler = null;

  debug('Initializing widget for agent:', agentId);

  // Task 3: Create host element and Shadow DOM
  debug('Creating Shadow DOM');
  const { host: hostEl } = initShadowDom();

  // Task 4: Render Preact app into shadow root (pass host for theme injection)
  debug('Rendering Preact app');
  renderInShadow(<Widget agentId={agentId} apiBaseUrl={apiBaseUrl} hostElement={hostEl} />);

  // Task 8: Setup SPA navigation handling
  setupSPANavigation();

  // Task 5: Expose global API
  exposeGlobalAPI();

  debug('Widget initialization complete');
}

// ── Task 5: Global API ────────────────────────────────────────────────

function exposeGlobalAPI(): void {
  window.CodeWeaves = {
    init: programmaticInit,
    destroy: fullDestroy,
    open: () => {
      debug('API: open()');
      triggerOpen();
    },
    close: () => {
      debug('API: close()');
      triggerClose();
    },
  };
  debug('Global API exposed on window.CodeWeaves');
}

/** Stub API exposed when auto-init fails or after destroy — only init() works. */
function exposeStubAPI(): void {
  window.CodeWeaves = {
    init: programmaticInit,
    destroy: () => warn('Widget not initialized'),
    open: () => warn('Widget not initialized'),
    close: () => warn('Widget not initialized'),
  };
}

/** Programmatic init — alternative to data-agent-id attribute (for SPAs). */
function programmaticInit(agentId: string, apiBaseUrl?: string): void {
  if (!agentId || typeof agentId !== 'string') {
    warn('init() requires a non-empty agentId string');
    return;
  }

  const trimmed = agentId.trim();
  if (!trimmed) {
    warn('init() requires a non-empty agentId string');
    return;
  }

  // If already loaded, destroy first for re-init
  if (window.__codeweaves_loaded) {
    debug('Re-initializing widget with new agent:', trimmed);
    fullDestroy();
  }

  initWidget(trimmed, apiBaseUrl ?? currentApiBaseUrl);
}

// ── Task 5 (destroy): Full cleanup ───────────────────────────────────

function fullDestroy(): void {
  debug('Destroying widget');

  // Tear down SPA navigation handling
  teardownSPANavigation();

  // Unregister widget open/close callbacks
  unregisterWidgetControls();

  // Clean up DOMContentLoaded listener if destroy called before DOM ready
  if (domReadyHandler) {
    document.removeEventListener('DOMContentLoaded', domReadyHandler);
    domReadyHandler = null;
  }

  // Delegate to shadow-dom.ts destroy (observers, viewport, scroll, Preact unmount, host removal)
  shadowDestroy();

  // Reset singleton flag (explicit — don't rely solely on shadowDestroy)
  window.__codeweaves_loaded = false;

  // Remove global API but re-expose stub for programmatic re-init
  exposeStubAPI();

  debug('Widget destroyed');
}

// ── Task 8: SPA navigation handling ──────────────────────────────────

function setupSPANavigation(): void {
  // Listen for browser back/forward
  popstateHandler = () => {
    debug('SPA navigation: popstate event');
  };
  window.addEventListener('popstate', popstateHandler);

  // Patch history.pushState and history.replaceState
  navigationHandler = () => {
    debug('SPA navigation: programmatic navigation detected');
  };

  originalPushState = history.pushState.bind(history);
  originalReplaceState = history.replaceState.bind(history);

  history.pushState = (...args: Parameters<typeof history.pushState>) => {
    originalPushState!(...args);
    window.dispatchEvent(new Event('cw:navigation'));
  };

  history.replaceState = (...args: Parameters<typeof history.replaceState>) => {
    originalReplaceState!(...args);
    window.dispatchEvent(new Event('cw:navigation'));
  };

  window.addEventListener('cw:navigation', navigationHandler);

  debug('SPA navigation handling registered');
}

function teardownSPANavigation(): void {
  // Remove popstate listener
  if (popstateHandler) {
    window.removeEventListener('popstate', popstateHandler);
    popstateHandler = null;
  }

  // Remove custom navigation event listener
  if (navigationHandler) {
    window.removeEventListener('cw:navigation', navigationHandler);
    navigationHandler = null;
  }

  // Restore original history methods
  if (originalPushState) {
    history.pushState = originalPushState;
    originalPushState = null;
  }
  if (originalReplaceState) {
    history.replaceState = originalReplaceState;
    originalReplaceState = null;
  }
}
