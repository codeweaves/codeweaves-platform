/** Widget initialization configuration passed via script tag data attributes */
export interface WidgetConfig {
  /** The agent's public ID (from script tag) */
  agentId: string;
  /** API base URL for fetching configuration */
  apiBaseUrl: string;
}

/** Theme properties matching the --cw-* CSS custom property namespace */
export interface WidgetTheme {
  primary: string;
  primaryForeground: string;
  background: string;
  foreground: string;
  border: string;
  radius: string;
  fontFamily: string;
  fontSize: string;
}

/** Widget open/closed/minimized state */
export type WidgetState = 'minimized' | 'open' | 'closed';
