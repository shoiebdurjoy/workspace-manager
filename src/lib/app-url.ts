/**
 * The public URL of THIS deployment, used for every link Supabase puts in an e-mail
 * (sign-up confirmation, password reset).
 *
 * Resolution order:
 *  1. VITE_APP_URL, when set to a valid http(s) origin: the canonical public URL. Set it in
 *     Vercel for production (and when a custom domain is attached) so confirmation links
 *     always point at the real site, whatever host the sign-up happened on.
 *  2. Otherwise window.location.origin: local development (http://localhost:8080) and any
 *     deployment that has not set the variable work with no configuration.
 *
 * Nothing here is hard-coded to a host. The URL used must ALSO be allowed in Supabase
 * (Authentication -> URL Configuration), otherwise Supabase ignores the requested redirect
 * and falls back to its Site URL. See docs/TBB_PHASE_4_AUTH_AND_TEAMS.md.
 */

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns the origin for a configured value, or null when it is missing or unsafe. */
export function parseConfiguredAppUrl(value: string | undefined | null): string | null {
  const raw = value?.trim();
  if (!raw) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const isLocal = LOCAL_HOSTS.has(url.hostname);
  // Public deployments must use https; plain http is only for local development.
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && isLocal)) return null;
  if (url.username || url.password) return null;
  return url.origin;
}

export function getAppUrl(): string {
  return parseConfiguredAppUrl(import.meta.env.VITE_APP_URL) ?? window.location.origin;
}

/** Where the sign-up confirmation link lands. */
export function getAuthCallbackUrl(): string {
  return `${getAppUrl()}/auth/callback`;
}

/** Where the password-reset link lands. */
export function getPasswordResetUrl(): string {
  return `${getAppUrl()}/reset-password`;
}
