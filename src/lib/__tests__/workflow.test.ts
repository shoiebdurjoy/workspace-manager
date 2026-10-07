import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import {
  bulkVerdict,
  canChangeStatus,
  canMove,
  humanizeStatus,
  initialStatus,
  isFinishedStatus,
  missingRequirements,
  movesFor,
  needsMyAction,
  nextSteps,
  stageNumber,
  statusColor,
  statusName,
  summarizeSkips,
  waitingOn,
  type Actor,
  type WorkflowTask,
} from '../workflow';
import { transitionChange } from '@/hooks/use-workflow';
import { TBB_WORKFLOW as WF } from '@/test/workflow-fixture';
import type { TbbRole } from '@/types/database';

const CANONICAL = [
  'TO BE EDITED',
  'IN EDIT',
  'ASSIGNED',
  'STARTED EDITING',
  'QC - FIRST APPROVAL',
  'QC - REVISION NEEDED',
  'QC - FINAL APPROVAL',
  'QC - APPROVED (RTD)',
  'SENT TO CLIENT',
  'CLOSED',
];

const OWNER: Actor = { role: 'OWNER', isAssignedEditor: false };
const ADMIN: Actor = { role: 'ADMIN', isAssignedEditor: false };
const PM: Actor = { role: 'PRODUCTION_MANAGER', isAssignedEditor: false };
const QC: Actor = { role: 'QC_SPECIALIST', isAssignedEditor: false };
const EDITOR: Actor = { role: 'EDITOR', isAssignedEditor: true };
const OTHER_EDITOR: Actor = { role: 'EDITOR', isAssignedEditor: false };
const CLIENT: Actor = { role: 'CLIENT_VIEWER', isAssignedEditor: false };
const NOBODY: Actor = { role: null, isAssignedEditor: false };

/** A task at `status` with everything a stage could ask for already in place. */
const ready = (status: string, o: Partial<WorkflowTask> = {}): WorkflowTask => ({
  status,
  editorId: 'ed',
  reviewLink: 'https://frame.io/r',
  finalExportLink: 'https://drive.google.com/x',
  ...o,
});
const targets = (task: WorkflowTask, actor: Actor) => nextSteps(WF, task, actor).map((m) => m.to.key);

