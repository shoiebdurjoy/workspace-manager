export interface DatabaseConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  isConfigured: boolean;
  validationError: string | null;
}

/**
 * Validates and retrieves the Supabase database environment configuration.
 * Never fabricates replacement credentials or claims healthy status when
 * credentials are missing or placeholder tokens.
 */
export function getDatabaseConfig(): DatabaseConfig {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim() || '';
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() || '';

  if (!url || !anonKey) {
    return {
      supabaseUrl: '',
      supabaseAnonKey: '',
      isConfigured: false,
      validationError: 'Missing required environment configuration: VITE_SUPABASE_URL and/or VITE_SUPABASE_ANON_KEY are not set.',
    };
  }

  // Detect placeholder tokens from setup templates
  const isPlaceholderUrl =
    url === 'https://placeholder.supabase.co' ||
    url.includes('your_supabase_project_url') ||
    url.includes('placeholder');
  const isPlaceholderKey =
    anonKey === 'placeholder' ||
    anonKey.includes('your_supabase_anon_key');

  if (isPlaceholderUrl || isPlaceholderKey) {
    return {
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      isConfigured: false,
      validationError: 'Placeholder Supabase credentials detected. A valid Supabase project URL and anon key are required.',
    };
  }

  // Validate URL syntax
  try {
    const parsed = new URL(url);
    if (!parsed.protocol.startsWith('http')) {
      return {
        supabaseUrl: url,
        supabaseAnonKey: anonKey,
        isConfigured: false,
        validationError: `Invalid protocol in Supabase URL: "${parsed.protocol}". Expected http: or https:`,
      };
    }
  } catch {
    return {
      supabaseUrl: url,
      supabaseAnonKey: anonKey,
      isConfigured: false,
      validationError: `Malformed Supabase URL: "${url}". Expected valid URL format (e.g. https://<project>.supabase.co).`,
    };
  }

  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    isConfigured: true,
    validationError: null,
  };
}
