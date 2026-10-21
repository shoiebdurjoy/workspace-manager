/**
 * Fuzzy name matching for the built-in assistant: "connectors" finds "1. THE CONNECTORS", "myla" finds
 * "CONTENT PIPELINE - MYLA", "vast media" finds "2. VAST MEDIA CONTENT - MATT". No external service.
 */

const STOP = new Set(['the', 'a', 'an', 'of', 'for', 'list', 'client', 'folder', 'content', 'pipeline', 'video', 'videos', 'task']);

/** "12. THE CONNECTORS!" -> "the connectors" */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/^\s*\d+\.\s*/, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[-\s]+/g, ' ')
    .trim();
}

const tokens = (text: string) => normalize(text).split(' ').filter((t) => t && !STOP.has(t));

/** 0..1: how well `query` names `candidate`. Exact > whole-phrase containment > shared words (with prefixes). */
export function similarity(query: string, candidate: string): number {
  const q = normalize(query);
  const c = normalize(candidate);
  if (!q || !c) return 0;
  if (q === c) return 1;
  if (c.includes(q) && q.length >= 3) return 0.9;
  if (q.includes(c) && c.length >= 3) return 0.85;
  const qt = tokens(query);
  const ct = tokens(candidate);
  if (qt.length === 0 || ct.length === 0) return 0;
  let hits = 0;
  for (const t of qt) if (ct.some((w) => w === t || (t.length >= 3 && (w.startsWith(t) || t.startsWith(w))))) hits += 1;
  return (hits / qt.length) * 0.8 * Math.min(1, (hits + 1) / Math.max(1, ct.length));
}

export interface Match<T> {
  item: T;
  score: number;
}

/** The best candidate above `min`, or null; `ambiguous` when a second one scores almost the same. */
export function bestMatch<T>(query: string, items: T[], name: (t: T) => string, min = 0.45): (Match<T> & { ambiguous: T[] }) | null {
  const scored = items.map((item) => ({ item, score: similarity(query, name(item)) })).filter((m) => m.score >= min);
  scored.sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored[0];
  const ambiguous = scored.slice(1).filter((m) => m.score >= top.score - 0.02 && top.score < 1).map((m) => m.item);
  return { ...top, ambiguous };
}
