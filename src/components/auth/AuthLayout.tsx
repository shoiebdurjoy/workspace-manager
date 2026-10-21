import React, { useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { CheckCircle2, Clapperboard, Eye, EyeOff, Film, Sparkles } from 'lucide-react';
import { BrandLockup, BrandMark } from '@/components/brand/Logo';
import { BRAND } from '@/lib/brand';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';

interface AuthLayoutProps {
  title: string;
  description?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** A glass card that floats gently on the brand side (decorative; hidden from assistive tech). */
const FloatCard: React.FC<{ className?: string; delay?: number; drift?: number; children: React.ReactNode }> = ({ className, delay = 0, drift = 10, children }) => {
  const reduce = useReducedMotion();
  return (
    <motion.div
      aria-hidden
      initial={reduce ? false : { opacity: 0, y: 24, scale: 0.96 }}
      animate={reduce ? undefined : { opacity: 1, y: [0, -drift, 0], scale: 1 }}
      transition={reduce ? undefined : { opacity: { duration: 0.7, delay, ease: EASE }, scale: { duration: 0.7, delay, ease: EASE }, y: { duration: 6 + delay * 2, repeat: Infinity, ease: 'easeInOut', delay } }}
      className={cn('auth-glass-card absolute', className)}
    >
      {children}
    </motion.div>
  );
};

/** The brand side: a living gradient, the mark with a glow, the promise, and floating product glimpses. */
const BrandSide: React.FC = () => (
  <aside className="auth-brand relative hidden overflow-hidden lg:flex lg:w-[52%] lg:flex-col lg:justify-between lg:p-12">
    <div aria-hidden className="auth-orb auth-orb-a" />
    <div aria-hidden className="auth-orb auth-orb-b" />
    <div aria-hidden className="auth-grid" />

    <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="relative z-10 flex items-center gap-3">
      <span className="auth-logo-glow rounded-2xl bg-white/95 p-2.5">
        <BrandMark size="md" />
      </span>
      <span className="text-sm font-semibold tracking-tight text-white/90">{BRAND.company}</span>
    </motion.div>

    <div className="relative z-10 max-w-md">
      <motion.h2
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.1, ease: EASE }}
        className="text-[2.6rem] font-semibold leading-[1.05] tracking-[-0.035em] text-white"
      >
        Every video, from brief to client, in one place.
      </motion.h2>
      <motion.p initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.8, delay: 0.2, ease: EASE }} className="mt-4 text-[15px] leading-relaxed text-white/70">
        Editors, QC and producers on the same pipeline: who is cutting what, what waits for QC, and what is ready to send.
      </motion.p>
    </div>

    {/* floating product glimpses */}
    <div className="relative z-10 h-60">
      <FloatCard className="left-0 top-2 w-64 p-3.5" delay={0.25}>
        <div className="flex items-center gap-2 text-[11px] font-semibold text-white/60">
          <Clapperboard className="h-3.5 w-3.5" /> CONTENT PIPELINE · ZIM
        </div>
        <p className="mt-1.5 text-sm font-semibold text-white">Medicus Elite · Video 3</p>
        <div className="mt-2.5 flex items-center justify-between">
          <span className="rounded-full bg-amber-400/20 px-2 py-0.5 text-[10px] font-bold tracking-wide text-amber-200">QC · FIRST APPROVAL</span>
          <span className="flex -space-x-1.5">
            {['#f97316', '#3b82f6', '#22c55e'].map((c) => (
              <span key={c} className="h-5 w-5 rounded-full ring-2 ring-[#2a1f1b]" style={{ background: c }} />
            ))}
          </span>
        </div>
      </FloatCard>

      <FloatCard className="right-6 top-0 w-48 p-3.5" delay={0.45} drift={14}>
        <p className="text-[11px] font-semibold text-white/60">This batch</p>
        <div className="mt-2 flex items-center gap-3">
          <svg viewBox="0 0 36 36" className="h-12 w-12 -rotate-90">
            <circle cx="18" cy="18" r="15" fill="none" stroke="rgba(255,255,255,0.15)" strokeWidth="4" />
            <motion.circle
              cx="18"
              cy="18"
              r="15"
              fill="none"
              stroke="#fb923c"
              strokeWidth="4"
              strokeLinecap="round"
              strokeDasharray="94.2"
              initial={{ strokeDashoffset: 94.2 }}
              animate={{ strokeDashoffset: 94.2 * 0.2 }}
              transition={{ duration: 1.6, delay: 0.8, ease: EASE }}
            />
          </svg>
          <div>
            <p className="text-xl font-semibold leading-none text-white">8 / 10</p>
            <p className="text-[11px] text-white/60">videos done</p>
          </div>
        </div>
      </FloatCard>

      <FloatCard className="bottom-0 left-24 w-72 p-3" delay={0.65} drift={8}>
        <div className="flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-emerald-400/20 text-emerald-300">
            <CheckCircle2 className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[13px] font-semibold text-white">QC approved · ready to deliver</p>
            <p className="text-[11px] text-white/55">Founder story · just now</p>
          </div>
          <Sparkles className="ml-auto h-4 w-4 text-amber-200/80" />
        </div>
      </FloatCard>
    </div>

    <p className="relative z-10 flex items-center gap-2 text-[11px] text-white/45">
      <Film className="h-3.5 w-3.5" /> {BRAND.company} · Internal workspace
    </p>
  </aside>
);

