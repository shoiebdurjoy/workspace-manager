import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import Logo, { BrandLockup, BrandMark } from '../Logo';
import { BRAND, BRAND_ASSETS, LOCKUP_SIZE, MARK_SIZE } from '@/lib/brand';

describe('brand artwork', () => {
  it('renders the real lockup with an accessible name and its own aspect ratio', () => {
    render(<BrandLockup size="md" />);
    const img = screen.getByRole('img', { name: BRAND.company });
    expect(img).toHaveAttribute('src', BRAND_ASSETS.lockup);
    const w = Number(img.getAttribute('width'));
    const h = Number(img.getAttribute('height'));
    expect(h).toBe(Math.round((w * LOCKUP_SIZE.height) / LOCKUP_SIZE.width));
  });

  it('renders the mark as decorative unless it is given a label, never stretched', () => {
    const { container } = render(<BrandMark size="lg" />);
    const img = container.querySelector('img')!;
    expect(img).toHaveAttribute('src', BRAND_ASSETS.mark);
    expect(img).toHaveAttribute('alt', '');
    expect(img).toHaveAttribute('aria-hidden', 'true');
    const w = Number(img.getAttribute('width'));
    expect(Number(img.getAttribute('height'))).toBe(Math.round((w * MARK_SIZE.height) / MARK_SIZE.width));
  });

  it('gives a labelled mark an accessible name', () => {
    render(<BrandMark label="TBB" />);
    expect(screen.getByRole('img', { name: 'TBB' })).toBeInTheDocument();
  });

  it('shows the product name beside the mark, and the mark alone when collapsed', () => {
    const { rerender } = render(<Logo />);
    expect(screen.getByText('TBB')).toBeInTheDocument();
    expect(screen.getByText('Workspace')).toBeInTheDocument();
    rerender(<Logo showText={false} />);
    expect(screen.queryByText('Workspace')).not.toBeInTheDocument();
  });

  it('points only at assets that exist in /public', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    for (const asset of Object.values(BRAND_ASSETS)) {
      expect(fs.existsSync(path.resolve(__dirname, '../../../../public', asset.replace(/^\//, '')))).toBe(true);
    }
  });
});
