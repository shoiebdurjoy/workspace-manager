import React, { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import CustomFieldsManager from '@/components/settings/CustomFieldsManager';
import { useAuth } from '@/hooks/use-auth';
import { can } from '@/lib/permissions';
import { cn } from '@/lib/utils';
import StatusEditor from './StatusEditor';
import FeatureSwitches from './FeatureSwitches';
import AutomationsEditor from './AutomationsEditor';
import BriefFormsEditor from './BriefFormsEditor';
import TrashBin from './TrashBin';
import { TagsEditor } from '@/components/tags/Tags';

type Tab = 'statuses' | 'fields' | 'tags' | 'automations' | 'briefs' | 'trash' | 'features';

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
    { id: 'tags', label: 'Tags', show: canFields },
    { id: 'automations', label: 'Automations', show: canFields },
    { id: 'briefs', label: 'Brief forms', show: canFields },
    { id: 'trash', label: 'Trash', show: canFields },
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
          <span className="block text-xs text-muted-foreground">Statuses and moves, custom fields, tags, automations, client brief forms, the trash (restore anything deleted), and which features are switched on. Open only when you need it.</span>
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
              {tab === 'statuses' && isAdmin ? <StatusEditor /> : tab === 'features' && isAdmin ? <FeatureSwitches /> : tab === 'tags' ? <TagsEditor /> : tab === 'automations' ? <AutomationsEditor /> : tab === 'briefs' ? <BriefFormsEditor /> : tab === 'trash' ? <TrashBin /> : <CustomFieldsManager />}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
};

export default CustomizePanel;
