import { describe, it, expect } from 'vitest';
import {
  describeAuthError,
  isNetworkError,
  NETWORK_ERROR_MESSAGE,
  validateEmail,
  validatePassword,
} from '../auth-errors';
import { safeRedirectTarget } from '../redirect';
import { slugify } from '../slug';

describe('describeAuthError', () => {
  it('network failures say the server is unreachable (docs/TBB_TESTING_STRATEGY.md 2.4)', () => {
    expect(NETWORK_ERROR_MESSAGE).toContain('Unable to connect to the authentication server');
    expect(describeAuthError(new TypeError('Failed to fetch'))).toBe(NETWORK_ERROR_MESSAGE);
    expect(describeAuthError({ name: 'AuthRetryableFetchError', message: 'x', status: 0 })).toBe(NETWORK_ERROR_MESSAGE);
    expect(describeAuthError({ message: 'fetch failed' })).toBe(NETWORK_ERROR_MESSAGE);
    expect(isNetworkError({ message: 'NetworkError when attempting to fetch resource.' })).toBe(true);
    expect(isNetworkError({ message: 'Load failed' })).toBe(true);
    expect(isNetworkError({ message: 'Invalid login credentials' })).toBe(false);
  });

  it('maps known Supabase error codes to plain language', () => {
    expect(describeAuthError({ code: 'invalid_credentials', message: 'x' })).toBe('Incorrect e-mail or password.');
    expect(describeAuthError({ code: 'email_not_confirmed' })).toMatch(/confirm your e-mail/i);
    expect(describeAuthError({ code: 'user_already_exists' })).toMatch(/already exists/i);
    expect(describeAuthError({ code: 'email_exists' })).toMatch(/already exists/i);
    expect(describeAuthError({ code: 'weak_password' })).toMatch(/too weak/i);
    expect(describeAuthError({ code: 'over_email_send_rate_limit' })).toMatch(/too many attempts/i);
    expect(describeAuthError({ code: 'over_request_rate_limit' })).toMatch(/too many attempts/i);
    expect(describeAuthError({ code: 'user_banned' })).toMatch(/disabled/i);
    expect(describeAuthError({ code: 'same_password' })).toMatch(/different/i);
    expect(describeAuthError({ code: 'session_not_found' })).toMatch(/expired/i);
    expect(describeAuthError({ code: 'refresh_token_not_found' })).toMatch(/expired/i);
    expect(describeAuthError({ code: 'signup_disabled' })).toMatch(/disabled/i);
    expect(describeAuthError({ code: 'validation_failed' })).toMatch(/check the details/i);
  });

  it('falls back on message patterns, then to a generic message without leaking details', () => {
    expect(describeAuthError({ message: 'Invalid login credentials' })).toBe('Incorrect e-mail or password.');
    expect(describeAuthError({ message: 'Email not confirmed' })).toMatch(/confirm your e-mail/i);
    expect(describeAuthError({ message: 'User already registered' })).toMatch(/already exists/i);
    const generic = describeAuthError({ message: 'pg: relation "x" does not exist at character 14' });
    expect(generic).toBe('Something went wrong. Please try again.');
    expect(describeAuthError('boom')).toBe('Something went wrong. Please try again.');
    expect(describeAuthError(undefined)).toBe('Something went wrong. Please try again.');
    expect(describeAuthError(42)).toBe('Something went wrong. Please try again.');
  });
});

describe('validatePassword (matches supabase/config.toml policy)', () => {
  it('requires length, lower, upper and a digit', () => {
    expect(validatePassword('Ab1')).toMatch(/at least 8/);
    expect(validatePassword('ABCDEFG1')).toMatch(/lower-case/);
    expect(validatePassword('abcdefg1')).toMatch(/upper-case/);
    expect(validatePassword('Abcdefgh')).toMatch(/number/);
    expect(validatePassword('Abcdefg1')).toBeNull();
  });
});

describe('validateEmail', () => {
  it('accepts plausible addresses and rejects the rest', () => {
    expect(validateEmail('')).toMatch(/Enter your e-mail/);
    expect(validateEmail('   ')).toMatch(/Enter your e-mail/);
    expect(validateEmail('nope')).toMatch(/valid/);
    expect(validateEmail('a@b')).toMatch(/valid/);
    expect(validateEmail('a b@c.d')).toMatch(/valid/);
    expect(validateEmail(' person@thinkbigbrand.com ')).toBeNull();
  });
});

describe('safeRedirectTarget (no open redirects after login)', () => {
  it('keeps in-app paths and rejects everything else', () => {
    expect(safeRedirectTarget('/team?tab=pods')).toBe('/team?tab=pods');
    expect(safeRedirectTarget(undefined)).toBe('/home');
    expect(safeRedirectTarget(null)).toBe('/home');
    expect(safeRedirectTarget('')).toBe('/home');
    expect(safeRedirectTarget('https://evil.example')).toBe('/home');
    expect(safeRedirectTarget('//evil.example')).toBe('/home');
    expect(safeRedirectTarget('/\\evil.example')).toBe('/home');
    expect(safeRedirectTarget('javascript:alert(1)')).toBe('/home');
    expect(safeRedirectTarget('/login')).toBe('/home');
    expect(safeRedirectTarget('/register')).toBe('/home');
  });
});

describe('slugify', () => {
  it('produces url-safe slugs', () => {
    expect(slugify('Think Big Brand')).toBe('think-big-brand');
    expect(slugify('  Café   Déjà Vu!! ')).toBe('cafe-deja-vu');
    expect(slugify('***')).toBe('workspace');
    expect(slugify('a'.repeat(100))).toHaveLength(48);
  });
});
