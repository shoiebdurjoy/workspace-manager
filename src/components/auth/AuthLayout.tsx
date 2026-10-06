import React from 'react';
import Logo from '@/components/brand/Logo';

interface AuthLayoutProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/** Compact, centred card used by every signed-out screen. */
const AuthLayout: React.FC<AuthLayoutProps> = ({ title, description, children, footer }) => (
  <div className="flex min-h-screen w-full flex-col items-center justify-center bg-muted/30 px-4 py-10">
    <div className="mb-6">
      <Logo size="md" />
    </div>
    <main className="w-full max-w-sm rounded-xl border border-border/70 bg-card p-6 shadow-sm">
      <div className="mb-5 space-y-1">
        <h1 className="text-lg font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
      </div>
      {children}
    </main>
    {footer && <div className="mt-4 text-center text-xs text-muted-foreground">{footer}</div>}
    <p className="mt-8 text-[11px] text-muted-foreground/80">Think Big Brand · Internal workspace</p>
  </div>
);

export default AuthLayout;

export const FormError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div
      role="alert"
      className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
    >
      {message}
    </div>
  ) : null;

export const FieldError: React.FC<{ id: string; message?: string | null }> = ({ id, message }) =>
  message ? (
    <p id={id} className="text-[11px] text-destructive">
      {message}
    </p>
  ) : null;
