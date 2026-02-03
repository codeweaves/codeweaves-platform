import { render } from 'preact';
import { App } from './App';

// Mount widget to the root element
const rootElement = document.getElementById('codeweaves-widget-root');

if (rootElement) {
  render(<App />, rootElement);
}

// Export for programmatic initialization
export function initWidget(containerId: string) {
  const container = document.getElementById(containerId);
  if (container) {
    render(<App />, container);
  }
}
