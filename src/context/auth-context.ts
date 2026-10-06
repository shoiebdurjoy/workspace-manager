import { createContext } from 'react';
import type { MyMembership, Profile, TbbRole, Workspace } from '@/types/database';

/**
 * loading         - restoring the session / loading the account
 * unauthenticated - no valid Supabase session
 * authenticated   - session + active profile loaded
 * deactivated     - session is valid but the account was deactivated by an administrator
 * error           - the account could not be loaded (network, database). NEVER treated as signed in.
 */
export type AuthStatus = 'loading' | 'unauthenticated' | 'authenticated' | 'deactivated' | 'error';

export interface AuthUser {
  id: string;
  email: string;
}

export type ActionResult = { ok: true } | { ok: false; message: string };
export type SignUpResult =
  | { ok: true; needsConfirmation: boolean }
  | { ok: false; message: string };

export interface AuthContextValue {
  status: AuthStatus;
  isLoading: boolean;
  isAuthenticated: boolean;
  user: AuthUser | null;
  profile: Profile | null;
  memberships: MyMembership[];
  /** The membership the UI is currently working in (TBB is single-workspace: the first one). */
  activeMembership: MyMembership | null;
  workspace: Workspace | null;
  role: TbbRole | null;
  error: string | null;
  signIn: (email: string, password: string) => Promise<ActionResult>;
  signUp: (fullName: string, email: string, password: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<ActionResult>;
  updatePassword: (newPassword: string) => Promise<ActionResult>;
  /** Re-load profile and memberships (after editing the profile, creating a workspace, ...). */
  refresh: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);
