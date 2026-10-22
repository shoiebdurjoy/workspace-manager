import { useCallback } from 'react';
import { useAuth } from '@/hooks/use-auth';
import { isFeatureOn, type FeatureKey } from '@/lib/features';

/** `on('reports')`: whether a feature is switched on in the current workspace. */
export function useFeatures() {
  const { workspace } = useAuth();
  return useCallback((key: FeatureKey) => isFeatureOn(workspace, key), [workspace]);
}
