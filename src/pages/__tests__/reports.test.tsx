import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import ReportsPage from '@/pages/ReportsPage';
import { makeAuth, renderWithAuth } from '@/test/auth-utils';
import type { createDatabaseMock } from '@/test/database-mock';
import * as dbModule from '@/database';
import { mapKpiReport } from '@/database/reports';

vi.mock('@/database', async () => (await import('@/test/database-mock')).createDatabaseMock());
vi.mock('recharts', async () => {
  const React = await import('react');
  const Pass = ({ children }: { children?: React.ReactNode }) => <div>{children}</div>;
  return { ResponsiveContainer: Pass, AreaChart: Pass, BarChart: Pass, Area: () => null, Bar: () => null, XAxis: () => null, YAxis: () => null, CartesianGrid: () => null, Tooltip: () => null };
});
const db = dbModule as unknown as ReturnType<typeof createDatabaseMock>;

const REPORT = {
  weekly: [{ weekStart: '2026-10-12', videos: 1 }, { weekStart: '2026-10-19', videos: 2 }],
  turnaround: { videos: 3, avgHours: 20, medianHours: 18.5 },
  clients: [
    { listId: 'a', name: 'Client A', videos: 2, avgRevisions: 1, avgHours: 20 },
    { listId: 'b', name: 'Client B', videos: 1, avgRevisions: 2, avgHours: 60 },
  ],
  totals: { videos: 3, avgRevisions: 1.33 },
};

beforeEach(() => {
  vi.clearAllMocks();
  db.getProductionMonthly.mockResolvedValue([]);
});

describe('mapKpiReport', () => {
  it('reads numbers that arrive as text, and treats anything malformed as empty', () => {
    const r = mapKpiReport({ weekly: [{ weekStart: '2026-10-19', videos: '4' }, null], turnaround: { videos: 4, avgHours: '12.5', medianHours: null }, clients: 'nope', totals: { videos: 4, avgRevisions: '0.75' } });
    expect(r.weekly).toEqual([{ weekStart: '2026-10-19', videos: 4 }]);
    expect(r.turnaround).toEqual({ videos: 4, avgHours: 12.5, medianHours: null });
    expect(r.clients).toEqual([]);
    expect(r.totals).toEqual({ videos: 4, avgRevisions: 0.75 });
    expect(mapKpiReport(null).totals).toEqual({ videos: 0, avgRevisions: null });
  });
});

describe('Reports page', () => {
  it('shows the headline numbers and the per-client lines', async () => {
    db.getKpiReport.mockResolvedValue(REPORT);
    renderWithAuth(<ReportsPage />, { auth: makeAuth('ADMIN') });
    expect(await screen.findByText('Videos reaching first QC')).toBeInTheDocument();
    expect(screen.getByText('20.0 h')).toBeInTheDocument();
    expect(screen.getByText(/median 18\.5 h/)).toBeInTheDocument();
    expect(screen.getByText('1.3')).toBeInTheDocument();
    expect(screen.getByText(/2\.0 revisions · 2\.5 d · 1 video/)).toBeInTheDocument();
    expect(db.getKpiReport).toHaveBeenCalledWith('ws-1', 12, expect.any(String));
  });

  it('asks again when the range changes', async () => {
    db.getKpiReport.mockResolvedValue(REPORT);
    renderWithAuth(<ReportsPage />, { auth: makeAuth('OWNER') });
    await screen.findByText('Videos reaching first QC');
    screen.getByRole('button', { name: '6 months' }).click();
    await vi.waitFor(() => expect(db.getKpiReport).toHaveBeenCalledWith('ws-1', 26, expect.any(String)));
  });

  it('says plainly when nothing has reached QC yet', async () => {
    db.getKpiReport.mockResolvedValue({ weekly: [], turnaround: { videos: 0, avgHours: null, medianHours: null }, clients: [], totals: { videos: 0, avgRevisions: null } });
    renderWithAuth(<ReportsPage />, { auth: makeAuth('ADMIN') });
    expect(await screen.findByText('No finished first cuts in this period')).toBeInTheDocument();
  });

  it('shows a load error with a retry', async () => {
    db.getKpiReport.mockRejectedValue(new Error('The server could not be reached.'));
    renderWithAuth(<ReportsPage />, { auth: makeAuth('ADMIN') });
    expect(await screen.findByText('The server could not be reached.')).toBeInTheDocument();
  });
});
