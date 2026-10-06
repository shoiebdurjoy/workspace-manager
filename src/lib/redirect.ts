/** Only allow in-app paths as a post-login destination (prevents open redirects). */
export function safeRedirectTarget(from: string | undefined | null): string {
  if (!from || !from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return '/home';
  if (from === '/login' || from === '/register' || from.startsWith('/login?')) return '/home';
  return from;
}
