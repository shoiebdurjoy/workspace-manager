import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Automated "No Mock Data Leak" audit (docs/TBB_TESTING_STRATEGY.md 3): production source must
 * not contain fake authentication, offline fallbacks, demo accounts or hard-coded dummy data.
 */
const SRC = path.resolve(__dirname, '..');

function walk(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'test' ? [] : walk(full);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

const FILES = walk(SRC).filter((f) => !f.endsWith(`pages${path.sep}DesignSystemShowcase.tsx`));

/** Files allowed to contain a pattern (the single, reviewed place that owns that concern). */
const ALLOWED: Record<string, string[]> = {
  'hard-coded host in auth code (use getAppUrl)': [`lib${path.sep}app-url.ts`],
};

const FORBIDDEN: Array<[string, RegExp]> = [
  ['offline mode flag', /isOfflineMode/],
  ['demo login', /demoLogin|demo[_-]?login/i],
  ['demo seed data', /DEMO_SEED|DEMO_HIERARCHY|mockTasks|mockUsers|mockWorkspaces/],
  ['mock data module', /mockData/],
  ['legacy fake session key', /workwise_current_user/],
  ['localStorage user/session storage', /localStorage\.(set|get)Item\(\s*['"`](?!tbb_sidebar_collapsed|theme)[^'"`]*(user|session|token|auth)/i],
  ['legacy two-role enum', /\bUserRole\b|AUTHOR|EMPLOYEE/],
  ['service-role key in browser code', /service_role|SERVICE_ROLE|sb_secret_/],
  ['hard-coded Supabase JWT or publishable key', /eyJ[A-Za-z0-9_-]{20,}\.|sb_publishable_[A-Za-z0-9_-]{20,}/],
  ['hard-coded host in auth code (use getAppUrl)', /(?:localhost|127\.0\.0\.1|vercel\.app)/],
  ['fake notification copy', /10 minutes ago|1 hour ago/],
  ['fake demo clients', /EDAPTX|Shorts Episode|KRAV_FITNESS/],
];

describe('no mock data or fake auth in production source', () => {
  it('scans a meaningful amount of source', () => {
    expect(FILES.length).toBeGreaterThan(40);
  });

  for (const [name, pattern] of FORBIDDEN) {
    it(`has no ${name}`, () => {
      const offenders = FILES.filter((f) => pattern.test(fs.readFileSync(f, 'utf8')))
        .map((f) => path.relative(SRC, f))
        .filter((rel) => !(ALLOWED[name] ?? []).includes(rel));
      expect(offenders).toEqual([]);
    });
  }

  it('browser storage is limited to UI preferences (sidebar collapsed/expanded, theme, per-list task view) and the Supabase session', () => {
    const uses = FILES.flatMap((f) => {
      const text = fs.readFileSync(f, 'utf8');
      return [...text.matchAll(/(?:localStorage|sessionStorage)\.(?:set|get|remove)Item\(\s*([^,)]+)/g)].map((m) => `${path.relative(SRC, f)}: ${m[1].trim()}`);
    });
    for (const use of uses) expect(use).toMatch(/SIDEBAR_COLLAPSED_STORAGE_KEY|SIDEBAR_EXPANDED_STORAGE_KEY|taskViewStorageKey|'theme'|"theme"/);
  });
});
