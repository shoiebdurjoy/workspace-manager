import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

/**
 * Brand token guard: the colour pairs people actually read must stay WCAG AA in both themes,
 * and the interface must not drift back to ad-hoc purple or scattered brand hex values.
 * Tokens are parsed straight from src/index.css, so editing a token re-runs the maths.
 */
const SRC = path.resolve(__dirname, '..');
const CSS = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8');

function block(selector: RegExp): Record<string, string> {
  const match = CSS.match(selector);
  if (!match) throw new Error(`block not found: ${selector}`);
  const tokens: Record<string, string> = {};
  for (const [, name, value] of match[1].matchAll(/--([a-z0-9-]+):\s*([^;]+);/g)) tokens[name] = value.trim();
  return tokens;
}

const LIGHT = block(/:root\s*\{([\s\S]*?)\n {2}\}/);
const DARK = block(/\n\s*\.dark\s*\{([\s\S]*?)\n {2}\}/);

/** "6 72% 48%" -> relative luminance (sRGB). */
function luminance(triplet: string): number {
  const [h, s, l] = triplet.split(/\s+/).map((v) => parseFloat(v));
  const sat = s / 100;
  const light = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sat * Math.min(light, 1 - light);
  const channel = (n: number) => light - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [channel(0), channel(8), channel(4)].map(lin);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const TEXT_PAIRS: Array<[string, string, string]> = [
  ['foreground on background', 'foreground', 'background'],
  ['foreground on card', 'foreground', 'card'],
  ['muted text on background', 'muted-foreground', 'background'],
  ['muted text on card', 'muted-foreground', 'card'],
  ['primary button label', 'primary-foreground', 'primary'],
  ['primary button hover label', 'primary-foreground', 'primary-hover'],
  ['primary button active label', 'primary-foreground', 'primary-active'],
  ['destructive button label', 'destructive-foreground', 'destructive'],
  ['brand link on background', 'brand', 'background'],
  ['brand link on card', 'brand', 'card'],
  ['brand text on brand-subtle badge', 'brand-subtle-foreground', 'brand-subtle'],
  ['sidebar text on sidebar', 'sidebar-foreground', 'sidebar-background'],
];

describe.each([
  ['light', LIGHT],
  ['dark', DARK],
])('%s theme brand tokens', (_theme, tokens) => {
  it.each(TEXT_PAIRS)('%s meets WCAG AA text contrast (4.5:1)', (_label, fg, bg) => {
    expect(tokens[fg], `missing token --${fg}`).toBeTruthy();
    expect(tokens[bg], `missing token --${bg}`).toBeTruthy();
    expect(contrast(tokens[fg], tokens[bg])).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps the focus ring and input border visible (3:1 against the page)', () => {
    expect(contrast(tokens.ring, tokens.background)).toBeGreaterThanOrEqual(3);
    expect(contrast(tokens.input, tokens.background)).toBeGreaterThanOrEqual(contrast(tokens.border, tokens.background));
  });

  it('defines every brand token', () => {
    for (const name of ['brand', 'brand-hover', 'brand-subtle', 'brand-subtle-foreground', 'brand-accent', 'primary-hover', 'primary-active']) {
      expect(tokens[name], `missing --${name}`).toBeTruthy();
    }
  });
});

describe('brand discipline in source', () => {
  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return entry.name === '__tests__' || entry.name === 'test' ? [] : walk(full);
      return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [full] : [];
    });
  }
  const FILES = walk(SRC);
  const rel = (f: string) => path.relative(SRC, f).split(path.sep).join('/');

  it('uses no purple/violet/indigo utility classes outside the status badge', () => {
    const offenders = FILES.filter((f) => /\b(?:bg|text|border|ring|from|to|via)-(?:purple|violet|indigo|fuchsia|tbb|workwise)-?\d*/.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .filter((r) => r !== 'components/ui/status-badge.tsx');
    expect(offenders).toEqual([]);
  });

  it('keeps the brand coral hex in one place (src/lib/brand.ts)', () => {
    const offenders = FILES.filter((f) => /#F25B4A/i.test(fs.readFileSync(f, 'utf8')))
      .map(rel)
      .filter((r) => r !== 'lib/brand.ts');
    expect(offenders).toEqual([]);
  });

  it('no longer ships the legacy purple default content colour', () => {
    const offenders = FILES.filter((f) => /#7B68EE/i.test(fs.readFileSync(f, 'utf8'))).map(rel);
    expect(offenders).toEqual([]);
  });
});