describe('the seeded TBB workflow (fixture = migration)', () => {
  it('the test fixture is exactly what migration 8 seeds (no drift)', () => {
    const sql = readFileSync(resolve(__dirname, '../../../supabase/migrations/20260930000008_workflow_engine.sql'), 'utf8');
    const statuses = [...sql.matchAll(/\(wf, '(\w+)',\s+'([^']+)',\s+'(\w+)',\s+'(#\w+)', (\d+),/g)].map((m) => [m[1], m[2], m[3], m[4], Number(m[5])]);
    expect(statuses).toEqual(WF.statuses.map((s) => [s.key, s.name, s.category, s.color, s.position]));
    const edges = [...sql.matchAll(/\(wf, '(\w+)',\s+'(\w+)',\s+'([^']+)',\s+'(\w+)',\s+([mqe])\)/g)].map((m) => `${m[1]}>${m[2]}:${m[4]}`);
    expect(edges).toEqual(WF.transitions.map((t) => `${t.from}>${t.to}:${t.kind}`));
  });

  it('has the ten canonical stages, in order, starting at TO BE EDITED and finishing at CLOSED', () => {
    expect(WF.statuses.map((s) => s.name)).toEqual(CANONICAL);
    expect(initialStatus(WF)?.key).toBe('TO_BE_EDITED');
    expect(WF.statuses.filter((s) => isFinishedStatus(WF, s.key)).map((s) => s.key)).toEqual(['CLOSED']);
    expect(stageNumber(WF, 'QC_FIRST_APPROVAL')).toBe(5);
    expect(stageNumber(WF, 'NOPE')).toBe(0);
  });

  it('names and colours come from the workflow; unknown keys fall back without a blank', () => {
    expect(statusName(WF, 'QC_APPROVED_RTD')).toBe('QC - APPROVED (RTD)');
    expect(statusName(null, 'QC_APPROVED_RTD')).toBe('QC APPROVED RTD');
    expect(humanizeStatus('SENT_TO_CLIENT')).toBe('SENT TO CLIENT');
    expect(statusColor(WF, 'QC_REVISION_NEEDED')).toBe('#DC2626');
    expect(statusColor(WF, 'NOPE')).toMatch(/^#/);
    expect(isFinishedStatus(null, 'CLOSED')).toBe(false);
  });

  it('every edge is between known stages and every edge has at least one non-admin role', () => {
    const keys = WF.statuses.map((s) => s.key);
    for (const t of WF.transitions) {
      expect(keys).toContain(t.from);
      expect(keys).toContain(t.to);
      expect(t.roles.some((r) => r !== 'OWNER' && r !== 'ADMIN')).toBe(true);
    }
  });
});

describe('requirements', () => {
  const s = (key: string) => WF.statuses.find((x) => x.key === key)!;

  it('assigned stages need an editor; QC stages need the review link; delivery needs the final export; revision needs a note', () => {
    const bare: WorkflowTask = { status: 'TO_BE_EDITED', editorId: null, reviewLink: null, finalExportLink: null };
    expect(missingRequirements(s('IN_EDIT'), bare)).toEqual([]);
    expect(missingRequirements(s('ASSIGNED'), bare)).toEqual(['editor']);
    expect(missingRequirements(s('QC_FIRST_APPROVAL'), bare)).toEqual(['editor', 'reviewLink']);
    expect(missingRequirements(s('QC_FINAL_APPROVAL'), { ...bare, editorId: 'ed' })).toEqual(['reviewLink']);
    expect(missingRequirements(s('SENT_TO_CLIENT'), bare)).toEqual(['finalExport']);
    // a note is asked for on every request for changes, even if the task "has" everything
    expect(missingRequirements(s('QC_REVISION_NEEDED'), ready('QC_FIRST_APPROVAL'))).toEqual(['note']);
    expect(missingRequirements(s('CLOSED'), bare)).toEqual([]);
  });
});

describe('the happy path, step by step, with the right person at each step', () => {
  it('manager: TO BE EDITED -> IN EDIT -> ASSIGNED', () => {
    expect(targets(ready('TO_BE_EDITED'), PM)).toEqual(['IN_EDIT', 'ASSIGNED']);
    expect(targets(ready('IN_EDIT'), PM)).toEqual(['ASSIGNED', 'TO_BE_EDITED']);
  });

  it('assigned editor: ASSIGNED -> STARTED EDITING -> QC - FIRST APPROVAL', () => {
    expect(targets(ready('ASSIGNED'), EDITOR)).toEqual(['STARTED_EDITING']);
    expect(targets(ready('STARTED_EDITING'), EDITOR)).toEqual(['QC_FIRST_APPROVAL', 'ASSIGNED']);
    expect(nextSteps(WF, ready('STARTED_EDITING'), EDITOR)[0].label).toBe('Submit for QC');
  });

  it('QC: approve, pass to final approval, or request a revision (forward first, then reject)', () => {
    const steps = nextSteps(WF, ready('QC_FIRST_APPROVAL'), QC);
    expect(steps.map((m) => m.to.key)).toEqual(['QC_FINAL_APPROVAL', 'QC_APPROVED_RTD', 'QC_REVISION_NEEDED']);
    expect(steps.map((m) => m.transition?.kind)).toEqual(['forward', 'forward', 'reject']);
    expect(steps[2]).toMatchObject({ label: 'Request revision', needs: ['note'] });
  });

  it('QC: QC - APPROVED (RTD) -> SENT TO CLIENT; manager: SENT TO CLIENT -> CLOSED', () => {
    expect(targets(ready('QC_APPROVED_RTD'), QC)).toEqual(['SENT_TO_CLIENT', 'QC_FINAL_APPROVAL']);
    expect(targets(ready('SENT_TO_CLIENT'), PM)).toEqual(['CLOSED', 'QC_REVISION_NEEDED']);
    expect(targets(ready('SENT_TO_CLIENT'), QC)).toEqual(['QC_REVISION_NEEDED']);
    expect(targets(ready('CLOSED'), PM)).toEqual(['SENT_TO_CLIENT']);
  });
});

describe('the revision cycle', () => {
  it('an editor can only resubmit a revision (to final approval), never approve their own work', () => {
    expect(targets(ready('QC_REVISION_NEEDED'), EDITOR)).toEqual(['QC_FINAL_APPROVAL']);
    expect(nextSteps(WF, ready('QC_REVISION_NEEDED'), EDITOR)[0].label).toBe('Submit revision');
    for (const to of ['QC_APPROVED_RTD', 'SENT_TO_CLIENT', 'CLOSED', 'QC_REVISION_NEEDED']) {
      expect(canMove(WF, ready('QC_FIRST_APPROVAL'), EDITOR, to)).toBeUndefined();
    }
  });

  it('final approval can be sent back again ("Request another revision"); the client can send it back after delivery', () => {
    expect(nextSteps(WF, ready('QC_FINAL_APPROVAL'), QC).find((m) => m.to.key === 'QC_REVISION_NEEDED')?.label).toBe('Request another revision');
    expect(nextSteps(WF, ready('SENT_TO_CLIENT'), QC).find((m) => m.to.key === 'QC_REVISION_NEEDED')?.label).toBe('Client requested changes');
  });

  it('QC cannot do editing steps (start, submit) and the editor cannot do QC steps', () => {
    expect(canMove(WF, ready('ASSIGNED'), QC, 'STARTED_EDITING')).toBeUndefined();
    expect(canMove(WF, ready('QC_REVISION_NEEDED'), QC, 'QC_FINAL_APPROVAL')).toBeUndefined();
    expect(canMove(WF, ready('QC_FIRST_APPROVAL'), EDITOR, 'QC_APPROVED_RTD')).toBeUndefined();
  });

  it('entering a revision stage counts one more revision (optimistic mirror of the trigger)', () => {
    const row = { status: 'QC_FIRST_APPROVAL', revisionCount: 1 };
    expect(transitionChange(WF, row, { to: 'QC_REVISION_NEEDED', note: 'x' })).toEqual({ status: 'QC_REVISION_NEEDED', revisionCount: 2 });
    expect(transitionChange(WF, row, { to: 'QC_APPROVED_RTD' })).toEqual({ status: 'QC_APPROVED_RTD' });
    expect(transitionChange(WF, row, { to: 'QC_FIRST_APPROVAL', reviewLink: ' https://frame.io/a ' })).toMatchObject({ reviewLink: 'https://frame.io/a' });
  });
});

describe('who may do what', () => {
  it('a non-step is refused with the reason, for everyone but Owner / Admin', () => {
    const move = movesFor(WF, ready('TO_BE_EDITED'), PM).find((m) => m.to.key === 'CLOSED')!;
    expect(move).toMatchObject({ allowed: false, override: false });
    expect(move.reason).toBe('Not a step from TO BE EDITED.');
  });

  it('a real step for another role says who can take it', () => {
    const move = movesFor(WF, ready('QC_FIRST_APPROVAL'), EDITOR).find((m) => m.to.key === 'QC_APPROVED_RTD')!;
    expect(move.allowed).toBe(false);
    expect(move.reason).toBe('Only Production Manager or QC Specialist can do this.');
    const close = movesFor(WF, ready('SENT_TO_CLIENT'), QC).find((m) => m.to.key === 'CLOSED')!;
    expect(close.reason).toBe('Only Production Manager can do this.');
  });

  it.each([OWNER, ADMIN])('%o may move anywhere as a recorded override (requirements still apply)', (actor) => {
    const moves = movesFor(WF, ready('TO_BE_EDITED'), actor);
    expect(moves.every((m) => m.allowed)).toBe(true);
    expect(moves.find((m) => m.to.key === 'CLOSED')).toMatchObject({ override: true, label: 'Move to CLOSED' });
    expect(moves.find((m) => m.to.key === 'IN_EDIT')).toMatchObject({ override: false, label: 'Move to edit queue' });
    // overrides are never offered as "next steps"
    expect(targets(ready('TO_BE_EDITED'), actor)).toEqual(['IN_EDIT', 'ASSIGNED']);
    // and the requirements still apply: the dialog will ask for the link
    expect(moves.find((m) => m.to.key === 'SENT_TO_CLIENT')?.needs).toEqual([]);
    expect(movesFor(WF, ready('TO_BE_EDITED', { finalExportLink: null }), actor).find((m) => m.to.key === 'SENT_TO_CLIENT')?.needs).toEqual(['finalExport']);
  });

  it('a Production Manager follows the graph (no override)', () => {
    expect(movesFor(WF, ready('TO_BE_EDITED'), PM).some((m) => m.override)).toBe(false);
    expect(canMove(WF, ready('TO_BE_EDITED'), PM, 'CLOSED')).toBeUndefined();
  });

  it('an editor not assigned to the task, a client viewer and a signed-out visitor cannot move anything', () => {
    for (const actor of [OTHER_EDITOR, CLIENT, NOBODY]) {
      expect(canChangeStatus(WF, ready('ASSIGNED'), actor)).toBe(false);
    }
    expect(movesFor(WF, ready('ASSIGNED'), OTHER_EDITOR)[0].reason).toBe('Only the editor assigned to this task can move it.');
    expect(movesFor(WF, ready('ASSIGNED'), CLIENT)[0].reason).toBe('Your role cannot change the stage of a task.');
  });

  it('a requirement the person cannot provide blocks the move with the reason (QC cannot assign an editor)', () => {
    const noEditor = ready('QC_APPROVED_RTD', { editorId: null });
    const m = movesFor(WF, noEditor, QC).find((x) => x.to.key === 'QC_FINAL_APPROVAL')!;
    expect(m).toMatchObject({ allowed: false, reason: 'Needs an editor assigned first.' });
    // the editor can provide the review link themselves when submitting
    const sub = movesFor(WF, ready('STARTED_EDITING', { reviewLink: null }), EDITOR).find((x) => x.to.key === 'QC_FIRST_APPROVAL')!;
    expect(sub).toMatchObject({ allowed: true, needs: ['reviewLink'] });
  });

  it('with no workflow loaded nothing is offered', () => {
    expect(movesFor(null, ready('ASSIGNED'), OWNER)).toEqual([]);
    expect(canChangeStatus(undefined, ready('ASSIGNED'), OWNER)).toBe(false);
  });

  it('the matrix: every edge is offered to exactly its roles (plus the admin override)', () => {
    const ROLES: TbbRole[] = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER', 'QC_SPECIALIST', 'EDITOR', 'CLIENT_VIEWER'];
    for (const t of WF.transitions) {
      for (const role of ROLES) {
        const actor = { role, isAssignedEditor: role === 'EDITOR' };
        const m = movesFor(WF, ready(t.from), actor).find((x) => x.to.key === t.to)!;
        const expected = t.roles.includes(role) || role === 'OWNER' || role === 'ADMIN';
        expect([t.from, t.to, role, m.allowed]).toEqual([t.from, t.to, role, expected]);
      }
    }
  });
});

describe('bulk, "needs my action" and the waiting hint', () => {
  it('a bulk move happens only where it is a valid step and nothing per-task is missing', () => {
    expect(bulkVerdict(WF, ready('QC_FIRST_APPROVAL'), QC, 'QC_APPROVED_RTD')).toEqual({ ok: true });
    expect(bulkVerdict(WF, ready('QC_FIRST_APPROVAL'), QC, 'QC_REVISION_NEEDED')).toEqual({ ok: true }); // the note is asked once
    expect(bulkVerdict(WF, ready('QC_APPROVED_RTD'), QC, 'QC_APPROVED_RTD')).toEqual({ ok: false, reason: 'already there' });
    expect(bulkVerdict(WF, ready('QC_APPROVED_RTD', { finalExportLink: null }), QC, 'SENT_TO_CLIENT')).toEqual({
      ok: false,
      reason: 'needs the final export link',
    });
    expect(bulkVerdict(WF, ready('TO_BE_EDITED'), EDITOR, 'IN_EDIT')).toMatchObject({ ok: false });
  });

  it('skip reasons are summarised, most common first', () => {
    expect(summarizeSkips([])).toBeUndefined();
    expect(summarizeSkips(['already there', 'Needs the review link first.', 'Needs the review link first.'])).toBe(
      'needs the review link first (2); already there (1)'
    );
  });

  it('"needs my action": assigned to me AND a forward / reject step is mine', () => {
    const t = { ...ready('ASSIGNED'), editorId: 'me', qcId: 'q' };
    expect(needsMyAction(WF, t, 'me', 'EDITOR')).toBe(true);
    expect(needsMyAction(WF, { ...t, status: 'QC_FIRST_APPROVAL' }, 'me', 'EDITOR')).toBe(false); // waiting on QC
    expect(needsMyAction(WF, { ...t, status: 'QC_FIRST_APPROVAL' }, 'q', 'QC_SPECIALIST')).toBe(true);
    expect(needsMyAction(WF, t, 'someone-else', 'EDITOR')).toBe(false);
    expect(needsMyAction(WF, t, null, 'EDITOR')).toBe(false);
  });

  it('says who the task waits on', () => {
    expect(waitingOn(WF, 'QC_FIRST_APPROVAL')).toBe('Production Manager or QC Specialist');
    expect(waitingOn(WF, 'ASSIGNED')).toBe('Production Manager or the assigned editor');
    expect(waitingOn(WF, 'CLOSED')).toBeNull();
  });
});
