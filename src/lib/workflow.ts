import type { TaskStatus, TbbRole, Workflow, WorkflowStatus, WorkflowTransition } from '@/types/database';
import { ROLE_LABELS } from '@/lib/permissions';

/**
 * The TBB workflow engine on the client: pure functions over the workflow the database owns.
 *
 * It mirrors the database trigger enforce_task_workflow (and guard_task_update) so the interface
 * offers exactly the moves the database will accept, explains the ones it will not, and asks for
 * what a stage needs before sending anything. It never decides on its own: every move is sent to
 * transition_task and the database has the final word.
 */

/** Owner / Admin may override any edge (docs/TBB_PERMISSION_MODEL.md: "overrides QC decisions"). */
export const OVERRIDE_ROLES: readonly TbbRole[] = ['OWNER', 'ADMIN'];

export type Requirement = 'editor' | 'reviewLink' | 'finalExport' | 'note';

export const REQUIREMENT_LABELS: Record<Requirement, string> = {
  editor: 'an editor assigned',
  reviewLink: 'the review link of the cut',
  finalExport: 'the final export link',
  note: 'a note saying what to change',
};

/** What the engine needs to know about a task. */
export interface WorkflowTask {
  status: TaskStatus;
  editorId: string | null;
  reviewLink?: string | null;
  finalExportLink?: string | null;
}

export interface Actor {
  role: TbbRole | null | undefined;
  /** The signed-in person is this task's assigned editor. */
  isAssignedEditor: boolean;
}

export interface Move {
  to: WorkflowStatus;
  /** The workflow edge, when there is one from the current stage. */
  transition: WorkflowTransition | null;
  allowed: boolean;
  /** Allowed only as an Owner / Admin override (not a normal step). */
  override: boolean;
  /** Why it is not allowed (shown next to a disabled option). */
  reason: string | null;
  /** What the person will be asked for before the move is sent. */
  needs: Requirement[];
  /** The action as people say it ("Submit for QC"), or "Move to X". */
  label: string;
}

// ---------------------------------------------------------------------------------------
// Lookups
// ---------------------------------------------------------------------------------------

export function statusOf(workflow: Workflow | null | undefined, key: TaskStatus): WorkflowStatus | undefined {
  return workflow?.statuses.find((s) => s.key === key);
}

/** "QC_FIRST_APPROVAL" -> "QC FIRST APPROVAL" while the workflow is loading (never shown as a blank). */
export function humanizeStatus(key: TaskStatus): string {
  return key.replace(/_/g, ' ');
}

export function statusName(workflow: Workflow | null | undefined, key: TaskStatus): string {
  return statusOf(workflow, key)?.name ?? humanizeStatus(key);
}

export function statusColor(workflow: Workflow | null | undefined, key: TaskStatus): string {
  return statusOf(workflow, key)?.color ?? '#94A3B8';
}

/** Finished = the COMPLETED category (CLOSED in the TBB workflow): never overdue, shown as done. */
export function isFinishedStatus(workflow: Workflow | null | undefined, key: TaskStatus): boolean {
  return statusOf(workflow, key)?.category === 'COMPLETED';
}

export function initialStatus(workflow: Workflow | null | undefined): WorkflowStatus | undefined {
  return workflow?.statuses.find((s) => s.isInitial) ?? workflow?.statuses[0];
}

/** 1-based place in the workflow ("stage 4 of 10"); 0 when unknown. */
export function stageNumber(workflow: Workflow | null | undefined, key: TaskStatus): number {
  const i = workflow?.statuses.findIndex((s) => s.key === key) ?? -1;
  return i + 1;
}

// ---------------------------------------------------------------------------------------
// Requirements
// ---------------------------------------------------------------------------------------

/** What the target stage needs that the task does not have yet (a note is always asked for). */
export function missingRequirements(target: WorkflowStatus, task: WorkflowTask): Requirement[] {
  const needs: Requirement[] = [];
  if (target.requiresEditor && !task.editorId) needs.push('editor');
  if (target.requiresReviewLink && !task.reviewLink) needs.push('reviewLink');
  if (target.requiresFinalExport && !task.finalExportLink) needs.push('finalExport');
  if (target.requiresNote) needs.push('note');
  return needs;
}

/** Can this role provide a missing requirement in the move dialog? (mirrors guard_task_update) */
function canProvide(role: TbbRole | null | undefined, need: Requirement): boolean {
  const manager = role === 'OWNER' || role === 'ADMIN' || role === 'PRODUCTION_MANAGER';
  if (need === 'note') return true;
  if (need === 'editor') return manager;
  if (need === 'reviewLink') return manager || role === 'EDITOR';
  return manager || role === 'QC_SPECIALIST'; // finalExport
}

function rolesText(roles: readonly TbbRole[]): string {
  const names = roles.filter((r) => r !== 'OWNER' && r !== 'ADMIN').map((r) => ROLE_LABELS[r]);
  if (roles.includes('EDITOR')) names.splice(names.indexOf(ROLE_LABELS.EDITOR), 1, 'the assigned editor');
  return names.length ? names.join(' or ') : 'an admin';
}

// ---------------------------------------------------------------------------------------
// Moves
// ---------------------------------------------------------------------------------------

