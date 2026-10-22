import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import CustomFieldsManager from '@/components/settings/CustomFieldsManager';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import StatusEditor from './StatusEditor';
import FeatureSwitches from './FeatureSwitches';

type Tab = 'statuses' | 'fields' | 'features';

/**
 * "Customize workspace": tucked away until an admin opens it, so everyday screens stay clean. Statuses are
 * Owner / Admin only; custom fields follow the existing fields:manage permission.
 */
const CustomizePanel: React.FC = () => {
  const { role } = useAuth();
  const isAdmin = role === 'OWNER' || role === 'ADMIN';
  const canFields = can(role, 'fields:manage');
  const [open, setOpen] = useState(false);
  const tabs: { id: Tab; label: string; show: boolean }[] = [
    { id: 'statuses', label: 'Statuses & moves', show: isAdmin },
    { id: 'fields', label: 'Custom fields', show: canFields },
    { id: 'features', label: 'Features', show: isAdmin },
  ];
  const visible = tabs.filter((t) => t.show);
  const [tab, setTab] = useState<Tab>(visible[0]?.id ?? 'fields');
  if (visible.length === 0) return null;

  return (
    <section aria-label="Customize workspace" className="surface-card overflow-hidden">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="press flex w-full items-center gap-3 p-4 text-left hover:bg-muted/30"
      >
        <span className="stat-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-control">
          <SlidersHorizontal className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Customize workspace</span>
          <span className="block text-xs text-muted-foreground">Statuses and moves, custom fields, and which features are switched on. Open only when you need it.</span>
        </span>
        <ChevronDown aria-hidden className={cn('h-4 w-4 text-muted-foreground transition-transform duration-300', open && 'rotate-180')} />
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.25, ease: 'easeOut' }} className="overflow-hidden">
            <div className="space-y-4 border-t border-border/70 p-4">
              {visible.length > 1 && (
                <div role="tablist" aria-label="Customize" className="pill-group">
                  {visible.map((t) => (
                    <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => setTab(t.id)} className={cn('pill-item', tab === t.id && 'text-foreground')}>
                      {t.label}
                    </button>
                  ))}
                </div>
              )}
              {tab === 'statuses' && isAdmin ? <StatusEditor /> : tab === 'features' && isAdmin ? <FeatureSwitches /> : <CustomFieldsManager />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default CustomizePanel;
