export interface CallbackError {
  code: string | null;
  message: string;
}

/**
 * Supabase reports a failed e-mail link in the URL: in the query string (PKCE flow) or in the
 * hash fragment (implicit flow), as error / error_code / error_description.
 */
export function readCallbackError(search: string, hash: string): CallbackError | null {
  const params = new URLSearchParams(search.replace(/^\?/, ''));
  const hashParams = new URLSearchParams(hash.replace(/^#/, ''));
  const error = params.get('error') ?? hashParams.get('error');
  const code = params.get('error_code') ?? hashParams.get('error_code');
  const description = params.get('error_description') ?? hashParams.get('error_description');
  if (!error && !code && !description) return null;

  if (code === 'otp_expired' || /expired|invalid/i.test(description ?? '')) {
    return {
      code,
      message:
        'This link has expired or was already used. If you have already confirmed your e-mail, just sign in. Otherwise request a new link.',
    };
  }
  if (code === 'access_denied' || error === 'access_denied') {
    return { code, message: 'The link could not be verified. Try signing in, or request a new link.' };
  }
  return { code, message: 'The link could not be completed. Try signing in, or request a new link.' };
}