/**
 * Every other stage, with whether this person may move the task there right now, why not, and what
 * they will be asked for. Ordered: the workflow's steps from the current stage first (forward, then
 * reject, then back), then everything else in workflow order.
 */
export function movesFor(workflow: Workflow | null | undefined, task: WorkflowTask, actor: Actor): Move[] {
  if (!workflow) return [];
  const { role } = actor;
  const from = statusOf(workflow, task.status);
  const roleBlocked =
    !role || role === 'CLIENT_VIEWER'
      ? 'Your role cannot change the stage of a task.'
      : role === 'EDITOR' && !actor.isAssignedEditor
        ? 'Only the editor assigned to this task can move it.'
        : null;

  const moves = workflow.statuses
    .filter((s) => s.key !== task.status)
    .map<Move>((to) => {
      const transition = workflow.transitions.find((t) => t.from === task.status && t.to === to.key) ?? null;
      const byEdge = !!transition && !!role && transition.roles.includes(role);
      const override = !byEdge && !!role && OVERRIDE_ROLES.includes(role);
      const needs = missingRequirements(to, task);
      let reason = roleBlocked;
      if (!reason && !byEdge && !override) {
        reason = transition
          ? `Only ${rolesText(transition.roles)} can do this.`
          : `Not a step from ${from?.name ?? humanizeStatus(task.status)}.`;
      }
      if (!reason) {
        const blocked = needs.find((n) => !canProvide(role, n));
        if (blocked) reason = `Needs ${REQUIREMENT_LABELS[blocked]} first.`;
      }
      return {
        to,
        transition,
        allowed: !reason,
        override: !reason && override,
        reason,
        needs,
        label: transition && byEdge ? transition.label : `Move to ${to.name}`,
      };
    });

  const rank = (m: Move) => {
    if (m.transition && !m.override && m.allowed) return m.transition.kind === 'forward' ? 0 : m.transition.kind === 'reject' ? 1 : 2;
    return 3;
  };
  return moves.sort((a, b) => rank(a) - rank(b) || a.to.position - b.to.position);
}

/** The workflow steps this person can take now (the "next action" buttons). Overrides excluded. */
export function nextSteps(workflow: Workflow | null | undefined, task: WorkflowTask, actor: Actor): Move[] {
  return movesFor(workflow, task, actor).filter((m) => m.allowed && !m.override && m.transition);
}

/** Whether this person may move the task to `to` at all (ignoring what they would be asked for). */
export function canMove(workflow: Workflow | null | undefined, task: WorkflowTask, actor: Actor, to: TaskStatus): Move | undefined {
  return movesFor(workflow, task, actor).find((m) => m.to.key === to && m.allowed);
}

/** Can the person change the stage of this task in any way? (controls the picker vs a plain pill) */
export function canChangeStatus(workflow: Workflow | null | undefined, task: WorkflowTask, actor: Actor): boolean {
  return movesFor(workflow, task, actor).some((m) => m.allowed);
}

/**
 * Bulk moves cannot ask each task for a link: a task is moved in bulk only when the move is allowed
 * and nothing but (one shared) note is needed.
 */
export function bulkVerdict(
  workflow: Workflow | null | undefined,
  task: WorkflowTask,
  actor: Actor,
  to: TaskStatus
): { ok: true } | { ok: false; reason: string } {
  if (task.status === to) return { ok: false, reason: 'already there' };
  const move = movesFor(workflow, task, actor).find((m) => m.to.key === to);
  if (!move || !move.allowed) return { ok: false, reason: move?.reason ?? 'not allowed' };
  const missing = move.needs.filter((n) => n !== 'note');
  if (missing.length) return { ok: false, reason: `needs ${REQUIREMENT_LABELS[missing[0]]}` };
  return { ok: true };
}

/** The tasks where the signed-in person is expected to act next (assigned to them, with a step available). */
export function needsMyAction(
  workflow: Workflow | null | undefined,
  task: WorkflowTask & { qcId?: string | null },
  me: string | null | undefined,
  role: TbbRole | null | undefined
): boolean {
  if (!me || !workflow) return false;
  const mine = task.editorId === me || task.qcId === me;
  if (!mine) return false;
  return nextSteps(workflow, task, { role, isAssignedEditor: task.editorId === me }).some((m) => m.transition?.kind === 'forward' || m.transition?.kind === 'reject');
}

/** Who the task waits on when this person has no step to take: "Production Manager or QC Specialist". */
export function waitingOn(workflow: Workflow | null | undefined, status: TaskStatus): string | null {
  const forward = workflow?.transitions.filter((t) => t.from === status && t.kind === 'forward') ?? [];
  if (forward.length === 0) return null;
  return rolesText([...new Set(forward.flatMap((t) => t.roles))]);
}

/** "needs the review link of the cut first (2); already there (1)": why some selected tasks are left alone. */
export function summarizeSkips(reasons: readonly string[]): string | undefined {
  if (reasons.length === 0) return undefined;
  const counts = new Map<string, number>();
  for (const r of reasons) counts.set(r, (counts.get(r) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${reason.replace(/\.$/, '').replace(/^./, (c) => c.toLowerCase())} (${count})`)
    .join('; ');
}
