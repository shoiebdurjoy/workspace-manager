// READ-ONLY export of a ClickUp workspace to a local JSON file (every request is a GET).
//
//   PowerShell:  $env:CLICKUP_TOKEN = "pk_..."; node scripts/clickup-export.mjs
//   bash:        CLICKUP_TOKEN=pk_... node scripts/clickup-export.mjs
//
// The token is a personal API token (ClickUp > your avatar > Settings > Apps > API Token). It is read from the
// environment only, never printed, never written to the output. The file it writes (clickup-export.json) holds
// your company's task data: it is git-ignored, keep it out of chat and out of the repository.
//
// Exports: spaces > folders > lists, and every task of every list (open and closed, with subtasks) with
// status, assignees, priority, dates (start, due, created, closed) and custom fields.
import fs from 'fs';

const TOKEN = process.env.CLICKUP_TOKEN;
if (!TOKEN) {
  console.error('Set CLICKUP_TOKEN first (see the comment at the top of this file).');
  process.exit(2);
}
const OUT = process.argv[2] ?? 'clickup-export.json';
const BASE = 'https://api.clickup.com/api/v2';
let requests = 0;

async function get(path, attempt = 0) {
  requests += 1;
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: TOKEN } });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 15_000));
    return get(path, attempt + 1);
  }
  if (!res.ok) throw new Error(`GET ${path.split('?')[0]} failed: ${res.status}`);
  await new Promise((r) => setTimeout(r, 700)); // stay well under ClickUp's 100 requests / minute
  return res.json();
}

const teams = (await get('/team')).teams ?? [];
console.log(`Workspaces you can read: ${teams.map((t) => t.name).join(', ')}`);
const team = teams[0];
if (!team) throw new Error('No workspace is visible to this token.');

const spaces = (await get(`/team/${team.id}/space?archived=false`)).spaces ?? [];
const lists = [];
for (const space of spaces) {
  for (const folder of (await get(`/space/${space.id}/folder?archived=false`)).folders ?? []) {
    for (const list of folder.lists ?? []) lists.push({ id: list.id, name: list.name, space: space.name, folder: folder.name });
  }
  for (const list of (await get(`/space/${space.id}/list?archived=false`)).lists ?? []) lists.push({ id: list.id, name: list.name, space: space.name, folder: null });
}
console.log(`${spaces.length} spaces, ${lists.length} lists`);

const iso = (ms) => (ms ? new Date(Number(ms)).toISOString() : null);
const tasks = [];
for (const list of lists) {
  for (let page = 0; ; page += 1) {
    const data = await get(`/list/${list.id}/task?include_closed=true&subtasks=true&page=${page}`);
    for (const t of data.tasks ?? []) {
      tasks.push({
        id: t.id,
        parent: t.parent ?? null,
        name: t.name,
        description: t.text_content ?? t.description ?? null,
        list: list.name,
        folder: list.folder,
        space: list.space,
        status: t.status?.status ?? null,
        priority: t.priority?.priority ?? null,
        assignees: (t.assignees ?? []).map((a) => ({ name: a.username, email: a.email })),
        startDate: iso(t.start_date),
        dueDate: iso(t.due_date),
        createdAt: iso(t.date_created),
        closedAt: iso(t.date_closed),
        tags: (t.tags ?? []).map((x) => x.name),
        customFields: (t.custom_fields ?? []).filter((f) => f.value !== undefined && f.value !== null && f.value !== '').map((f) => ({ name: f.name, type: f.type, value: f.value })),
        url: t.url,
      });
    }
    if ((data.tasks ?? []).length < 100 || data.last_page) break;
  }
  process.stdout.write(`\r${tasks.length} tasks read`);
}
console.log('');

fs.writeFileSync(OUT, JSON.stringify({ exportedAt: new Date().toISOString(), workspace: team.name, spaces: spaces.map((s) => s.name), lists, tasks }, null, 2));
console.log(`Wrote ${tasks.length} tasks from ${lists.length} lists to ${OUT} in ${requests} read-only requests.`);
