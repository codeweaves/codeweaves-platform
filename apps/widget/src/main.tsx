import { Widget } from './components/Widget';
import { initShadowDom, renderInShadow, destroy as shadowDestroy } from './shadow-dom';

/**
 * IIFE auto-init entry point for the CodeWeaves chat widget.
 * When the script loads, it immediately bootstraps the widget
 * inside a closed Shadow DOM for full CSS isolation.
 */

let domReadyHandler: (() => void) | null = null;

(function init() {
  if (document.readyState === 'loading') {
    domReadyHandler = bootstrap;
    document.addEventListener('DOMContentLoaded', domReadyHandler);
  } else {
    bootstrap();
  }
})();

function bootstrap() {
  // Prevent duplicate widget injection (module-scoped + window flag)
  if (window.__codeweaves_loaded) return;
  if (!document.body) return;

  window.__codeweaves_loaded = true;

  // Clean up DOMContentLoaded listener if it was registered
  if (domReadyHandler) {
    document.removeEventListener('DOMContentLoaded', domReadyHandler);
    domReadyHandler = null;
  }

  // Initialize Shadow DOM (host element, closed shadow root, stylesheets, observers)
  initShadowDom();

  // Render Preact widget into shadow root mount point
  renderInShadow(<Widget />);

  // Expose destroy for SPA cleanup
  window.__codeweaves_destroy = () => {
    // Remove DOMContentLoaded listener if destroy called before DOM ready
    if (domReadyHandler) {
      document.removeEventListener('DOMContentLoaded', domReadyHandler);
      domReadyHandler = null;
    }
    shadowDestroy();
  };
}
