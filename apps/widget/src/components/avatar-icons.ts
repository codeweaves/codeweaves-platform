/**
 * Inline SVG icon definitions for avatar type rendering.
 * Each icon uses `currentColor` so the --cw-avatar-*-color CSS variable controls icon color.
 *
 * Bot types: robot, machine, bot, support, user, custom
 * User types: male/user, female, custom
 */
import type { ComponentChildren } from 'preact';
import { h } from 'preact';

export type BotAvatarType = 'robot' | 'machine' | 'bot' | 'support' | 'user' | 'custom';
export type UserAvatarType = 'male' | 'female' | 'user' | 'custom';

/** Shared SVG wrapper props */
const SVG_PROPS: Record<string, string> = {
  width: '22',
  height: '22',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  'aria-hidden': 'true',
};

/** Robot head — default bot icon */
function RobotIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('rect', { x: '4', y: '6', width: '16', height: '14', rx: '2' }),
    h('circle', { cx: '9', cy: '13', r: '1.5' }),
    h('circle', { cx: '15', cy: '13', r: '1.5' }),
    h('line', { x1: '12', y1: '2', x2: '12', y2: '6' }),
    h('circle', { cx: '12', cy: '2', r: '1' }),
  );
}

/** Gear/cog — machine type */
function MachineIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('circle', { cx: '12', cy: '12', r: '3' }),
    h('path', { d: 'M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z' }),
  );
}

/** Lightning/zap — bot type */
function ZapIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('polygon', { points: '13 2 3 14 12 14 11 22 21 10 12 10 13 2' }),
  );
}

/** Headphones — support type */
function SupportIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('path', { d: 'M3 18v-6a9 9 0 0 1 18 0v6' }),
    h('path', { d: 'M21 19a2 2 0 0 1-2 2h-1a2 2 0 0 1-2-2v-3a2 2 0 0 1 2-2h3z' }),
    h('path', { d: 'M3 19a2 2 0 0 0 2 2h1a2 2 0 0 0 2-2v-3a2 2 0 0 0-2-2H3z' }),
  );
}

/** Person silhouette — user icon */
function UserIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('path', { d: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2' }),
    h('circle', { cx: '12', cy: '7', r: '4' }),
  );
}

/** Person with checkmark — female type */
function UserCheckIcon(): ComponentChildren {
  return h('svg', SVG_PROPS,
    h('path', { d: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2' }),
    h('circle', { cx: '9', cy: '7', r: '4' }),
    h('polyline', { points: '16 11 18 13 22 9' }),
  );
}

const BOT_ICON_MAP: Record<string, () => ComponentChildren> = {
  robot: RobotIcon,
  machine: MachineIcon,
  bot: ZapIcon,
  support: SupportIcon,
  user: UserIcon,
};

const USER_ICON_MAP: Record<string, () => ComponentChildren> = {
  male: UserIcon,
  female: UserCheckIcon,
  user: UserIcon,
};

/**
 * Get a Preact VNode for a bot avatar type.
 * Returns undefined for 'custom' or unrecognized types (caller should fallback).
 */
export function getBotAvatarIcon(type: string | undefined): ComponentChildren | undefined {
  if (!type || type === 'custom') return undefined;
  const factory = BOT_ICON_MAP[type];
  return factory ? factory() : undefined;
}

/**
 * Get a Preact VNode for a user avatar type.
 * Returns undefined for 'custom' or unrecognized types (caller should fallback).
 */
export function getUserAvatarIcon(type: string | undefined): ComponentChildren | undefined {
  if (!type || type === 'custom') return undefined;
  const factory = USER_ICON_MAP[type];
  return factory ? factory() : undefined;
}
