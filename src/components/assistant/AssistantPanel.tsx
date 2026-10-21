import React, { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowUp, CheckCircle2, Loader2, RotateCcw, Sparkles } from 'lucide-react';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { getSupabaseClient } from '@/database/client';
import { useAuth } from '@/hooks/use-auth';
import { cn } from '@/lib/utils';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  actions?: string[];
  error?: boolean;
}

const MANAGERS = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'];
// the conversation stays on this device only (it never goes to the database)
const ASSISTANT_CHAT_STORAGE_KEY = 'tbb-assistant-chat';

const SUGGESTIONS = [
  'Which clients have the most open videos?',
  'What is waiting for QC right now, and with whom?',
  'Shift THE CONNECTORS from Zim to Myla',
  'Make Zim the QC for the CONTENT PIPELINE - ZIM folder',
  'Which videos are overdue?',
];

const load = (): Message[] => {
  try {
    const raw = localStorage.getItem(ASSISTANT_CHAT_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
};

/**
 * The admin assistant: ask anything about the workspace in plain language, or tell it to change something. It runs
 * as the signed-in person (the database's rules apply), so it can do only what they could do themselves. The
 * conversation stays in this browser; nothing about it is stored in the database.
 */
export const AssistantButton: React.FC = () => {
  const { role, workspace } = useAuth();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>(load);
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      localStorage.setItem(ASSISTANT_CHAT_STORAGE_KEY, JSON.stringify(messages.slice(-40)));
    } catch {
      // private window: the chat simply is not kept
    }
    end.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [messages, busy]);

  // Ctrl+J / Cmd+J opens it from anywhere
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!role || !MANAGERS.includes(role)) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const next: Message[] = [...messages, { role: 'user', content: question }];
    setMessages(next);
    setDraft('');
    setBusy(true);
    try {
      const { data, error } = await getSupabaseClient().functions.invoke('admin-assistant', {
        body: { workspaceId: workspace?.id, messages: next.filter((m) => !m.error).map(({ role: r, content }) => ({ role: r, content })) },
      });
      if (error) {
        // the function answers {error} with a readable reason (not set up, no permission, ...): show it
        const ctx = (error as { context?: Response }).context;
        let reason: string | undefined;
        try {
          reason = ctx ? (JSON.parse(await ctx.clone().text()) as { error?: string }).error : undefined;
        } catch {
          reason = undefined;
        }
        throw new Error(reason ?? 'The assistant could not be reached.');
      }
      setMessages((m) => [...m, { role: 'assistant', content: data.reply, actions: data.actions }]);
      if (data.actions?.length) void queryClient.invalidateQueries();
    } catch (e) {
      setMessages((m) => [...m, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong.', error: true }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ask the AI assistant (Ctrl+J)"
        title="Ask AI (Ctrl+J)"
        className="press group inline-flex h-8 items-center gap-1.5 rounded-full border border-border/70 bg-gradient-to-r from-primary/15 to-primary/5 px-3 text-xs font-medium text-foreground transition-shadow hover:shadow-float"
      >
        <Sparkles aria-hidden className="h-3.5 w-3.5 text-primary transition-transform duration-300 group-hover:rotate-12 group-hover:scale-110" />
        <span className="hidden sm:inline">Ask AI</span>
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
          <SheetHeader className="border-b border-border/70 px-4 py-3 text-left">
            <div className="flex items-center justify-between gap-2">
              <SheetTitle className="flex items-center gap-2 text-base">
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary/70 text-white shadow-float">
                  <Sparkles aria-hidden className="h-3.5 w-3.5" />
                </span>
                TBB Assistant
              </SheetTitle>
              {messages.length > 0 && (
                <button type="button" onClick={() => setMessages([])} className="press mr-8 inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted">
                  <RotateCcw aria-hidden className="h-3 w-3" /> New chat
                </button>
              )}
            </div>
            <SheetDescription className="text-xs">Ask anything about your workspace, or tell it what to change. It can only do what you can do.</SheetDescription>
          </SheetHeader>

          <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 && (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Try:</p>
                {SUGGESTIONS.map((s, i) => (
                  <motion.button
                    key={s}
                    type="button"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05, ease: 'easeOut' }}
                    onClick={() => void send(s)}
                    className="press block w-full rounded-card border border-border/70 px-3 py-2 text-left text-sm hover:border-primary/40 hover:bg-muted/60"
                  >
                    {s}
                  </motion.button>
                ))}
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((m, i) => (
                <motion.div
                  key={i}
                  initial={{ opacity: 0, y: 8, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ duration: 0.22, ease: 'easeOut' }}
                  className={cn('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}
                >
                  <div
                    className={cn(
                      'max-w-[88%] whitespace-pre-wrap rounded-2xl px-3 py-2 text-sm leading-relaxed',
                      m.role === 'user' ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-muted',
                      m.error && 'border border-destructive/40 bg-destructive/10 text-destructive'
                    )}
                  >
                    {m.content}
                    {m.actions && m.actions.length > 0 && (
                      <ul className="mt-2 space-y-1 border-t border-border/60 pt-2">
                        {m.actions.map((a, j) => (
                          <li key={j} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                            <CheckCircle2 aria-hidden className="mt-0.5 h-3 w-3 shrink-0 text-emerald-500" />
                            {a}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
            {busy && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
                <Loader2 aria-hidden className="h-3.5 w-3.5 animate-spin" /> Working on it...
              </div>
            )}
            <div ref={end} />
          </div>

          <form
            className="border-t border-border/70 p-3"
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
          >
            <div className="focus-soft flex items-end gap-2 rounded-card border border-input bg-background px-3 py-2">
              <textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    void send(draft);
                  }
                }}
                rows={1}
                placeholder="Ask or tell the assistant..."
                aria-label="Message the assistant"
                className="max-h-32 min-h-[1.5rem] flex-1 resize-none bg-transparent text-sm outline-none"
              />
              <button
                type="submit"
                disabled={busy || !draft.trim()}
                aria-label="Send"
                className="press flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-40"
              >
                <ArrowUp aria-hidden className="h-4 w-4" />
              </button>
            </div>
          </form>
        </SheetContent>
      </Sheet>
    </>
  );
};

export default AssistantButton;
