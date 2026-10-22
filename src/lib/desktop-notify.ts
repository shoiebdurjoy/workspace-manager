/**
 * Desktop notifications on THIS device (Profile > Notifications). A per-device preference, so it lives in browser
 * storage; the browser itself asks the person for permission.
 */
export const DESKTOP_NOTIFY_STORAGE_KEY = 'tbb_desktop_notify';

export function desktopNotifySupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export function desktopNotifyOn(): boolean {
  try {
    return desktopNotifySupported() && Notification.permission === 'granted' && window.localStorage.getItem(DESKTOP_NOTIFY_STORAGE_KEY) === 'on';
  } catch {
    return false;
  }
}

export async function setDesktopNotify(on: boolean): Promise<boolean> {
  if (!desktopNotifySupported()) return false;
  if (on && Notification.permission !== 'granted') {
    const answer = await Notification.requestPermission();
    if (answer !== 'granted') return false;
  }
  try {
    window.localStorage.setItem(DESKTOP_NOTIFY_STORAGE_KEY, on ? 'on' : 'off');
  } catch {
    // private window: it simply is not remembered
  }
  return on;
}

/** Shows "N new notifications" while the tab is in the background. */
export function showDesktopNotice(count: number): void {
  if (!desktopNotifyOn() || !document.hidden || count <= 0) return;
  try {
    const n = new Notification('TBB Workspace', { body: count === 1 ? 'You have a new notification' : `You have ${count} new notifications`, icon: '/favicon.ico', tag: 'tbb-inbox' });
    n.onclick = () => {
      window.focus();
      window.location.assign('/inbox');
    };
  } catch {
    // some browsers only allow notifications from a service worker; nothing to do
  }
}
