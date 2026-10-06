import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import AuthCallback from '../AuthCallback';
import { makeAuth, renderWithAuth, signedOut } from '@/test/auth-utils';

const app = (auth: ReturnType<typeof makeAuth>, route: string) =>
  renderWithAuth(
    <Routes>
      <Route path="/auth/callback" element={<AuthCallback />} />
      <Route path="/home" element={<div>home page</div>} />
      <Route path="/login" element={<div>login page</div>} />
    </Routes>,
    { auth, route }
  );

describe('/auth/callback', () => {
  it('waits while the one-time code is being exchanged for a session', () => {
    app(signedOut({ status: 'loading', isLoading: true }), '/auth/callback?code=abc');
    expect(screen.getByText(/Signing you in/i)).toBeInTheDocument();
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('continues into the app once the confirmation created a session', () => {
    app(makeAuth('EDITOR'), '/auth/callback?code=abc');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('a person without a workspace also continues (the router then sends them to onboarding)', () => {
    app(makeAuth(null), '/auth/callback?code=abc');
    expect(screen.getByText('home page')).toBeInTheDocument();
  });

  it('shows the link error from Supabase instead of failing silently', () => {
    app(
      signedOut(),
      '/auth/callback?error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired'
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/expired or was already used/i);
    expect(screen.getByRole('link', { name: 'Go to sign in' })).toHaveAttribute('href', '/login');
  });

  it('with no session and no error (e.g. opened on another device) explains that the e-mail is still confirmed', () => {
    app(signedOut(), '/auth/callback?code=abc');
    expect(screen.getByRole('alert')).toHaveTextContent(/still confirmed/i);
    expect(screen.getByRole('link', { name: /forgot your password/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('never creates a session on its own: unauthenticated stays unauthenticated', () => {
    app(signedOut(), '/auth/callback');
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('shows an account-load error from the provider', () => {
    app(signedOut({ error: 'Unable to connect to the authentication server.' }), '/auth/callback?code=abc');
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to connect');
  });
});
