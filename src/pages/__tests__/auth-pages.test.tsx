import React from 'react';
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import Login from '../Login';
import Register from '../Register';
import ForgotPassword from '../ForgotPassword';
import ResetPassword from '../ResetPassword';
import { makeAuth, renderWithAuth, signedOut } from '@/test/auth-utils';
import { NETWORK_ERROR_MESSAGE } from '@/lib/auth-errors';

const Home = () => <div>home page</div>;

describe('Login page', () => {
  const renderLogin = (auth = signedOut(), route: string | { pathname: string; state?: unknown } = '/login') =>
    renderWithAuth(
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/home" element={<Home />} />
        <Route path="/team" element={<div>team page</div>} />
      </Routes>,
      { auth, route }
    );

  it('validates before calling the server', async () => {
    const auth = signedOut();
    renderLogin(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter your e-mail address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('rejects a malformed e-mail', async () => {
    const auth = signedOut();
    renderLogin(auth);
    await userEvent.type(screen.getByLabelText('E-mail'), 'not-an-email');
    await userEvent.type(screen.getByLabelText('Password'), 'x');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter a valid e-mail address.')).toBeInTheDocument();
    expect(auth.signIn).not.toHaveBeenCalled();
  });

  it('signs in and moves to Home', async () => {
    const auth = signedOut();
    renderLogin(auth);
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('home page')).toBeInTheDocument());
    expect(auth.signIn).toHaveBeenCalledWith('person@thinkbigbrand.com', 'Secret123');
  });

  it('shows the server message for bad credentials and stays on the page', async () => {
    const auth = signedOut({ signIn: async () => ({ ok: false, message: 'Incorrect e-mail or password.' }) });
    renderLogin(auth);
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.type(screen.getByLabelText('Password'), 'wrong');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Incorrect e-mail or password.');
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('shows the real connection error instead of pretending to be signed in', async () => {
    const auth = signedOut({ signIn: async () => ({ ok: false, message: NETWORK_ERROR_MESSAGE }) });
    renderLogin(auth);
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect to the authentication server');
    expect(screen.queryByText('home page')).not.toBeInTheDocument();
  });

  it('returns to the page the visitor originally wanted', async () => {
    const auth = signedOut();
    renderLogin(auth, { pathname: '/login', state: { from: '/team' } });
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('team page')).toBeInTheDocument());
  });

  it('ignores an external destination smuggled into the redirect state', async () => {
    renderLogin(signedOut(), { pathname: '/login', state: { from: 'https://evil.example/steal' } });
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.type(screen.getByLabelText('Password'), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.getByText('home page')).toBeInTheDocument());
  });

  it('has no demo login and no offline mode', () => {
    renderLogin();
    expect(screen.queryByText(/demo/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/offline|local mode/i)).not.toBeInTheDocument();
  });

  it('links to registration and password reset', () => {
    renderLogin();
    expect(screen.getByRole('link', { name: /create an account/i })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: /forgot password/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('skips the form when already signed in', () => {
    renderLogin(makeAuth('EDITOR'));
    expect(screen.getByText('home page')).toBeInTheDocument();
  });
});

describe('Register page', () => {
  const renderRegister = (auth = signedOut()) =>
    renderWithAuth(
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/home" element={<Home />} />
      </Routes>,
      { auth, route: '/register' }
    );

  const fill = async (values: { name?: string; email?: string; password?: string; confirm?: string }) => {
    if (values.name !== undefined) await userEvent.type(screen.getByLabelText('Full name'), values.name);
    if (values.email !== undefined) await userEvent.type(screen.getByLabelText('Work e-mail'), values.email);
    if (values.password !== undefined) await userEvent.type(screen.getByLabelText('Password'), values.password);
    if (values.confirm !== undefined) await userEvent.type(screen.getByLabelText('Confirm password'), values.confirm);
  };

  it('has NO role picker: roles come only from invitations', () => {
    renderRegister();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByText(/role|admin|author|employee/i)).toBeInTheDocument(); // explanatory copy only
    expect(screen.queryByLabelText(/role/i)).not.toBeInTheDocument();
    expect(screen.getByText(/invited your e-mail address/i)).toBeInTheDocument();
  });

  it('enforces the password policy and matching confirmation', async () => {
    const auth = signedOut();
    renderRegister(auth);
    await fill({ name: 'New Hire', email: 'new@thinkbigbrand.com', password: 'short', confirm: 'different' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText(/at least 8 characters\./i, { selector: 'p#password-error' })).toBeInTheDocument();
    expect(screen.getByText('Passwords do not match.')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('requires a name and e-mail', async () => {
    const auth = signedOut();
    renderRegister(auth);
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Enter your full name.')).toBeInTheDocument();
    expect(screen.getByText('Enter your e-mail address.')).toBeInTheDocument();
    expect(auth.signUp).not.toHaveBeenCalled();
  });

  it('submits and tells the person to check their e-mail (without revealing whether the address existed)', async () => {
    const auth = signedOut();
    renderRegister(auth);
    await fill({ name: 'New Hire', email: 'new@thinkbigbrand.com', password: 'Secret123', confirm: 'Secret123' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByText('Check your e-mail')).toBeInTheDocument();
    expect(auth.signUp).toHaveBeenCalledWith('New Hire', 'new@thinkbigbrand.com', 'Secret123');
    expect(screen.getByRole('main')).toHaveTextContent(/If new@thinkbigbrand\.com is a new address/);
  });

  it('shows server errors', async () => {
    const auth = signedOut({ signUp: async () => ({ ok: false, message: NETWORK_ERROR_MESSAGE }) });
    renderRegister(auth);
    await fill({ name: 'New Hire', email: 'new@thinkbigbrand.com', password: 'Secret123', confirm: 'Secret123' });
    await userEvent.click(screen.getByRole('button', { name: 'Create account' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Unable to connect');
  });
});

describe('Forgot / reset password', () => {
  it('requests a reset link and confirms without revealing whether the account exists', async () => {
    const auth = signedOut();
    renderWithAuth(<ForgotPassword />, { auth });
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText(/If an account exists for/i)).toBeInTheDocument();
    expect(auth.requestPasswordReset).toHaveBeenCalledWith('person@thinkbigbrand.com');
  });

  it('validates the e-mail and surfaces errors', async () => {
    const auth = signedOut({ requestPasswordReset: async () => ({ ok: false, message: 'Too many attempts. Please wait a few minutes and try again.' }) });
    renderWithAuth(<ForgotPassword />, { auth });
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByText('Enter your e-mail address.')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('E-mail'), 'person@thinkbigbrand.com');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many attempts');
  });

  it('reset page without a recovery session says the link expired', () => {
    renderWithAuth(<ResetPassword />, { auth: signedOut() });
    expect(screen.getByText('Link expired')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /request a new link/i })).toHaveAttribute('href', '/forgot-password');
  });

  it('reset page waits while the link is being exchanged', () => {
    renderWithAuth(<ResetPassword />, { auth: signedOut({ status: 'loading', isLoading: true }) });
    expect(screen.getByText(/Checking your reset link/i)).toBeInTheDocument();
  });

  it('with a recovery session the new password is validated and saved', async () => {
    const auth = makeAuth(null);
    renderWithAuth(
      <Routes>
        <Route path="/" element={<ResetPassword />} />
        <Route path="/home" element={<Home />} />
      </Routes>,
      { auth }
    );
    await userEvent.type(screen.getByLabelText('New password'), 'weak');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'nope');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    expect(await screen.findByText('Passwords do not match.')).toBeInTheDocument();
    expect(auth.updatePassword).not.toHaveBeenCalled();

    await userEvent.clear(screen.getByLabelText('New password'));
    await userEvent.clear(screen.getByLabelText('Confirm new password'));
    await userEvent.type(screen.getByLabelText('New password'), 'Secret123');
    await userEvent.type(screen.getByLabelText('Confirm new password'), 'Secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Update password' }));
    await waitFor(() => expect(screen.getByText('home page')).toBeInTheDocument());
    expect(auth.updatePassword).toHaveBeenCalledWith('Secret123');
  });
});
