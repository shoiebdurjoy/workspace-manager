/**
 * Turns authentication and database failures into messages a person can act on.
 * Technical details are never shown to the user and a failure is never disguised as a
 * success: there is no offline or demo fallback anywhere in the application.
 */

export const NETWORK_ERROR_MESSAGE =
  'Unable to connect to the authentication server. Check your internet connection and try again.';

interface ErrorLike {
  message?: string;
  code?: string;
  status?: number;
  name?: string;
}

function asErrorLike(error: unknown): ErrorLike {
  if (typeof error === 'object' && error !== null) return error as ErrorLike;
  if (typeof error === 'string') return { message: error };
  return {};
}

export function isNetworkError(error: unknown): boolean {
  const e = asErrorLike(error);
  const message = (e.message ?? '').toLowerCase();
  return (
    e.name === 'AuthRetryableFetchError' ||
    e.status === 0 ||
    message.includes('failed to fetch') ||
    message.includes('networkerror') ||
    message.includes('network request failed') ||
    message.includes('load failed') ||
    message.includes('fetch failed')
  );
}

export function describeAuthError(error: unknown): string {
  if (isNetworkError(error)) return NETWORK_ERROR_MESSAGE;

  const e = asErrorLike(error);
  switch (e.code) {
    case 'invalid_credentials':
      return 'Incorrect e-mail or password.';
    case 'email_not_confirmed':
      return 'Please confirm your e-mail address first. Check your inbox for the confirmation link.';
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this e-mail address already exists. Try signing in instead.';
    case 'weak_password':
      return 'That password is too weak. Use at least 8 characters with upper-case, lower-case and a number.';
    case 'over_email_send_rate_limit':
    case 'over_request_rate_limit':
      return 'Too many attempts. Please wait a few minutes and try again.';
    case 'user_banned':
      return 'This account has been disabled. Contact your administrator.';
    case 'same_password':
      return 'Your new password must be different from the current one.';
    case 'session_not_found':
    case 'refresh_token_not_found':
      return 'Your session has expired. Please sign in again.';
    case 'signup_disabled':
      return 'New registrations are disabled. Ask your administrator for access.';
    case 'validation_failed':
      return 'Please check the details you entered and try again.';
    default:
      break;
  }

  const message = e.message ?? '';
  if (/invalid login credentials/i.test(message)) return 'Incorrect e-mail or password.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your e-mail address first. Check your inbox for the confirmation link.';
  if (/already registered/i.test(message)) return 'An account with this e-mail address already exists. Try signing in instead.';
  return 'Something went wrong. Please try again.';
}

/** Matches the password policy configured in supabase/config.toml. */
export const PASSWORD_MIN_LENGTH = 8;

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
  if (!/[a-z]/.test(password)) return 'Include at least one lower-case letter.';
  if (!/[A-Z]/.test(password)) return 'Include at least one upper-case letter.';
  if (!/[0-9]/.test(password)) return 'Include at least one number.';
  return null;
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): string | null {
  const value = email.trim();
  if (!value) return 'Enter your e-mail address.';
  if (!EMAIL_PATTERN.test(value)) return 'Enter a valid e-mail address.';
  return null;
}
