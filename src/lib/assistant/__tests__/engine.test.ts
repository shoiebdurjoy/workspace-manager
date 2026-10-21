import { describe, expect, it, vi } from 'vitest';
import { createEngine, type Executor, type Snapshot } from '../engine';
import { similarity } from '../match';

const snap: Snapshot = {
  today: '2026-10-22',
  spaces: [{ id: 's', name: 'Shorts' }],
  folders: [
    { id: 'fz', name: 'CONTENT PIPELINE - ZIM', spaceId: 's', defaultQcId: 'zim' },
    { id: 'fm', name: 'CONTENT PIPELINE - MYLA', spaceId: 's', defaultQcId: 'myla' },
  ],
  lists: [
    { id: 'conn', name: '1. THE CONNECTORS', spaceId: 's', folderId: 'fz', defaultQcId: null },
    { id: 'vast', name: '2. VAST MEDIA CONTENT - MATT', spaceId: 's', folderId: 'fz', defaultQcId: null },
    { id: 'whoosh', name: '6. WHOOSH MEDIA - WES', spaceId: 's', folderId: 'fm', defaultQcId: null },
  ],
  members: [
    { id: 'zim', name: 'Zim Rahman', role: 'QC_SPECIALIST', availability: 'AVAILABLE' },
    { id: 'myla', name: 'Myla Akter', role: 'QC_SPECIALIST', availability: 'BUSY' },
    { id: 'ana', name: 'Ana Editor', role: 'EDITOR', availability: null },
  ],
  statuses: [
    { key: 'TO_BE_EDITED', name: 'TO BE EDITED', category: 'NOT_STARTED' },
    { key: 'QC_FIRST_APPROVAL', name: 'QC- FIRST APPROVAL', category: 'IN_REVIEW' },
    { key: 'CLIENT_APPROVED', name: 'CLIENT APPROVED', category: 'CLIENT' },
    { key: 'CLOSED', name: 'CLOSED', category: 'COMPLETED' },
  ],
  tasks: [
    { id: 't1', title: 'CC R01 | Midtown', status: 'QC_FIRST_APPROVAL', listId: 'conn', dueDate: '2026-10-01', editorId: 'ana', qcId: 'zim' },
    { id: 't2', title: 'CC R02 | Midtown', status: 'TO_BE_EDITED', listId: 'conn', dueDate: null, editorId: null, qcId: null },
    { id: 't3', title: 'Whoosh hook 1', status: 'CLOSED', listId: 'whoosh', dueDate: '2026-09-01', editorId: 'ana', qcId: 'myla' },
  ],
};

const exec = (): Executor & Record<string, ReturnType<typeof vi.fn>> =>
  ({
    updateList: vi.fn(async () => undefined),
    updateFolder: vi.fn(async () => undefined),
    createList: vi.fn(async () => 'new'),
    createFolder: vi.fn(async () => 'newf'),
    updateTask: vi.fn(async () => undefined),
    setAssignee: vi.fn(async () => undefined),
    transition: vi.fn(async () => undefined),
    setRole: vi.fn(async () => undefined),
  }) as never;

const engine = createEngine(snap);

describe('built-in assistant: matching', () => {
  it('finds clients by a short name, ignoring their number', () => {
    expect(similarity('connectors', '1. THE CONNECTORS')).toBeGreaterThan(0.8);
    expect(similarity('vast media', '2. VAST MEDIA CONTENT - MATT')).toBeGreaterThan(0.8);
    expect(similarity('whoosh', '1. THE CONNECTORS')).toBe(0);
  });
});

