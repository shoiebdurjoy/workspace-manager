import React from 'react';
import { BrandLockup } from '@/components/brand/Logo';
import { BRAND } from '@/lib/brand';

interface AuthLayoutProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

/**
 * Every signed-out screen: the real TBB logo above a quiet card. The logo carries the brand;
 * the rest stays neutral so the single coral action stands out.
 */
const AuthLayout: React.FC<AuthLayoutProps> = ({ title, description, children, footer }) => (
  <div className="surface-canvas flex min-h-screen w-full flex-col items-center px-4 py-10 sm:justify-center">
    <div className="mb-8 mt-4 sm:mt-0">
      <BrandLockup size="md" />
    </div>
    <main className="surface-card motion-pop w-full max-w-sm p-6 sm:p-8">
      <div className="mb-6 space-y-1">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-description leading-relaxed">{description}</p>}
      </div>
      {children}
    </main>
    {footer && <div className="mt-5 text-center text-xs text-muted-foreground">{footer}</div>}
    <p className="mt-8 text-[11px] text-muted-foreground">
      {BRAND.company} · Internal workspace
    </p>
  </div>
);

export default AuthLayout;

export const FormError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <div
      role="alert"
      className="rounded-control border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
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
