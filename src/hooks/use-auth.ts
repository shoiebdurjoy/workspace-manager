import { useContext } from 'react';
import { AuthContext, AuthContextValue } from '@/context/auth-context';
import { can, Capability } from '@/lib/permissions';

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}

/** UI capability check for the current workspace role (database RLS remains the real gate). */
export function useCan(capability: Capability): boolean {
  const { role } = useAuth();
  return can(role, capability);
}