describe('built-in assistant: answers', () => {
  it('counts clients per folder with their QC', () => {
    const r = engine.understand('How many clients are in each folder?');
    expect(r.kind).toBe('answer');
    expect(r.kind === 'answer' && r.text).toMatch(/ZIM: 2 lists, 2 open videos · QC Zim Rahman/);
  });
  it('lists what waits for QC, by reviewer', () => {
    const r = engine.understand('what is waiting for qc');
    expect(r.kind === 'answer' && r.text).toMatch(/Zim Rahman \(1\)[\s\S]*CC R01/);
  });
  it('finds overdue open videos and skips closed ones', () => {
    const r = engine.understand('anything overdue?');
    expect(r.kind === 'answer' && r.text).toMatch(/1 overdue video/);
    expect(r.kind === 'answer' && r.text).not.toMatch(/Whoosh hook/);
  });
  it('says who reviews a client, from its folder', () => {
    const r = engine.understand('who is qc for whoosh');
    expect(r.kind === 'answer' && r.text).toMatch(/Myla Akter \(from CONTENT PIPELINE - MYLA\)/);
  });
  it('opens a client by name', () => {
    const r = engine.understand('open vast media');
    expect(r.kind === 'answer' && r.link?.to).toBe('/spaces/s/lists/vast');
  });
  it('does not guess at nonsense', () => {
    expect(engine.understand('purple elephants dancing').kind).toBe('clarify');
  });
});

describe('built-in assistant: commands wait for Confirm, then use the app\'s own calls', () => {
  it('shifts a client to the other QC folder and hands its open videos to that reviewer', async () => {
    const r = engine.understand('Shift connectors from zim to myla');
    expect(r.kind).toBe('action');
    if (r.kind !== 'action') return;
    expect(r.summary).toMatch(/Move 1. THE CONNECTORS into CONTENT PIPELINE - MYLA and give its 2 open videos to Myla Akter/);
    const e = exec();
    await r.run(e);
    expect(e.updateList).toHaveBeenCalledWith('conn', { folder_id: 'fm' });
    expect(e.setAssignee).toHaveBeenCalledWith('t1', 'QC_REVIEWER', 'myla');
    expect(e.setAssignee).toHaveBeenCalledWith('t2', 'QC_REVIEWER', 'myla');
  });
  it('makes someone QC for a whole folder', async () => {
    const r = engine.understand('make Myla QC for the zim folder');
    expect(r.kind === 'action' && r.summary).toMatch(/Make Myla Akter the default QC for CONTENT PIPELINE - ZIM/);
    if (r.kind !== 'action') return;
    const e = exec();
    await r.run(e);
    expect(e.updateFolder).toHaveBeenCalledWith('fz', { default_qc_id: 'myla' });
  });
  it('renames a client keeping the typed casing', async () => {
    const r = engine.understand('rename vast media to 2. VAST MEDIA GROUP');
    if (r.kind !== 'action') throw new Error(r.kind);
    const e = exec();
    await r.run(e);
    expect(e.updateList).toHaveBeenCalledWith('vast', { name: '2. VAST MEDIA GROUP' });
  });
  it('adds a client into a folder', async () => {
    const r = engine.understand('add client 24. NEW BRAND to myla');
    if (r.kind !== 'action') throw new Error(r.kind);
    const e = exec();
    await r.run(e);
    expect(e.createList).toHaveBeenCalledWith({ spaceId: 's', folderId: 'fm', name: '24. NEW BRAND' });
  });
  it('moves a video to a status', async () => {
    const r = engine.understand('move CC R02 to client approved');
    if (r.kind !== 'action') throw new Error(r.kind);
    const e = exec();
    await r.run(e);
    expect(e.transition).toHaveBeenCalledWith('t2', 'CLIENT_APPROVED');
  });
  it('assigns an editor and changes a role', async () => {
    const a = engine.understand('assign CC R02 to Ana');
    if (a.kind !== 'action') throw new Error(a.kind);
    const e = exec();
    await a.run(e);
    expect(e.setAssignee).toHaveBeenCalledWith('t2', 'EDITOR', 'ana');
    const b = engine.understand('make Ana an admin');
    if (b.kind !== 'action') throw new Error(b.kind);
    await b.run(e);
    expect(e.setRole).toHaveBeenCalledWith('ana', 'ADMIN');
  });
});
