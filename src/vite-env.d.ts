/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Supabase project URL (public). */
  VITE_SUPABASE_URL: string;
  /** Supabase publishable/anon key (public; protected by RLS). */
  VITE_SUPABASE_ANON_KEY: string;
  /**
   * Optional canonical public URL of this deployment (https origin), used in e-mail links.
   * Leave unset locally; set it in Vercel for production / custom domains.
   */
  VITE_APP_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
