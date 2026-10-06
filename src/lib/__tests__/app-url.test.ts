// @vitest-environment jsdom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { getAppUrl, getAuthCallbackUrl, getPasswordResetUrl, parseConfiguredAppUrl } from '../app-url';
import { readCallbackError } from '../auth-callback';

describe('parseConfiguredAppUrl', () => {
  it('accepts an https origin and strips any path, query or trailing slash', () => {
    expect(parseConfiguredAppUrl('https://workspace-manager-five.vercel.app')).toBe('https://workspace-manager-five.vercel.app');
    expect(parseConfiguredAppUrl('https://workspace-manager-five.vercel.app/')).toBe('https://workspace-manager-five.vercel.app');
    expect(parseConfiguredAppUrl('  https://workspace.tbb.example/some/path?x=1#h ')).toBe('https://workspace.tbb.example');
  });

  it('allows plain http only for local development hosts', () => {
    expect(parseConfiguredAppUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(parseConfiguredAppUrl('http://127.0.0.1:8080')).toBe('http://127.0.0.1:8080');
    expect(parseConfiguredAppUrl('http://workspace.tbb.example')).toBeNull();
  });

  it('rejects empty, malformed, non-http and credential-bearing values', () => {
    expect(parseConfiguredAppUrl(undefined)).toBeNull();
    expect(parseConfiguredAppUrl(null)).toBeNull();
    expect(parseConfiguredAppUrl('')).toBeNull();
    expect(parseConfiguredAppUrl('   ')).toBeNull();
    expect(parseConfiguredAppUrl('not a url')).toBeNull();
    expect(parseConfiguredAppUrl('javascript:alert(1)')).toBeNull();
    expect(parseConfiguredAppUrl('ftp://workspace.tbb.example')).toBeNull();
    expect(parseConfiguredAppUrl('https://user:pass@workspace.tbb.example')).toBeNull();
  });
});

describe('environment-aware auth URLs', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('local development: no variable set -> the current origin (e.g. http://localhost:8080)', () => {
    vi.stubEnv('VITE_APP_URL', '');
    expect(getAppUrl()).toBe(window.location.origin);
    expect(getAuthCallbackUrl()).toBe(`${window.location.origin}/auth/callback`);
    expect(getPasswordResetUrl()).toBe(`${window.location.origin}/reset-password`);
  });

  it('production: VITE_APP_URL decides, whatever host the page was opened on', () => {
    vi.stubEnv('VITE_APP_URL', 'https://workspace-manager-five.vercel.app/');
    expect(getAppUrl()).toBe('https://workspace-manager-five.vercel.app');
    expect(getAuthCallbackUrl()).toBe('https://workspace-manager-five.vercel.app/auth/callback');
    expect(getPasswordResetUrl()).toBe('https://workspace-manager-five.vercel.app/reset-password');
  });

  it('a future custom domain only needs the variable changed', () => {
    vi.stubEnv('VITE_APP_URL', 'https://workspace.thinkbigbrand.com');
    expect(getAuthCallbackUrl()).toBe('https://workspace.thinkbigbrand.com/auth/callback');
  });

  it('an invalid or unsafe variable is ignored rather than trusted', () => {
    vi.stubEnv('VITE_APP_URL', 'http://evil.example');
    expect(getAppUrl()).toBe(window.location.origin);
    vi.stubEnv('VITE_APP_URL', 'javascript:alert(1)');
    expect(getAppUrl()).toBe(window.location.origin);
  });
});

describe('readCallbackError', () => {
  it('returns null for a normal callback', () => {
    expect(readCallbackError('?code=abc', '')).toBeNull();
    expect(readCallbackError('', '')).toBeNull();
  });

  it('explains an expired or used link (query string, PKCE)', () => {
    const e = readCallbackError('?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired', '');
    expect(e?.code).toBe('otp_expired');
    expect(e?.message).toMatch(/expired or was already used/i);
  });

  it('reads the hash fragment too (implicit flow)', () => {
    const e = readCallbackError('', '#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid');
    expect(e?.message).toMatch(/expired or was already used/i);
  });

  it('handles access_denied and unknown errors without leaking raw text', () => {
    expect(readCallbackError('?error=access_denied', '')?.message).toMatch(/could not be verified/i);
    const other = readCallbackError('?error=server_error&error_description=boom+stack+trace', '');
    expect(other?.message).toMatch(/could not be completed/i);
    expect(other?.message).not.toMatch(/stack trace/);
  });
});
