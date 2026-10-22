import type { Workspace } from '@/types/database';

/**
 * Feature switches (Settings > Customize workspace > Features), like ClickUp's ClickApps. Stored as
 * workspaces.settings.features = { feature: false } for what an Owner / Admin switched off; missing means ON.
 * Switching off only hides a feature; its data stays and comes back when it is switched on again.
 */
export type FeatureKey =
  | 'priorities'
  | 'client_deadline'
  | 'aspect_ratio'
  | 'production_links'
  | 'custom_fields'
  | 'subtasks'
  | 'batch_videos'
  | 'availability'
  | 'assistant'
  | 'calendar'
  | 'workload'
  | 'reports'
  | 'production'
  | 'tags'
  | 'recurring'
  | 'dependencies'
  | 'time_tracking';

export const FEATURES: { key: FeatureKey; group: 'Tasks' | 'Team' | 'Pages'; label: string; hint: string }[] = [
  { key: 'priorities', group: 'Tasks', label: 'Priorities', hint: 'Urgent / High / Normal / Low on every video' },
  { key: 'client_deadline', group: 'Tasks', label: 'Client deadline', hint: 'A second date next to the internal QC due date' },
  { key: 'aspect_ratio', group: 'Tasks', label: 'Aspect ratio', hint: '9:16, 16:9, 1:1 ... on every video' },
  { key: 'production_links', group: 'Tasks', label: 'Production links', hint: 'Raw footage, project file, review link, final export' },
  { key: 'custom_fields', group: 'Tasks', label: 'Custom fields', hint: 'The Fields section on each video' },
  { key: 'subtasks', group: 'Tasks', label: 'Subtasks', hint: 'Checklist steps inside a video' },
  { key: 'tags', group: 'Tasks', label: 'Tags', hint: 'Coloured tags such as Reshoot or Urgent client' },
  { key: 'recurring', group: 'Tasks', label: 'Recurring videos', hint: 'Repeat a video every N days, weeks or months' },
  { key: 'dependencies', group: 'Tasks', label: 'Dependencies', hint: 'A video can wait on other videos' },
  { key: 'time_tracking', group: 'Tasks', label: 'Time tracking', hint: 'Timers, logged time and estimates on videos' },
  { key: 'batch_videos', group: 'Tasks', label: 'Batch videos', hint: 'Child videos under a batch task' },
  { key: 'availability', group: 'Team', label: 'Availability status', hint: 'Free / Working / Busy / On leave in the top bar' },
  { key: 'assistant', group: 'Team', label: 'Built-in assistant', hint: 'Ask AI (Ctrl+J) for owners, admins and managers' },
  { key: 'calendar', group: 'Pages', label: 'Calendar', hint: 'Deadlines on a month calendar' },
  { key: 'workload', group: 'Pages', label: 'Workload', hint: 'Who carries how much open work' },
  { key: 'reports', group: 'Pages', label: 'Reports', hint: 'Output, turnaround and revisions per client' },
  { key: 'production', group: 'Pages', label: 'Production', hint: 'Videos credited per editor per month' },
];

export function featureFlags(workspace: Pick<Workspace, 'settings'> | null | undefined): Partial<Record<FeatureKey, boolean>> {
  const raw = (workspace?.settings as { features?: unknown } | undefined)?.features;
  return raw && typeof raw === 'object' ? (raw as Partial<Record<FeatureKey, boolean>>) : {};
}

/** On unless an admin switched it off. */
export function isFeatureOn(workspace: Pick<Workspace, 'settings'> | null | undefined, key: FeatureKey): boolean {
  return featureFlags(workspace)[key] !== false;
}
