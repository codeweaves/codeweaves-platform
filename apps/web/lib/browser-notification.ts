'use client';

/**
 * Native browser notifications — the OS-level popup that appears when the
 * dashboard is open in a background tab.
 *
 * This is the **Notifications API**, deliberately NOT Web Push. It fires
 * whenever any tab of the app is open, which is exactly the case we care about
 * ("dashboard in one tab, working in another"), and needs no service worker,
 * no VAPID keys and no subscription table. Notifying with every tab CLOSED is a
 * separate feature (Web Push) and is not built.
 *
 * Permission rule: we never ask on load. Browsers penalise unprompted requests
 * and users reflex-click Block, which is permanent and only reversible deep in
 * site settings. `requestBrowserNotificationPermission` must therefore be
 * called from a real click (see the bell panel's enable card).
 */

export type BrowserNotificationPermission = 'default' | 'granted' | 'denied' | 'unsupported';

export function browserNotificationSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function getBrowserNotificationPermission(): BrowserNotificationPermission {
  if (!browserNotificationSupported()) return 'unsupported';
  return Notification.permission as BrowserNotificationPermission;
}

/** Call ONLY from a user gesture. Resolves with the resulting permission. */
export async function requestBrowserNotificationPermission(): Promise<BrowserNotificationPermission> {
  if (!browserNotificationSupported()) return 'unsupported';
  try {
    return (await Notification.requestPermission()) as BrowserNotificationPermission;
  } catch {
    return getBrowserNotificationPermission();
  }
}

/**
 * Show a popup for a notification.
 *
 * Only fires when the document is hidden — popping an OS notification while the
 * user is already looking at the dashboard is pure noise (the toast covers it).
 *
 * `tag` is the notification id so a redelivery of the same event REPLACES the
 * existing popup instead of stacking a duplicate.
 */
export function showBrowserNotification(input: {
  id: string;
  title: string;
  body?: string;
  /** In-app route to open when the popup is clicked. */
  url?: string;
  onNavigate?: (url: string) => void;
}): void {
  if (!browserNotificationSupported()) return;
  if (Notification.permission !== 'granted') return;
  if (typeof document !== 'undefined' && !document.hidden) return;

  try {
    const notification = new Notification(input.title, {
      body: input.body,
      tag: input.id,
      icon: '/favicon.ico',
      // Let the OS decide sound; we play our own chime in-page so the two
      // don't double up on platforms that ring for notifications.
      silent: true,
    });

    notification.onclick = () => {
      try {
        window.focus();
        if (input.url) {
          if (input.onNavigate) input.onNavigate(input.url);
          else window.location.assign(input.url);
        }
      } finally {
        notification.close();
      }
    };
  } catch {
    // Some browsers throw when constructing notifications outside a service
    // worker (notably Android Chrome). Non-fatal — the bell and toast remain.
  }
}
