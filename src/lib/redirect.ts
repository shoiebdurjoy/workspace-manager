/**
 * Where a signed-in person lands when nothing else says: editors and QC specialists on My Tasks (their
 * assignments and revision feedback), managers and everyone else on Home.
 */
export const landingFor = (role: string | null | undefined): string =>
  role === 'EDITOR' || role === 'QC_SPECIALIST' ? '/my-tasks' : '/home';

/**
 * Only allow in-app paths as a post-login destination (prevents open redirects). Without one, `/` decides
 * where the person lands (My Tasks for editors and QC, Home for everyone else).
 */
export function safeRedirectTarget(from: string | undefined | null): string {
  if (!from || !from.startsWith('/') || from.startsWith('//') || from.includes('\\')) return '/';
  if (from === '/login' || from === '/register' || from.startsWith('/login?')) return '/';
  return from;
}
