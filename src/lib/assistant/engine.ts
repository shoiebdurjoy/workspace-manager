/**
 * The built-in assistant's brain: understands plain-English questions and commands about the workspace, with no
 * external AI service. `understand(text, snapshot)` returns either an answer (computed from the snapshot) or an
 * action plan that the panel shows for confirmation and then runs through `Executor` (the signed-in person's own
 * session, so the database's rules apply). Pure and synchronous, so it is unit-tested without a database.
 */
import { bestMatch, normalize } from './match';

export interface SnapFolder {
  id: string;
  name: string;
  spaceId: string;
  defaultQcId: string | null;
}
export interface SnapList {
  id: string;
  name: string;
  spaceId: string;
  folderId: string | null;
  defaultQcId: string | null;
}
export interface SnapMember {
  id: string;
  name: string;
  role: string;
  availability: string | null;
}
export interface SnapStatus {
  key: string;
  name: string;
  category: string;
}
export interface SnapTask {
  id: string;
  title: string;
  status: string;
  listId: string;
  dueDate: string | null;
  editorId: string | null;
  qcId: string | null;
}
export interface Snapshot {
  spaces: { id: string; name: string }[];
  folders: SnapFolder[];
  lists: SnapList[];
  members: SnapMember[];
  statuses: SnapStatus[];
  tasks: SnapTask[];
  today: string;
}

export interface Executor {
  updateList(id: string, patch: { name?: string; folder_id?: string | null; default_qc_id?: string | null }): Promise<void>;
  updateFolder(id: string, patch: { name?: string; default_qc_id?: string | null }): Promise<void>;
  createList(input: { spaceId: string; folderId: string | null; name: string }): Promise<string>;
  createFolder(input: { spaceId: string; name: string }): Promise<string>;
  updateTask(id: string, patch: { title?: string; list_id?: string }): Promise<void>;
  setAssignee(taskId: string, role: 'EDITOR' | 'QC_REVIEWER', userId: string | null): Promise<void>;
  transition(taskId: string, to: string, note?: string): Promise<void>;
  setRole(userId: string, role: string): Promise<void>;
}

export type Reply =
  | { kind: 'answer'; text: string; link?: { label: string; to: string } }
  | { kind: 'action'; summary: string; run: (exec: Executor) => Promise<string> }
  | { kind: 'clarify'; text: string };

