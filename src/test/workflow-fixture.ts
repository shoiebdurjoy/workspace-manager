import type { Workflow } from '@/types/database';

/**
 * Test-only copy of the TBB workflow seeded by migration 20260930000008 (private.create_tbb_workflow).
 * workflow-fixture.test.ts parses the migration and fails if the two ever drift apart.
 */
const M = ['OWNER', 'ADMIN', 'PRODUCTION_MANAGER'] as const;
const Q = [...M, 'QC_SPECIALIST'] as const;
const E = [...M, 'EDITOR'] as const;

export const TBB_WORKFLOW: Workflow = {
  id: 'wf-1',
  name: 'TBB video production',
  statuses: [
    { key: 'TO_BE_EDITED', name: 'TO BE EDITED', category: 'NOT_STARTED', color: '#94A3B8', position: 0, description: "Brief and footage received; not yet in the edit pipeline.", isInitial: true, requiresEditor: false, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'IN_EDIT', name: 'IN EDIT', category: 'IN_PROGRESS', color: '#FB923C', position: 1, description: "Accepted into the edit pipeline; waiting for an editor.", isInitial: false, requiresEditor: false, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'ASSIGNED', name: 'ASSIGNED', category: 'IN_PROGRESS', color: '#F97316', position: 2, description: "In an editor's queue.", isInitial: false, requiresEditor: true, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'STARTED_EDITING', name: 'STARTED EDITING', category: 'IN_PROGRESS', color: '#EA580C', position: 3, description: "The editor is working on the cut.", isInitial: false, requiresEditor: true, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'QC_FIRST_APPROVAL', name: 'QC - FIRST APPROVAL', category: 'IN_REVIEW', color: '#EAB308', position: 4, description: "First cut submitted; waiting for QC.", isInitial: false, requiresEditor: true, requiresReviewLink: true, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'QC_REVISION_NEEDED', name: 'QC - REVISION NEEDED', category: 'IN_REVIEW', color: '#DC2626', position: 5, description: "QC (or the client) asked for changes; back with the editor.", isInitial: false, requiresEditor: true, requiresReviewLink: false, requiresFinalExport: false, requiresNote: true, countsRevision: true },
    { key: 'QC_FINAL_APPROVAL', name: 'QC - FINAL APPROVAL', category: 'IN_REVIEW', color: '#CA8A04', position: 6, description: "Revised or passed cut waiting for final QC.", isInitial: false, requiresEditor: true, requiresReviewLink: true, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'QC_APPROVED_RTD', name: 'QC - APPROVED (RTD)', category: 'READY', color: '#16A34A', position: 7, description: "Passed QC; ready to deliver.", isInitial: false, requiresEditor: false, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
    { key: 'SENT_TO_CLIENT', name: 'SENT TO CLIENT', category: 'CLIENT', color: '#0EA5E9', position: 8, description: "Final export delivered to the client.", isInitial: false, requiresEditor: false, requiresReviewLink: false, requiresFinalExport: true, requiresNote: false, countsRevision: false },
    { key: 'CLOSED', name: 'CLOSED', category: 'COMPLETED', color: '#15803D', position: 9, description: "Done.", isInitial: false, requiresEditor: false, requiresReviewLink: false, requiresFinalExport: false, requiresNote: false, countsRevision: false },
  ],
  transitions: [
    { from: 'TO_BE_EDITED', to: 'IN_EDIT', label: "Move to edit queue", kind: 'forward', roles: [...M] },
    { from: 'TO_BE_EDITED', to: 'ASSIGNED', label: "Assign to editor", kind: 'forward', roles: [...M] },
    { from: 'IN_EDIT', to: 'ASSIGNED', label: "Assign to editor", kind: 'forward', roles: [...M] },
    { from: 'IN_EDIT', to: 'TO_BE_EDITED', label: "Back to To be edited", kind: 'back', roles: [...M] },
    { from: 'ASSIGNED', to: 'STARTED_EDITING', label: "Start editing", kind: 'forward', roles: [...E] },
    { from: 'ASSIGNED', to: 'IN_EDIT', label: "Back to edit queue", kind: 'back', roles: [...M] },
    { from: 'STARTED_EDITING', to: 'QC_FIRST_APPROVAL', label: "Submit for QC", kind: 'forward', roles: [...E] },
    { from: 'STARTED_EDITING', to: 'ASSIGNED', label: "Pause editing", kind: 'back', roles: [...E] },
    { from: 'QC_FIRST_APPROVAL', to: 'QC_APPROVED_RTD', label: "Approve (ready to deliver)", kind: 'forward', roles: [...Q] },
    { from: 'QC_FIRST_APPROVAL', to: 'QC_FINAL_APPROVAL', label: "Pass to final approval", kind: 'forward', roles: [...Q] },
    { from: 'QC_FIRST_APPROVAL', to: 'QC_REVISION_NEEDED', label: "Request revision", kind: 'reject', roles: [...Q] },
    { from: 'QC_FIRST_APPROVAL', to: 'STARTED_EDITING', label: "Withdraw from QC", kind: 'back', roles: [...E] },
    { from: 'QC_REVISION_NEEDED', to: 'QC_FINAL_APPROVAL', label: "Submit revision", kind: 'forward', roles: [...E] },
    { from: 'QC_FINAL_APPROVAL', to: 'QC_APPROVED_RTD', label: "Approve (ready to deliver)", kind: 'forward', roles: [...Q] },
    { from: 'QC_FINAL_APPROVAL', to: 'QC_REVISION_NEEDED', label: "Request another revision", kind: 'reject', roles: [...Q] },
    { from: 'QC_APPROVED_RTD', to: 'SENT_TO_CLIENT', label: "Send to client", kind: 'forward', roles: [...Q] },
    { from: 'QC_APPROVED_RTD', to: 'QC_FINAL_APPROVAL', label: "Reopen QC", kind: 'back', roles: [...Q] },
    { from: 'SENT_TO_CLIENT', to: 'CLOSED', label: "Close", kind: 'forward', roles: [...M] },
    { from: 'SENT_TO_CLIENT', to: 'QC_REVISION_NEEDED', label: "Client requested changes", kind: 'reject', roles: [...Q] },
    { from: 'CLOSED', to: 'SENT_TO_CLIENT', label: "Reopen", kind: 'back', roles: [...M] },
  ],
};