/**
 * Every signed-out screen: an animated brand side (large screens) and a glass form card that rises in.
 */
const AuthLayout: React.FC<AuthLayoutProps> = ({ title, description, children, footer }) => (
  <div className="auth-shell flex min-h-screen w-full">
    <BrandSide />
    <div className="relative flex flex-1 flex-col items-center justify-center px-5 py-10">
      <div aria-hidden className="auth-form-glow" />
      <div className="relative mb-8 lg:hidden">
        <span className="auth-logo-glow inline-flex rounded-2xl">
          <BrandLockup size="md" />
        </span>
      </div>
      <motion.main
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.6, ease: EASE }}
        className="auth-form-card relative w-full max-w-[25rem] p-7 sm:p-9"
      >
        <div className="mb-7 space-y-1.5">
          <h1 className="text-[1.75rem] font-semibold leading-tight tracking-[-0.03em] text-foreground">{title}</h1>
          {description && <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {children}
      </motion.main>
      {footer && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.5 }} className="relative mt-6 text-center text-sm text-muted-foreground">
          {footer}
        </motion.div>
      )}
      <p className="relative mt-8 text-[11px] text-muted-foreground lg:hidden">{BRAND.company} · Internal workspace</p>
    </div>
  </div>
);

export default AuthLayout;

/** A text field with a leading icon, used by the auth forms. Password fields get a show / hide toggle. */
export const IconField = React.forwardRef<HTMLInputElement, React.ComponentProps<typeof Input> & { icon: React.ComponentType<{ className?: string }> }>(
  ({ icon: Icon, className, type, ...props }, ref) => {
    const [show, setShow] = useState(false);
    const isPassword = type === 'password';
    return (
      <div className="auth-field group relative">
        <Icon className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
        <Input ref={ref} type={isPassword && show ? 'text' : type} className={cn('h-11 rounded-xl pl-10 text-[15px]', isPassword && 'pr-11', className)} {...props} />
        {isPassword && (
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-label={show ? 'Hide password' : 'Show password'}
            className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        )}
      </div>
    );
  }
);
IconField.displayName = 'IconField';

export const FormError: React.FC<{ message: string | null }> = ({ message }) =>
  message ? (
    <motion.div
      role="alert"
      initial={{ opacity: 0, y: -4, x: 0 }}
      animate={{ opacity: 1, y: 0, x: [0, -6, 6, -4, 4, 0] }}
      transition={{ duration: 0.45 }}
      className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-xs text-destructive"
    >
      {message}
    </motion.div>
  ) : null;

export const FieldError: React.FC<{ id: string; message?: string | null }> = ({ id, message }) =>
  message ? (
    <p id={id} className="text-[11px] text-destructive">
      {message}
    </p>
  ) : null;

/** The official-style Google mark (four colors), inline so no network request is needed. */
const GoogleMark: React.FC = () => (
  <svg viewBox="0 0 48 48" className="h-[18px] w-[18px]" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
    <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
    <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
  </svg>
);

/** "Continue with Google": access still comes only from an invitation to that Google e-mail. */
export const GoogleButton: React.FC<{ onClick: () => void; busy?: boolean; label?: string }> = ({ onClick, busy, label = 'Continue with Google' }) => (
  <button
    type="button"
    onClick={onClick}
    disabled={busy}
    className="press group relative flex h-11 w-full items-center justify-center gap-2.5 rounded-xl border border-border bg-background/80 text-[15px] font-medium text-foreground shadow-[0_1px_2px_hsl(0_0%_0%/0.06)] hover:-translate-y-px hover:bg-background hover:shadow-[0_8px_20px_-10px_hsl(0_0%_0%/0.35)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
  >
    <GoogleMark />
    {label}
  </button>
);

/** "or" between Google and the e-mail form. */
export const OrDivider: React.FC = () => (
  <div className="flex items-center gap-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
    <span className="h-px flex-1 bg-border" />
    or with e-mail
    <span className="h-px flex-1 bg-border" />
  </div>
);