const ROLE_WORDS: Record<string, string> = {
  admin: 'ADMIN',
  'production manager': 'PRODUCTION_MANAGER',
  manager: 'PRODUCTION_MANAGER',
  pm: 'PRODUCTION_MANAGER',
  qc: 'QC_SPECIALIST',
  'qc specialist': 'QC_SPECIALIST',
  reviewer: 'QC_SPECIALIST',
  editor: 'EDITOR',
  client: 'CLIENT_VIEWER',
  'client viewer': 'CLIENT_VIEWER',
};

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const clean = (s: string) => s.trim().replace(/^["'“]|["'”]$/g, '').replace(/[?.!]+$/, '').trim();

/** Everything a name in a sentence could refer to. */
type Target =
  | { type: 'folder'; folder: SnapFolder }
  | { type: 'list'; list: SnapList }
  | { type: 'task'; task: SnapTask }
  | { type: 'member'; member: SnapMember }
  | { type: 'status'; status: SnapStatus };

export function createEngine(snap: Snapshot) {
  const memberName = (id: string | null) => (id ? (snap.members.find((m) => m.id === id)?.name ?? 'someone') : 'nobody');
  const statusName = (key: string) => snap.statuses.find((s) => s.key === key)?.name ?? key;
  const closedKeys = new Set(snap.statuses.filter((s) => s.category === 'COMPLETED').map((s) => s.key));
  const reviewKeys = new Set(snap.statuses.filter((s) => s.category === 'IN_REVIEW').map((s) => s.key));
  const open = snap.tasks.filter((t) => !closedKeys.has(t.status));
  const listName = (id: string) => snap.lists.find((l) => l.id === id)?.name ?? 'a list';
  const tasksIn = (listIds: string[]) => open.filter((t) => listIds.includes(t.listId));
  const listsOfFolder = (f: SnapFolder) => snap.lists.filter((l) => l.folderId === f.id);

  const findMember = (q: string) => bestMatch(q, snap.members, (m) => m.name, 0.5);
  const findFolder = (q: string) => {
    // "myla" / "zim's folder" names a folder through its reviewer
    const direct = bestMatch(q, snap.folders, (f) => f.name, 0.5);
    if (direct) return direct;
    const word = normalize(q).replace(/s$/, '').replace(/ folder$/, '');
    const byWord = snap.folders.filter((f) => normalize(f.name).split(' ').includes(word));
    return byWord.length === 1 ? { item: byWord[0], score: 0.8, ambiguous: [] as SnapFolder[] } : null;
  };
  const findList = (q: string) => bestMatch(q, snap.lists, (l) => l.name, 0.45);
  const findTask = (q: string) => bestMatch(q, snap.tasks, (t) => t.title, 0.55);
  const findStatus = (q: string) => bestMatch(q, snap.statuses, (s) => s.name, 0.5);

  /** Best guess among the kinds allowed, preferring the higher score. */
  const resolve = (q: string, kinds: Target['type'][]): Target | { ambiguous: string[] } | null => {
    const options: { t: Target; score: number; amb: string[] }[] = [];
    if (kinds.includes('folder')) {
      const m = findFolder(q);
      if (m) options.push({ t: { type: 'folder', folder: m.item }, score: m.score + 0.01, amb: m.ambiguous.map((x) => x.name) });
    }
    if (kinds.includes('list')) {
      const m = findList(q);
      if (m) options.push({ t: { type: 'list', list: m.item }, score: m.score, amb: m.ambiguous.map((x) => x.name) });
    }
    if (kinds.includes('member')) {
      const m = findMember(q);
      if (m) options.push({ t: { type: 'member', member: m.item }, score: m.score, amb: m.ambiguous.map((x) => x.name) });
    }
    if (kinds.includes('status')) {
      const m = findStatus(q);
      if (m) options.push({ t: { type: 'status', status: m.item }, score: m.score, amb: [] });
    }
    if (kinds.includes('task')) {
      const m = findTask(q);
      if (m) options.push({ t: { type: 'task', task: m.item }, score: m.score - 0.05, amb: m.ambiguous.map((x) => x.title) });
    }
    options.sort((a, b) => b.score - a.score);
    if (!options[0]) return null;
    if (options[0].amb.length > 0) return { ambiguous: [nameOf(options[0].t), ...options[0].amb].slice(0, 5) };
    return options[0].t;
  };

  const nameOf = (t: Target) =>
    t.type === 'folder' ? t.folder.name : t.type === 'list' ? t.list.name : t.type === 'task' ? t.task.title : t.type === 'member' ? t.member.name : t.status.name;

  const notFound = (q: string, what: string): Reply => ({ kind: 'clarify', text: `I could not find ${what} called "${q}". Check the name, or ask "list the clients".` });
  const whichOne = (names: string[]): Reply => ({ kind: 'clarify', text: `Which one do you mean?\n${names.map((n) => `• ${n}`).join('\n')}` });

  /** Put a reviewer on every open video of these lists. */
  const reviewOpen = async (exec: Executor, listIds: string[], userId: string) => {
    let n = 0;
    for (const t of tasksIn(listIds)) {
      if (t.qcId === userId) continue;
      await exec.setAssignee(t.id, 'QC_REVIEWER', userId);
      n += 1;
    }
    return n;
  };

  // ---------------------------------------------------------------------------------------------- answers
  const answers: [RegExp, (m: RegExpMatchArray) => Reply][] = [
    [
      /^(help|what can you do|commands|\?)$/,
      () => ({
        kind: 'answer',
        text: [
          'Ask me things like:',
          '• how many clients are in each folder',
          '• which clients have the most open videos',
          '• what is waiting for QC · what is overdue · who is free',
          '• videos in connectors · who is QC for whoosh',
          'Or tell me to:',
          '• shift connectors to myla',
          '• make Zim QC for the zim folder',
          '• rename joe rago to 14. JOE RAGO MEDIA',
          '• add client 24. NEW BRAND to myla',
          '• move "CC R01" to client approved',
          '• assign "CC R01" to Ana · make Ana an editor',
          '• open werth media',
        ].join('\n'),
      }),
    ],
    [
      /how many (clients|lists).*(each|per|every) folder|clients (in|per) (each )?folder|folders?$/,
      () => {
        if (snap.folders.length === 0) return { kind: 'answer', text: 'There are no folders yet.' };
        const lines = snap.folders.map((f) => `• ${f.name}: ${plural(listsOfFolder(f).length, 'list')}, ${plural(tasksIn(listsOfFolder(f).map((l) => l.id)).length, 'open video')} · QC ${memberName(f.defaultQcId)}`);
        const loose = snap.lists.filter((l) => !l.folderId).length;
        return { kind: 'answer', text: `${lines.join('\n')}${loose ? `\n• Not in a folder: ${plural(loose, 'list')}` : ''}` };
      },
    ],
    [
      /(list|show|all) (the )?(clients|lists)$/,
      () => ({
        kind: 'answer',
        text:
          snap.folders
            .map((f) => `${f.name}\n${listsOfFolder(f).map((l) => `  • ${l.name}`).join('\n') || '  (empty)'}`)
            .join('\n') || 'No lists yet.',
      }),
    ],
    [
      /(most|busiest|biggest|top).*(open|videos|work|tasks)|which clients.*(open|videos|work)/,
      () => {
        const rows = snap.lists.map((l) => ({ l, n: tasksIn([l.id]).length })).filter((r) => r.n > 0).sort((a, b) => b.n - a.n).slice(0, 10);
        if (rows.length === 0) return { kind: 'answer', text: 'No client has open videos right now.' };
        return { kind: 'answer', text: `Most open videos:\n${rows.map((r) => `• ${r.l.name}: ${r.n}`).join('\n')}` };
      },
    ],
    [
      /(waiting|pending|sitting).*(qc|review|approval)|in qc|qc queue/,
      () => {
        const waiting = open.filter((t) => reviewKeys.has(t.status));
        if (waiting.length === 0) return { kind: 'answer', text: 'Nothing is waiting for QC.' };
        const by = new Map<string, SnapTask[]>();
        for (const t of waiting) by.set(memberName(t.qcId), [...(by.get(memberName(t.qcId)) ?? []), t]);
        return {
          kind: 'answer',
          text: [...by.entries()].map(([who, ts]) => `${who} (${ts.length}):\n${ts.slice(0, 8).map((t) => `  • ${t.title} · ${statusName(t.status)} · ${listName(t.listId)}`).join('\n')}`).join('\n'),
        };
      },
    ],
    [
      /overdue|late|past due|missed/,
      () => {
        const late = open.filter((t) => t.dueDate && t.dueDate.slice(0, 10) < snap.today).sort((a, b) => (a.dueDate ?? '').localeCompare(b.dueDate ?? ''));
        if (late.length === 0) return { kind: 'answer', text: 'Nothing is overdue.' };
        return { kind: 'answer', text: `${plural(late.length, 'overdue video')}:\n${late.slice(0, 15).map((t) => `• ${t.title} · due ${t.dueDate?.slice(0, 10)} · ${listName(t.listId)} · editor ${memberName(t.editorId)}`).join('\n')}` };
      },
    ],
    [
      /who('s| is)? (free|available|busy|working|on leave|away|off)|availability|who can take/,
      () => {
        const groups: Record<string, string[]> = {};
        for (const m of snap.members) (groups[m.availability ?? 'NO STATUS'] ??= []).push(`${m.name} (${m.role.replace('_', ' ').toLowerCase()})`);
        return { kind: 'answer', text: Object.entries(groups).map(([k, v]) => `${k.replace('_', ' ')}: ${v.join(', ')}`).join('\n') || 'No members yet.' };
      },
    ],
  ];

  const patterned: [RegExp, (m: RegExpMatchArray) => Reply][] = [
    // who is qc for X
    [
      /who('s| is)? (the )?(qc|reviewer)( reviewer)? (for|of|on) (.+)/,
      (m) => {
        const t = resolve(m[6], ['folder', 'list']);
        if (!t) return notFound(m[6], 'a client or folder');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        if (t.type === 'folder') return { kind: 'answer', text: `${t.folder.name}: ${memberName(t.folder.defaultQcId)} reviews its cuts by default.` };
        if (t.type === 'list') {
          const folder = snap.folders.find((f) => f.id === t.list.folderId);
          const who = t.list.defaultQcId ?? folder?.defaultQcId ?? null;
          return { kind: 'answer', text: `${t.list.name}: ${who ? memberName(who) : 'no default reviewer'}${t.list.defaultQcId ? ' (set on the list)' : folder?.defaultQcId ? ` (from ${folder.name})` : ''}.` };
        }
        return notFound(m[6], 'a client');
      },
    ],
    // what is X working on / tasks of member
    [
      /what (is|does) (.+?) (working on|have|doing)|(.+?)'s (tasks|videos|work)/,
      (m) => {
        const q = m[2] ?? m[4];
        const who = findMember(q);
        if (!who) return notFound(q, 'a person');
        const mine = open.filter((t) => t.editorId === who.item.id || t.qcId === who.item.id);
        if (mine.length === 0) return { kind: 'answer', text: `${who.item.name} has no open videos.` };
        return { kind: 'answer', text: `${who.item.name} has ${plural(mine.length, 'open video')}:\n${mine.slice(0, 15).map((t) => `• ${t.title} · ${statusName(t.status)} · ${t.editorId === who.item.id ? 'editor' : 'QC'}`).join('\n')}` };
      },
    ],
    // status of a task
    [
      /(status|stage) of (.+)|where is (.+)/,
      (m) => {
        const q = m[2] ?? m[3];
        const t = findTask(q);
        if (!t) return notFound(q, 'a video');
        return { kind: 'answer', text: `${t.item.title} is in ${statusName(t.item.status)} (${listName(t.item.listId)}). Editor ${memberName(t.item.editorId)}, QC ${memberName(t.item.qcId)}.` };
      },
    ],
    // videos in a client / how many videos in X
    [
      /(videos|tasks|work) (in|for|of|from) (.+)|how many (videos|tasks) (in|for|does) (.+?)( have)?$/,
      (m) => {
        const q = m[3] ?? m[6];
        const t = resolve(q, ['folder', 'list']);
        if (!t) return notFound(q, 'a client or folder');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        const ids = t.type === 'folder' ? listsOfFolder(t.folder).map((l) => l.id) : t.type === 'list' ? [t.list.id] : [];
        const ts = tasksIn(ids);
        if (ts.length === 0) return { kind: 'answer', text: `${nameOf(t)} has no open videos.` };
        const by = new Map<string, number>();
        for (const x of ts) by.set(statusName(x.status), (by.get(statusName(x.status)) ?? 0) + 1);
        return { kind: 'answer', text: `${nameOf(t)}: ${plural(ts.length, 'open video')}\n${[...by.entries()].map(([s, n]) => `• ${s}: ${n}`).join('\n')}` };
      },
    ],
    // open X (navigation)
    [
      /^(open|go to|show me|take me to) (.+)/,
      (m) => {
        const t = resolve(m[2], ['folder', 'list', 'task']);
        if (!t) return notFound(m[2], 'a client, folder or video');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        if (t.type === 'folder') return { kind: 'answer', text: `Opening ${t.folder.name}.`, link: { label: t.folder.name, to: `/spaces/${t.folder.spaceId}/folders/${t.folder.id}` } };
        if (t.type === 'list') return { kind: 'answer', text: `Opening ${t.list.name}.`, link: { label: t.list.name, to: `/spaces/${t.list.spaceId}/lists/${t.list.id}` } };
        if (t.type === 'task') {
          const l = snap.lists.find((x) => x.id === t.task.listId);
          return { kind: 'answer', text: `Opening ${t.task.title}.`, link: { label: t.task.title, to: l ? `/spaces/${l.spaceId}/lists/${l.id}/tasks/${t.task.id}` : `/everything/tasks/${t.task.id}` } };
        }
        return notFound(m[2], 'a client');
      },
    ],
  ];

  // ---------------------------------------------------------------------------------------------- commands
  const commands: [RegExp, (m: RegExpMatchArray) => Reply][] = [
    // make M (the) qc for X  |  set qc for X to M  |  X qc is M
    [
      /(?:make|set|put) (.+?) (?:as )?(?:the )?(?:qc|reviewer|qc reviewer) (?:for|of|on) (.+)|(?:set|change) (?:the )?(?:qc|reviewer) (?:for|of|on) (.+?) to (.+)/,
      (m) => {
        const whoQ = m[1] ?? m[4];
        const whatQ = m[2] ?? m[3];
        const who = findMember(whoQ);
        if (!who) return notFound(whoQ, 'a person');
        const t = resolve(whatQ, ['folder', 'list', 'task']);
        if (!t) return notFound(whatQ, 'a client, folder or video');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        const person = who.item;
        if (t.type === 'folder') {
          const ids = listsOfFolder(t.folder).map((l) => l.id);
          const n = tasksIn(ids).filter((x) => x.qcId !== person.id).length;
          return {
            kind: 'action',
            summary: `Make ${person.name} the default QC for ${t.folder.name} (${plural(ids.length, 'client')}), and put them on ${plural(n, 'open video')} there.`,
            run: async (exec) => {
              await exec.updateFolder(t.folder.id, { default_qc_id: person.id });
              const done = await reviewOpen(exec, ids, person.id);
              return `${person.name} is now QC for ${t.folder.name}; ${plural(done, 'open video')} reassigned.`;
            },
          };
        }
        if (t.type === 'list') {
          const n = tasksIn([t.list.id]).filter((x) => x.qcId !== person.id).length;
          return {
            kind: 'action',
            summary: `Make ${person.name} the default QC for ${t.list.name}, and put them on ${plural(n, 'open video')}.`,
            run: async (exec) => {
              await exec.updateList(t.list.id, { default_qc_id: person.id });
              const done = await reviewOpen(exec, [t.list.id], person.id);
              return `${person.name} is now QC for ${t.list.name}; ${plural(done, 'open video')} reassigned.`;
            },
          };
        }
        if (t.type === 'task')
          return {
            kind: 'action',
            summary: `Make ${person.name} the QC reviewer of "${t.task.title}".`,
            run: async (exec) => {
              await exec.setAssignee(t.task.id, 'QC_REVIEWER', person.id);
              return `${person.name} now reviews "${t.task.title}".`;
            },
          };
        return notFound(whatQ, 'a client');
      },
    ],
    // shift / move X (from Y) to Z
    [
      /^(?:shift|move|transfer|send) (.+?)(?: from (.+?))? to (.+)/,
      (m) => {
        const what = resolve(m[1], ['list', 'task', 'folder']);
        if (!what) return notFound(m[1], 'a client or video');
        if ('ambiguous' in what) return whichOne(what.ambiguous);
        if (what.type === 'list') {
          const dest = resolve(m[3], ['folder']);
          if (!dest || 'ambiguous' in dest || dest.type !== 'folder') return notFound(m[3], 'a folder');
          const folder = dest.folder;
          const n = tasksIn([what.list.id]).filter((x) => folder.defaultQcId && x.qcId !== folder.defaultQcId).length;
          return {
            kind: 'action',
            summary: `Move ${what.list.name} into ${folder.name}${folder.defaultQcId ? ` and give its ${plural(n, 'open video')} to ${memberName(folder.defaultQcId)} for QC` : ''}.`,
            run: async (exec) => {
              await exec.updateList(what.list.id, { folder_id: folder.id });
              const done = folder.defaultQcId ? await reviewOpen(exec, [what.list.id], folder.defaultQcId) : 0;
              return `${what.list.name} is now in ${folder.name}${folder.defaultQcId ? `; ${plural(done, 'video')} moved to ${memberName(folder.defaultQcId)}` : ' (that folder has no default QC yet)'}.`;
            },
          };
        }
        if (what.type === 'task') {
          const dest = resolve(m[3], ['status', 'list']);
          if (!dest || 'ambiguous' in dest) return notFound(m[3], 'a status or client');
          if (dest.type === 'status') return statusMove(what.task, dest.status);
          if (dest.type === 'list') {
            const list = dest.list;
            return {
              kind: 'action',
              summary: `Move "${what.task.title}" to ${list.name}.`,
              run: async (exec) => {
                await exec.updateTask(what.task.id, { list_id: list.id });
                return `"${what.task.title}" is now in ${list.name}.`;
              },
            };
          }
        }
        return { kind: 'clarify', text: 'I can move a client to another folder, or a video to another status or client.' };
      },
    ],
    // mark X as STATUS
    [
      /^(?:mark|set|change) (.+?) (?:as|to) (.+)/,
      (m) => {
        const role = ROLE_WORDS[clean(m[2]).replace(/^(an?|the) /, '')];
        const person = role ? findMember(m[1].replace(/'s role$| role$/, '')) : null;
        if (role && person) return roleChange(person.item, role);
        const task = findTask(m[1]);
        const status = findStatus(m[2]);
        if (task && status) return statusMove(task.item, status.item);
        return { kind: 'clarify', text: 'Tell me the video and the status, e.g. move "CC R01" to client approved.' };
      },
    ],
    // rename X to Y
    [
      /^rename (.+?) (?:to|as) (.+)/,
      (m) => {
        const t = resolve(m[1], ['list', 'folder', 'task']);
        if (!t) return notFound(m[1], 'a client, folder or video');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        const name = clean(m[2]);
        return {
          kind: 'action',
          summary: `Rename ${nameOf(t)} to "${name}".`,
          run: async (exec) => {
            if (t.type === 'list') await exec.updateList(t.list.id, { name });
            else if (t.type === 'folder') await exec.updateFolder(t.folder.id, { name });
            else if (t.type === 'task') await exec.updateTask(t.task.id, { title: name });
            return `Renamed to "${name}".`;
          },
        };
      },
    ],
    // add / create folder N
    [
      /^(?:add|create|new) (?:a )?folder (?:called |named )?(.+)/,
      (m) => {
        const name = clean(m[1]);
        const space = snap.spaces[0];
        if (!space) return { kind: 'clarify', text: 'Create a space first.' };
        return {
          kind: 'action',
          summary: `Create the folder "${name}" in ${space.name}.`,
          run: async (exec) => {
            await exec.createFolder({ spaceId: space.id, name });
            return `Folder "${name}" created.`;
          },
        };
      },
    ],
    // add / create client|list N (in|to F)
    [
      /^(?:add|create|new) (?:a )?(?:client|list) (?:called |named )?(.+?)(?: (?:in|to|under|into) (.+))?$/,
      (m) => {
        const name = clean(m[1]);
        let folder: SnapFolder | null = null;
        if (m[2]) {
          const f = resolve(m[2], ['folder']);
          if (!f || 'ambiguous' in f || f.type !== 'folder') return notFound(m[2], 'a folder');
          folder = f.folder;
        }
        const spaceId = folder?.spaceId ?? snap.spaces[0]?.id;
        if (!spaceId) return { kind: 'clarify', text: 'Create a space first.' };
        return {
          kind: 'action',
          summary: `Create the client list "${name}"${folder ? ` in ${folder.name}` : ''}.`,
          run: async (exec) => {
            await exec.createList({ spaceId, folderId: folder?.id ?? null, name });
            return `"${name}" created${folder ? ` in ${folder.name}` : ''}.`;
          },
        };
      },
    ],
    // assign X to M (editor)  |  make M editor of X
    [
      /^(?:assign|give) (.+?) to (.+)|^(?:make|set) (.+?) (?:as )?(?:the )?editor (?:of|for|on) (.+)/,
      (m) => {
        const taskQ = m[1] ?? m[4];
        const whoQ = m[2] ?? m[3];
        const who = findMember(whoQ);
        if (!who) return notFound(whoQ, 'a person');
        const t = resolve(taskQ, ['task', 'list']);
        if (!t) return notFound(taskQ, 'a video or client');
        if ('ambiguous' in t) return whichOne(t.ambiguous);
        if (t.type === 'task')
          return {
            kind: 'action',
            summary: `Make ${who.item.name} the editor of "${t.task.title}".`,
            run: async (exec) => {
              await exec.setAssignee(t.task.id, 'EDITOR', who.item.id);
              return `${who.item.name} now edits "${t.task.title}".`;
            },
          };
        if (t.type === 'list') {
          const ts = tasksIn([t.list.id]).filter((x) => x.editorId !== who.item.id);
          return {
            kind: 'action',
            summary: `Make ${who.item.name} the editor of ${plural(ts.length, 'open video')} in ${t.list.name}.`,
            run: async (exec) => {
              for (const x of ts) await exec.setAssignee(x.id, 'EDITOR', who.item.id);
              return `${who.item.name} now edits ${plural(ts.length, 'video')} in ${t.list.name}.`;
            },
          };
        }
        return notFound(taskQ, 'a video');
      },
    ],
    // make M an admin / editor / qc
    [
      /^(?:make|promote|demote) (.+?) (?:an? |the )?(admin|production manager|manager|pm|qc specialist|qc|reviewer|editor|client viewer|client)$/,
      (m) => {
        const who = findMember(m[1]);
        if (!who) return notFound(m[1], 'a person');
        return roleChange(who.item, ROLE_WORDS[m[2]]);
      },
    ],
  ];

  function statusMove(task: SnapTask, status: SnapStatus): Reply {
    return {
      kind: 'action',
      summary: `Move "${task.title}" from ${statusName(task.status)} to ${status.name}.`,
      run: async (exec) => {
        await exec.transition(task.id, status.key);
        return `"${task.title}" is now ${status.name}.`;
      },
    };
  }

  function roleChange(person: SnapMember, role: string): Reply {
    if (person.role === 'OWNER') return { kind: 'clarify', text: 'The owner\'s role cannot be changed here.' };
    return {
      kind: 'action',
      summary: `Change ${person.name}'s role from ${person.role.replace('_', ' ').toLowerCase()} to ${role.replace('_', ' ').toLowerCase()}.`,
      run: async (exec) => {
        await exec.setRole(person.id, role);
        return `${person.name} is now ${role.replace('_', ' ').toLowerCase()}.`;
      },
    };
  }

  return {
    understand(input: string): Reply {
      const text = input
        .trim()
        .replace(/^(please|pls|can you|could you|hey|ok|okay)[, ]+/i, '')
        .replace(/[?!.]+$/, '')
        .replace(/\s+/g, ' ');
      const lower = text.toLowerCase();
      if (!lower) return { kind: 'clarify', text: 'Ask me something, or type "help".' };
      // commands keep the original casing for names ("rename X to 14. JOE RAGO MEDIA")
      for (const [re, fn] of commands) {
        const m = re.exec(lower);
        if (m) {
          const original = new RegExp(re.source, 'i').exec(text);
          return fn(original ?? m);
        }
      }
      for (const [re, fn] of [...patterned, ...answers]) {
        const m = re.exec(lower);
        if (m) return fn(m);
      }
      // a bare name: tell what it is
      const t = resolve(text, ['list', 'folder', 'member', 'task']);
      if (t && !('ambiguous' in t)) {
        if (t.type === 'list') return patterned[3][1](['', '', '', t.list.name] as unknown as RegExpMatchArray);
        if (t.type === 'folder') return patterned[3][1](['', '', '', t.folder.name] as unknown as RegExpMatchArray);
        if (t.type === 'member') return patterned[1][1](['', '', t.member.name] as unknown as RegExpMatchArray);
        if (t.type === 'task') return patterned[2][1](['', '', t.task.title] as unknown as RegExpMatchArray);
      }
      return { kind: 'clarify', text: 'I did not understand that. Type "help" to see what I can do.' };
    },
  };
}
