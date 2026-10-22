import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion } from 'framer-motion';
import { CheckCircle2, Loader2, Star } from 'lucide-react';
import { BrandMark } from '@/components/brand/Logo';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { getPublicBriefForm, submitBrief, type BriefField } from '@/database';
import { validateFieldValue } from '@/lib/custom-fields';
import { cn } from '@/lib/utils';

const SELECT = 'focus-soft h-10 w-full rounded-control border border-input bg-background px-3 text-sm outline-none';

/**
 * The public client brief page (/brief/<token>): no account, no app chrome. It can read exactly one form and send
 * briefs to it; the database turns each brief into a video in the right client list.
 */
const BriefPage: React.FC = () => {
  const { token = '' } = useParams();
  const form = useQuery({ queryKey: ['public-brief', token], queryFn: () => getPublicBriefForm(token), retry: false });
  const [title, setTitle] = useState('');
  const [brief, setBrief] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    document.title = form.data ? `${form.data.title} · Think Big Brand` : 'Video brief · Think Big Brand';
  }, [form.data]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.data) return;
    if (!title.trim()) return setError('Give the video a name.');
    const out: Record<string, unknown> = {};
    for (const f of form.data.fields) {
      const raw = f.type === 'labels' ? JSON.stringify((answers[f.id] ?? '').split('|').filter(Boolean)) : (answers[f.id] ?? '');
      const parsed = validateFieldValue(f.type, f.options, raw);
      if (!parsed.ok) return setError(`${f.name}: ${parsed.error}`);
      if (parsed.value === null) {
        if (f.required) return setError(`${f.name} is required.`);
        continue;
      }
      out[f.id] = parsed.value;
    }
    setError(null);
    setSending(true);
    try {
      await submitBrief(token, { formId: form.data.id, title, brief, contactName: name, contactEmail: email, answers: out });
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The brief could not be sent. Please try again.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="surface-canvas min-h-screen px-4 py-10 text-foreground">
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: 'easeOut' }} className="mx-auto max-w-xl space-y-6">
        <div className="flex items-center gap-3">
          <BrandMark size="sm" />
          <span className="text-sm font-semibold">Think Big Brand</span>
        </div>
        {form.isLoading ? (
          <div className="surface-card flex items-center gap-2 p-6 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Opening the form...</div>
        ) : !form.data ? (
          <div className="surface-card p-6">
            <h1 className="text-lg font-semibold">This form is not available</h1>
            <p className="mt-1 text-sm text-muted-foreground">The link may be wrong, or the form was closed. Please ask your contact at Think Big Brand for a new link.</p>
          </div>
        ) : sent ? (
          <motion.div initial={{ scale: 0.96, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="surface-card p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <h1 className="mt-3 text-lg font-semibold">Brief received</h1>
            <p className="mt-1 text-sm text-muted-foreground">Thank you. The team has it and will start on "{title.trim()}".</p>
            <Button type="button" variant="ghost" className="mt-4" onClick={() => { setSent(false); setTitle(''); setBrief(''); setAnswers({}); }}>Send another brief</Button>
          </motion.div>
        ) : (
          <form onSubmit={(e) => void send(e)} noValidate className="surface-card space-y-4 p-6">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">{form.data.title}</h1>
              {form.data.intro && <p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{form.data.intro}</p>}
            </div>
            <Labeled label="Video name" required>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="e.g. Spring promo, hook variation 2" className="h-10" />
            </Labeled>
            <Labeled label="What should the video be?">
              <Textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={5} maxLength={5000} placeholder="Goal, key message, style, references, music, deadline..." />
            </Labeled>
            {form.data.fields.map((f) => (
              <Labeled key={f.id} label={f.name} required={f.required}>
                <FieldInput field={f} value={answers[f.id] ?? ''} onChange={(v) => setAnswers((a) => ({ ...a, [f.id]: v }))} />
              </Labeled>
            ))}
            <div className="grid gap-3 sm:grid-cols-2">
              <Labeled label="Your name">
                <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} className="h-10" />
              </Labeled>
              <Labeled label="Your e-mail">
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={320} className="h-10" />
              </Labeled>
            </div>
            {error && <p role="alert" className="rounded-control bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>}
            <Button type="submit" className="w-full" disabled={sending}>
              {sending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Send brief
            </Button>
          </form>
        )}
      </motion.div>
    </div>
  );
};

const Labeled: React.FC<{ label: string; required?: boolean; children: React.ReactNode }> = ({ label, required, children }) => (
  <label className="block space-y-1.5">
    <span className="text-xs font-medium">
      {label}
      {required && <span className="ml-0.5 text-destructive">*</span>}
    </span>
    {children}
  </label>
);

const FieldInput: React.FC<{ field: BriefField; value: string; onChange: (v: string) => void }> = ({ field, value, onChange }) => {
  switch (field.type) {
    case 'dropdown':
      return (
        <select className={SELECT} value={value} onChange={(e) => onChange(e.target.value)}>
          <option value="">Choose...</option>
          {(field.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    case 'labels': {
      const picked = value.split('|').filter(Boolean);
      return (
        <div className="flex flex-wrap gap-1.5">
          {(field.options ?? []).map((o) => {
            const on = picked.includes(o);
            return (
              <button key={o} type="button" aria-pressed={on} onClick={() => onChange((on ? picked.filter((x) => x !== o) : [...picked, o]).join('|'))}
                className={cn('press rounded-full border px-3 py-1 text-xs', on ? 'border-primary/50 bg-primary/10' : 'border-border text-muted-foreground')}>
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'checkbox':
      return (
        <span className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={value === 'true'} onChange={(e) => onChange(e.target.checked ? 'true' : '')} className="h-4 w-4 accent-[hsl(var(--primary))]" /> Yes
        </span>
      );
    case 'rating':
      return (
        <span className="flex gap-1">
          {[1, 2, 3, 4, 5].map((n) => (
            <button key={n} type="button" aria-label={`${n} of 5`} onClick={() => onChange(value === String(n) ? '' : String(n))} className="press">
              <Star className={cn('h-5 w-5', Number(value) >= n ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/50')} />
            </button>
          ))}
        </span>
      );
    case 'date':
      return <Input type="date" value={value} onChange={(e) => onChange(e.target.value)} className="h-10" />;
    case 'long_text':
      return <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} />;
    default:
      return <Input value={value} onChange={(e) => onChange(e.target.value)} type={field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : 'text'} placeholder={field.type === 'url' ? 'https://' : ''} className="h-10" />;
  }
};

export default BriefPage;
