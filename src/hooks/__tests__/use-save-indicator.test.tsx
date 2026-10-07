import { describe, it, expect, vi, afterEach } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useSaveIndicator } from '../use-save-indicator';

afterEach(() => vi.useRealTimers());

const deferred = <T,>() => {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe('useSaveIndicator', () => {
  it('is idle, then saving while work is in flight, then saved, then idle again', async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() => useSaveIndicator(1000));
    expect(result.current.state).toBe('idle');
    const work = deferred<string>();
    let outcome: Promise<string> = Promise.resolve('');
    act(() => {
      outcome = result.current.track(work.promise);
    });
    expect(result.current.state).toBe('saving');
    await act(async () => {
      work.resolve('done');
      await outcome;
    });
    expect(result.current.state).toBe('saved');
    expect(await outcome).toBe('done');
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current.state).toBe('idle');
  });

  it('stays "saving" until every overlapping save has finished', async () => {
    const { result } = renderHook(() => useSaveIndicator());
    const a = deferred<void>();
    const b = deferred<void>();
    let pa: Promise<void> = Promise.resolve();
    let pb: Promise<void> = Promise.resolve();
    act(() => {
      pa = result.current.track(a.promise);
      pb = result.current.track(b.promise);
    });
    await act(async () => {
      a.resolve();
      await pa;
    });
    expect(result.current.state).toBe('saving');
    await act(async () => {
      b.resolve();
      await pb;
    });
    expect(result.current.state).toBe('saved');
  });

  it('reports a failure and re-throws it so the caller can react; the next save clears it', async () => {
    const { result } = renderHook(() => useSaveIndicator());
    const failing = deferred<void>();
    let outcome: Promise<void> = Promise.resolve();
    act(() => {
      outcome = result.current.track(failing.promise);
    });
    await act(async () => {
      failing.reject(new Error('refused'));
      await expect(outcome).rejects.toThrow('refused');
    });
    expect(result.current.state).toBe('error');
    const ok = deferred<void>();
    let next: Promise<void> = Promise.resolve();
    act(() => {
      next = result.current.track(ok.promise);
    });
    expect(result.current.state).toBe('saving');
    await act(async () => {
      ok.resolve();
      await next;
    });
    expect(result.current.state).toBe('saved');
  });
});
