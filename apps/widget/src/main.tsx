import { render } from 'preact';
import { Widget } from './components/Widget';

/**
 * IIFE auto-init entry point for the CodeWeaves chat widget.
 * When the script loads, it immediately bootstraps the widget.
 * The IIFE wrapper is handled by Vite/Rollup build output format.
 */
(function init() {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
})();

function bootstrap() {
  // Prevent duplicate widget injection if script is loaded more than once
  if (document.getElementById('codeweaves-widget-root')) return;

  // Guard against edge case where body isn't available yet
  if (!document.body) return;

  // Story 5-2 will replace this with Shadow DOM initialization.
  // For now, create a host element and render the Widget directly.
  const host = document.createElement('div');
  host.id = 'codeweaves-widget-root';
  document.body.appendChild(host);
  render(<Widget />, host);
}
