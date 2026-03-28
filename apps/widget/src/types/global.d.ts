/** Vite ?inline CSS imports return a string */
declare module '*.css?inline' {
  const css: string;
  export default css;
}

/** Global window augmentation for CodeWeaves widget */

interface CodeWeavesAPI {
  /** Programmatic initialization (alternative to script src URL) */
  init: (agentId: string) => void;
  /** Fully remove widget from DOM, clean up all listeners, reset singleton */
  destroy: () => void;
  /** Expand the chat widget */
  open: () => void;
  /** Collapse the chat widget */
  close: () => void;
}

interface Window {
  __codeweaves_loaded?: boolean;
  CodeWeaves?: CodeWeavesAPI;
}
