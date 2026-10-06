import React from 'react';
import { useCan } from '@/hooks/use-auth';
import type { Capability } from '@/lib/permissions';

interface CanProps {
  perform: Capability;
  children: React.ReactNode;
  /** Rendered instead when the capability is missing (defaults to nothing). */
  fallback?: React.ReactNode;
}

/**
 * Declarative capability gate, e.g. <Can perform="users:invite"><InviteForm /></Can>.
 * Hides interface only; the database enforces the same rules independently.
 */
const Can: React.FC<CanProps> = ({ perform, children, fallback = null }) => {
  const allowed = useCan(perform);
  return <>{allowed ? children : fallback}</>;
};

export default Can;
