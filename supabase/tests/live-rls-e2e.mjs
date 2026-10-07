// LIVE end-to-end RLS test for the TBB Workspace database.
//
// Signs in as seven temporary users through the real Supabase Auth + REST API (public
// key only) and checks that every permission rule holds on the REAL project, not a
// simulation. It verifies what actually changed in the data, so a request that is
// refused for the wrong reason (for example a missing GRANT) is reported as a failure.
//
// SAFETY
//   * It WRITES to the linked Supabase project, so it refuses to run unless you confirm
//     the project reference explicitly:
//         PowerShell:  $env:TBB_E2E_CONFIRM_PROJECT_REF = "<project-ref>"; node supabase/tests/live-rls-e2e.mjs
//         bash:        TBB_E2E_CONFIRM_PROJECT_REF=<project-ref> node supabase/tests/live-rls-e2e.mjs
//     (the ref is the first label of VITE_SUPABASE_URL in .env; it is not a secret).
//   * It only touches rows it creates itself: users with the e-mail suffix
//     @tbb-e2e.invalid (never deliverable, no e-mail is ever sent) and workspaces owned by
//     those users. Everything is deleted again in a `finally` block, and the script prints
//     a verification that no test row is left. `--cleanup-only` just runs that cleanup.
//   * Passwords are generated in memory, written only to a temp SQL file that is deleted
//     immediately, and never printed.
//   * Requires the Supabase CLI to be logged in and linked (`npx supabase login`,
//     `npx supabase link --project-ref <ref>`). Users are created with `supabase db query`,
//     which runs as the database owner, so no service-role key is ever needed.
import { createClient } from '@supabase/supabase-js';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { fileURLToPath } from 'url';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const env = Object.fromEntries(
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/)
    .filter((l) => /^[A-Z_]+=/.test(l)).map((l) => [l.split('=')[0], l.slice(l.indexOf('=') + 1).trim()])
);
const URL_ = env.VITE_SUPABASE_URL, KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) { console.error('VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY missing from .env'); process.exit(2); }
const projectRef = new URL(URL_).host.split('.')[0];
if (process.env.TBB_E2E_CONFIRM_PROJECT_REF !== projectRef) {
  console.error(`Refusing to run: this test WRITES to the live project "${projectRef}".\n` +
    `Re-run with TBB_E2E_CONFIRM_PROJECT_REF=${projectRef} to confirm. See the header of this file.`);
  process.exit(2);
}

const TEST_EMAIL_SUFFIX = '@tbb-e2e.invalid';
const RUN = Date.now().toString(36);

function runSql(sql) {
  const file = path.join(os.tmpdir(), `tbb-e2e-${crypto.randomUUID()}.sql`);
  fs.writeFileSync(file, sql);
  try {
    return execFileSync('npx', ['--yes', 'supabase@latest', 'db', 'query', '--linked', '-f', `"${file}"`], {
      cwd: ROOT, shell: true, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// Reads integer columns from the first row of `supabase db query` output.
function runSqlJson(sql) {
  const out = runSql(sql);
  const row = {};
  for (const m of out.matchAll(/"(\w+)":\s*(-?\d+)/g)) row[m[1]] = Number(m[2]);
  return row;
}
const TASK_TABLE_COUNTS_SQL =
  'SELECT (SELECT count(*) FROM public.tasks) AS tasks, (SELECT count(*) FROM public.task_assignees) AS task_assignees, (SELECT count(*) FROM public.subtasks) AS subtasks;';

const CLEANUP_SQL = `
DELETE FROM public.workspaces
  WHERE owner_id IN (SELECT id FROM auth.users WHERE email LIKE '%${TEST_EMAIL_SUFFIX}');
DELETE FROM auth.users WHERE email LIKE '%${TEST_EMAIL_SUFFIX}';
SELECT
  (SELECT count(*) FROM auth.users WHERE email LIKE '%${TEST_EMAIL_SUFFIX}') AS test_users_left,
  (SELECT count(*) FROM public.profiles WHERE email LIKE '%${TEST_EMAIL_SUFFIX}') AS test_profiles_left,
  (SELECT count(*) FROM public.workspace_members WHERE user_id IN
     (SELECT id FROM auth.users WHERE email LIKE '%${TEST_EMAIL_SUFFIX}')) AS test_memberships_left;
`;

function cleanup() {
  const out = runSql(CLEANUP_SQL);
  const left = ['test_users_left', 'test_profiles_left', 'test_memberships_left']
    .map((k) => Number((out.match(new RegExp(`"${k}":\\s*(\\d+)`)) || [])[1] ?? NaN));
  const clean = left.length === 3 && left.every((n) => n === 0);
  console.log(`\nCleanup: ${clean ? 'verified clean (0 test users, profiles and memberships left)' : 'NOT VERIFIED CLEAN: ' + left.join(',')}`);
  return clean;
}

if (process.argv.includes('--cleanup-only')) {
  process.exit(cleanup() ? 0 : 1);
}

const roles = ['owner', 'admin', 'pm', 'qc', 'editor', 'client', 'stranger', 'editor2'];
const U = {};
for (const r of roles) {
  U[r] = {
    id: crypto.randomUUID(),
    email: `e2e-${r}-${RUN}${TEST_EMAIL_SUFFIX}`,
    password: crypto.randomBytes(18).toString('base64url') + 'aA1!',
    name: `E2E ${r}`,
  };
}
const q = (s) => s.replace(/'/g, "''");
let SETUP_SQL = '';
for (const r of roles) {
  const u = U[r];
  // raw_user_meta_data tries to smuggle role=OWNER: the handle_new_user trigger must ignore it.
  SETUP_SQL += `
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
VALUES ('00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated', '${u.email}',
  extensions.crypt('${q(u.password)}', extensions.gen_salt('bf')), now(),
  '{"provider":"email","providers":["email"]}'::jsonb,
  '{"name":"${u.name}","role":"OWNER"}'::jsonb, now(), now(), '', '', '', '', '', '');
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (gen_random_uuid(), '${u.id}', '${u.id}', jsonb_build_object('sub','${u.id}','email','${u.email}','email_verified',true), 'email', now(), now(), now());
`;
}

// TBB is a single-workspace system: clients cannot create workspaces once one exists (migration 5).
// The three fixture workspaces are therefore created by the database owner.
SETUP_SQL += `
INSERT INTO public.workspaces (name, slug, owner_id) VALUES
  ('E2E Workspace', 'e2e-${RUN}', '${U.owner.id}'),
  ('E2E B', 'e2e-b-${RUN}', '${U.pm.id}'),
  ('E2E Stranger', 'e2e-s-${RUN}', '${U.stranger.id}');
`;

// Start from a known state: remove leftovers of an earlier aborted run, then create users.
cleanup();
// What the real tables hold before the test touches anything (the live project has no tasks yet).
const BASELINE = runSqlJson(TASK_TABLE_COUNTS_SQL);
runSql(SETUP_SQL);

let pass = 0, fail = 0;
const failures = [];
const rec = (name, ok, detail = '') => {
  ok ? pass++ : (fail++, failures.push(`${name} ${detail}`));
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
};
let grantRefusals = 0;
const trackingFetch = async (input, init) => {
  const resp = await fetch(input, init);
  const auth = new Headers(init?.headers).get('authorization') || '';
  const signedIn = auth.startsWith('Bearer ') && auth.slice(7) !== KEY;
  if (signedIn && resp.status === 403) {
    const body = await resp.clone().text();
    if (/permission denied for (table|schema|sequence)/.test(body)) grantRefusals++;
  }
  return resp;
};
const mk = () => createClient(URL_, KEY, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: trackingFetch } });
const clients = {};
async function login(role) {
  const c = mk();
  const { data, error } = await c.auth.signInWithPassword({ email: U[role].email, password: U[role].password });
  if (error) throw new Error(`login ${role} failed: ${error.message}`);
  if (data.user.id !== U[role].id) throw new Error(`login ${role}: unexpected user id`);
  clients[role] = c;
}
const denied = (name, res) => rec(name, !!res.error, res.error ? '' : `was allowed (${res.data?.length ?? 0} rows)`);
const noRows = (name, res) => rec(name, !res.error && (res.data?.length ?? 0) === 0, res.error ? res.error.message : `${res.data.length} rows affected`);
const allowed = (name, res) => rec(name, !res.error && (res.data === null || res.data.length >= 1 || true) && !res.error, res.error?.message);
const code = (res) => res.error?.code;

try {
  console.log('== Sign in as each test user (real GoTrue + PostgREST) ==');
  for (const r of Object.keys(U)) await login(r);
  rec(`all ${Object.keys(U).length} test users can sign in`, Object.keys(clients).length === Object.keys(U).length);
  const pre = await clients.owner.from('profiles').select('id').eq('id', U.owner.id);
  if (pre.error && /permission denied for table/.test(pre.error.message)) {
    throw new Error('PREFLIGHT: signed-in users have no table privileges (missing GRANTs). Aborting: every later check would be meaningless.');
  }

  console.log('\n== Anonymous (no session) ==');
  const anon = mk();
  let res = await anon.from('workspaces').select('id');
  rec('anon cannot read workspaces', code(res) === '42501', JSON.stringify(res.error));
  res = await anon.from('tasks').select('id');
  rec('anon cannot read tasks', code(res) === '42501');
  res = await anon.from('profiles').select('id');
  rec('anon cannot read profiles', code(res) === '42501');
  res = await anon.rpc('is_workspace_member', { ws_id: crypto.randomUUID() });
  rec('anon cannot call helper RPC', !!res.error);
  res = await clients.editor.rpc('handle_new_user');
  rec('signed-in user cannot call trigger functions via RPC', !!res.error);
  res = await clients.editor.rpc('is_workspace_member', { ws_id: crypto.randomUUID() });
  rec('authorization helpers are not exposed through the API (private schema)', !!res.error);

  console.log('\n== Profiles (trigger-created) ==');
  res = await clients.owner.from('profiles').select('id,role,full_name').eq('id', U.owner.id);
  rec('profile auto-created for the user', res.data?.length === 1);
  rec('metadata role "OWNER" was ignored (profile role = EDITOR)', res.data?.[0]?.role === 'EDITOR', res.data?.[0]?.role);
  res = await clients.editor.from('profiles').update({ role: 'OWNER' }).eq('id', U.editor.id).select();
  rec('user cannot raise own profile role', code(res) === '42501', JSON.stringify(res.error));
  res = await clients.editor.from('profiles').update({ is_active: false }).eq('id', U.editor.id).select();
  rec('user cannot change own is_active', code(res) === '42501');
  res = await clients.editor.from('profiles').update({ full_name: 'Edited Name' }).eq('id', U.editor.id).select();
  rec('user can edit own display name', !res.error && res.data?.length === 1);
  res = await clients.editor.from('profiles').update({ full_name: 'Hacked' }).eq('id', U.owner.id).select();
  noRows("user cannot edit another user's profile", res);
  const grantBefore = grantRefusals; // refusing INSERT on profiles at GRANT level is the intended design
  res = await clients.stranger.from('profiles').insert({ id: crypto.randomUUID(), email: 'x@tbb-e2e.invalid', full_name: 'x', role: 'OWNER' });
  rec('client cannot insert a profile row (no INSERT grant)', !!res.error);
  grantRefusals = grantBefore;

  console.log('\n== Workspace + membership ==');
  res = await clients.owner.from('workspaces').select('id,slug').eq('slug', `e2e-${RUN}`).single();
  rec('owner can read their workspace', !res.error && !!res.data?.id, res.error?.message);
  const ws = res.data?.id;
  res = await clients.owner.from('workspaces').insert({ name: 'Second', slug: `e2e-second-${RUN}`, owner_id: U.owner.id });
  rec('a second workspace cannot be created from the client (single-workspace rule)', !!res.error, res.error?.message);
  res = await clients.owner.from('workspace_members').select('role').eq('workspace_id', ws).eq('user_id', U.owner.id);
  rec('creator became OWNER automatically', res.data?.[0]?.role === 'OWNER');
  res = await clients.stranger.from('workspaces').insert({ name: 'Forged', slug: `e2e-forged-${RUN}`, owner_id: U.owner.id });
  rec('cannot create a workspace owned by someone else', !!res.error);

  for (const [r, role] of [['admin', 'ADMIN'], ['pm', 'PRODUCTION_MANAGER'], ['qc', 'QC_SPECIALIST'], ['editor', 'EDITOR'], ['client', 'CLIENT_VIEWER'], ['editor2', 'EDITOR']]) {
    res = await clients.owner.from('workspace_members').insert({ workspace_id: ws, user_id: U[r].id, role }).select();
    rec(`owner adds ${role}`, !res.error && res.data?.length === 1, res.error?.message);
  }
  res = await clients.stranger.from('workspace_members').insert({ workspace_id: ws, user_id: U.stranger.id, role: 'OWNER' });
  rec('outsider cannot add themselves', !!res.error);
  res = await clients.editor.from('workspace_members').insert({ workspace_id: ws, user_id: U.stranger.id, role: 'EDITOR' });
  rec('editor cannot add members', !!res.error);
  res = await clients.admin.from('workspace_members').insert({ workspace_id: ws, user_id: U.stranger.id, role: 'OWNER' });
  rec('admin cannot create an OWNER', !!res.error);
  res = await clients.admin.from('workspace_members').update({ role: 'EDITOR' }).eq('workspace_id', ws).eq('user_id', U.owner.id).select();
  noRows('admin cannot demote the OWNER', res);
  res = await clients.admin.from('workspace_members').update({ role: 'OWNER' }).eq('workspace_id', ws).eq('user_id', U.admin.id).select();
  rec('admin cannot promote self to OWNER', !!res.error || res.data.length === 0);
  res = await clients.admin.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', U.owner.id).select();
  noRows('admin cannot remove the OWNER', res);
  res = await clients.owner.from('workspace_members').update({ role: 'ADMIN' }).eq('workspace_id', ws).eq('user_id', U.owner.id).select();
  rec('last OWNER cannot demote self', !!res.error);
  res = await clients.owner.from('workspace_members').delete().eq('workspace_id', ws).eq('user_id', U.owner.id).select();
  rec('last OWNER cannot leave', !!res.error);
  res = await clients.editor.from('workspace_members').update({ role: 'ADMIN' }).eq('workspace_id', ws).eq('user_id', U.editor.id).select();
  noRows('editor cannot promote self', res);

  console.log('\n== Visibility / tenant isolation ==');
  res = await clients.stranger.from('workspaces').select('id').eq('id', ws);
  noRows('outsider cannot see the workspace', res);
  res = await clients.editor.from('workspaces').select('id').eq('id', ws);
  rec('member sees the workspace', res.data?.length === 1);
  res = await clients.editor.from('profiles').select('id').eq('id', U.owner.id);
  rec('staff can see colleague profiles', res.data?.length === 1);
  res = await clients.stranger.from('profiles').select('id').eq('id', U.owner.id);
  noRows('outsider cannot see staff profiles', res);
  res = await clients.client.from('workspace_members').select('user_id').eq('workspace_id', ws);
  rec('client viewer sees only their own membership', res.data?.length === 1 && res.data[0].user_id === U.client.id);

  console.log('\n== Hierarchy permissions ==');
  res = await clients.pm.from('spaces').insert({ workspace_id: ws, name: 'Content', slug: 'content' });
  rec('production manager cannot create spaces', !!res.error);
  res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Content', slug: 'content' }).select().single();
  rec('admin creates space (defaults applied: icon, color)', !res.error && res.data?.icon === 'folder' && res.data?.color === '#7B68EE', res.error?.message);
  const space = res.data?.id;
  res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Secret', slug: 'secret', is_private: true });
  rec('private spaces rejected (fail closed)', !!res.error);
  res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Design', slug: 'design' }).select().single();
  const space2 = res.data?.id;
  res = await clients.pm.from('folders').insert({ space_id: space, name: 'CONTENT PIPELINE - ZIM' }).select().single();
  rec('manager creates folder (workspace_id derived)', !res.error && res.data?.workspace_id === ws, res.error?.message);
  const folder = res.data?.id;
  res = await clients.editor.from('folders').insert({ space_id: space, name: 'Nope' });
  rec('editor cannot create folders', !!res.error);
  res = await clients.pm.from('lists').insert({ space_id: space, folder_id: folder, name: '25. EDAPTX' }).select().single();
  rec('manager creates list in folder', !res.error, res.error?.message);
  const list = res.data?.id;
  res = await clients.pm.from('lists').insert({ space_id: space2, folder_id: folder, name: 'Wrong space' });
  rec('list cannot use a folder from a different space', !!res.error);
  res = await clients.pm.from('lists').insert({ space_id: space2, name: 'Other list' }).select().single();
  const list2 = res.data?.id;
  res = await clients.admin.from('folders').delete().eq('id', folder).select();
  rec('folder that still has lists cannot be deleted', !!res.error);
  res = await clients.pm.from('spaces').delete().eq('id', space2).select();
  noRows('manager cannot delete spaces', res);

  console.log('\n== Tasks: roles and the QC gate ==');
  res = await clients.pm.from('tasks').insert({ list_id: list, title: 'Video 1', created_by: U.owner.id, workspace_id: crypto.randomUUID() }).select().single();
  rec('manager creates task', !res.error, res.error?.message);
  const task = res.data?.id;
  rec('created_by forced to the caller (forgery ignored)', res.data?.created_by === U.pm.id);
  rec('workspace_id forced from the list (forgery ignored)', res.data?.workspace_id === ws);
  res = await clients.editor.from('tasks').insert({ list_id: list, title: 'Sneaky' });
  rec('editor cannot create tasks', !!res.error);
  res = await clients.client.from('tasks').insert({ list_id: list, title: 'Sneaky' });
  rec('client viewer cannot create tasks', !!res.error);
  res = await clients.stranger.from('tasks').select('id');
  noRows('outsider sees no tasks', res);
  res = await clients.client.from('tasks').select('id');
  noRows('client viewer sees no tasks (fail closed)', res);
  res = await clients.client.from('tasks').update({ status: 'COMPLETED' }).eq('id', task).select();
  noRows('client viewer cannot update tasks', res);
  res = await clients.stranger.from('tasks').update({ title: 'pwn' }).eq('id', task).select();
  noRows('outsider cannot update tasks', res);

  // Phase 6 tightening (migration 7): an editor acts only on tasks assigned to them.
  res = await clients.editor.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', task).select();
  rec('editor cannot change a task that is NOT assigned to them', code(res) === '42501', JSON.stringify(res.error));
  res = await clients.pm.rpc('set_task_assignee', { p_task_id: task, p_role_type: 'EDITOR', p_user_id: U.editor.id });
  rec('manager assigns the editor to the task', !res.error, res.error?.message);
  res = await clients.editor.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', task).select();
  rec('editor can start work', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.editor.from('tasks').update({ status: 'IN_QC', position: 2 }).eq('id', task).select();
  rec('editor can submit to QC and reorder', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.editor.from('tasks').update({ status: 'READY_TO_DELIVER' }).eq('id', task).select();
  rec('EDITOR CANNOT SELF-APPROVE (READY_TO_DELIVER)', code(res) === '42501', JSON.stringify(res.error));
  res = await clients.editor.from('tasks').update({ status: 'COMPLETED' }).eq('id', task).select();
  rec('editor cannot complete tasks', code(res) === '42501');
  res = await clients.editor.from('tasks').update({ title: 'Renamed' }).eq('id', task).select();
  rec('editor cannot edit title', code(res) === '42501');
  res = await clients.editor.from('tasks').update({ list_id: list2 }).eq('id', task).select();
  rec('editor cannot move task to another list', code(res) === '42501');
  res = await clients.editor.from('tasks').delete().eq('id', task).select();
  noRows('editor cannot delete tasks', res);
  res = await clients.qc.from('tasks').update({ status: 'READY_TO_DELIVER' }).eq('id', task).select();
  rec('QC approves (IN_QC -> READY_TO_DELIVER)', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.qc.from('tasks').update({ status: 'CLIENT_REVIEW' }).eq('id', task).select();
  rec('QC delivers to client review', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.qc.from('tasks').update({ status: 'COMPLETED' }).eq('id', task).select();
  rec('QC cannot complete tasks', code(res) === '42501');
  res = await clients.qc.from('tasks').update({ title: 'QC edit' }).eq('id', task).select();
  rec('QC cannot edit task fields', code(res) === '42501');
  res = await clients.editor.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', task).select();
  rec('editor cannot pull a delivered task back', code(res) === '42501');
  res = await clients.pm.from('tasks').update({ status: 'COMPLETED', title: 'Final cut' }).eq('id', task).select();
  rec('manager can complete and edit', !res.error && res.data?.length === 1, res.error?.message);

  console.log('\n== Cross-workspace isolation ==');
  res = await clients.pm.from('workspaces').select('id').eq('slug', `e2e-b-${RUN}`).single();
  const wsB = res.data?.id;
  rec('pm can read their own second workspace', !!wsB, res.error?.message);
  res = await clients.pm.from('spaces').insert({ workspace_id: wsB, name: 'S', slug: 's' }).select().single();
  const spB = res.data?.id;
  res = await clients.pm.from('lists').insert({ space_id: spB, name: 'L' }).select().single();
  const listB = res.data?.id;
  res = await clients.pm.from('tasks').update({ list_id: listB }).eq('id', task).select();
  rec('task cannot be moved into another workspace', code(res) === '42501', JSON.stringify(res.error));
  res = await clients.editor.from('tasks').select('id').eq('workspace_id', wsB);
  noRows("workspace A staff cannot see workspace B's tasks", res);
  res = await clients.pm.from('tasks').insert({ list_id: listB, title: 'B task' }).select();
  rec('pm can work in their own second workspace', !res.error && res.data?.length === 1);

  console.log('\n== Subtasks ==');
  res = await clients.pm.from('subtasks').insert({ task_id: task, title: 'Cut intro' }).select().single();
  rec('manager creates subtask (workspace_id derived)', !res.error && res.data?.workspace_id === ws, res.error?.message);
  const sub = res.data?.id;
  res = await clients.editor.from('subtasks').update({ is_completed: true }).eq('id', sub).select();
  rec('editor can tick a subtask', !res.error && res.data?.length === 1);
  res = await clients.editor.from('subtasks').update({ title: 'x' }).eq('id', sub).select();
  rec('editor cannot rename a subtask', code(res) === '42501');
  res = await clients.editor.from('subtasks').insert({ task_id: task, title: 'x' });
  rec('editor cannot add subtasks', !!res.error);
  res = await clients.client.from('subtasks').select('id');
  noRows('client viewer sees no subtasks', res);

  console.log('\n== Phase 4: invitations, sign-in gate and pods (live) ==');
  const createAuthUser = (email, confirmed) => {
    const u = { id: crypto.randomUUID(), email, password: crypto.randomBytes(18).toString('base64url') + 'aA1!' };
    runSql(`
INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change, email_change_token_current, reauthentication_token)
VALUES ('00000000-0000-0000-0000-000000000000', '${u.id}', 'authenticated', 'authenticated', '${u.email}',
  extensions.crypt('${q(u.password)}', extensions.gen_salt('bf')), ${confirmed ? 'now()' : 'NULL'},
  '{"provider":"email","providers":["email"]}'::jsonb, '{"name":"E2E invitee","role":"OWNER"}'::jsonb, now(), now(), '', '', '', '', '', '');
INSERT INTO auth.identities (id, provider_id, user_id, identity_data, provider, last_sign_in_at, created_at, updated_at)
VALUES (gen_random_uuid(), '${u.id}', '${u.id}', jsonb_build_object('sub','${u.id}','email','${u.email}','email_verified',${confirmed}), 'email', now(), now(), now());`);
    return u;
  };
  const inviteeEmail = `e2e-invitee-${RUN}${TEST_EMAIL_SUFFIX}`;
  res = await clients.admin.from('workspace_invitations').insert({ workspace_id: ws, email: inviteeEmail.toUpperCase(), role: 'QC_SPECIALIST' }).select().single();
  rec('admin invites an unregistered address (stored lower-case)', !res.error && res.data?.email === inviteeEmail, res.error?.message);
  const invId = res.data?.id;
  rec('invited_by is the admin', res.data?.invited_by === U.admin.id);
  for (const role of ['pm', 'qc', 'editor', 'client', 'stranger']) {
    res = await clients[role].from('workspace_invitations').insert({ workspace_id: ws, email: `x-${role}@tbb-e2e.invalid`, role: 'EDITOR' });
    rec(`${role} cannot invite`, !!res.error);
    res = await clients[role].from('workspace_invitations').select('id').eq('workspace_id', ws);
    noRows(`${role} cannot see invitations`, res);
  }
  res = await clients.admin.from('workspace_invitations').insert({ workspace_id: ws, email: 'boss@tbb-e2e.invalid', role: 'OWNER' });
  rec('OWNER cannot be granted by invitation', !!res.error);
  res = await clients.admin.from('workspace_invitations').insert({ workspace_id: ws, email: inviteeEmail, role: 'EDITOR' });
  rec('duplicate open invitation rejected', !!res.error);
  {
    const before = grantRefusals; // the missing UPDATE grant is the intended refusal here
    res = await clients.admin.from('workspace_invitations').update({ role: 'ADMIN' }).eq('id', invId).select();
    rec('invitations cannot be edited from the client', !!res.error);
    grantRefusals = before;
  }

  // The invitee registers. Until the e-mail is confirmed they cannot even sign in, and
  // confirming it is what grants the invited role.
  const invitee = createAuthUser(inviteeEmail, false);
  {
    const c = mk();
    const login = await c.auth.signInWithPassword({ email: invitee.email, password: invitee.password });
    rec('unconfirmed account cannot sign in', !!login.error && login.error.code === 'email_not_confirmed', login.error?.code);
  }
  runSql(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = '${invitee.id}'`);
  {
    const c = mk();
    const login = await c.auth.signInWithPassword({ email: invitee.email, password: invitee.password });
    rec('after confirmation the invitee signs in', !login.error, login.error?.message);
    const mine = await c.from('workspace_members').select('role,workspace_id').eq('user_id', invitee.id);
    rec('invitee received exactly the invited role (QC_SPECIALIST)', mine.data?.length === 1 && mine.data[0].role === 'QC_SPECIALIST' && mine.data[0].workspace_id === ws, JSON.stringify(mine.data));
    const prof = await c.from('profiles').select('role').eq('id', invitee.id).single();
    rec('invitee profile role is EDITOR (metadata role ignored)', prof.data?.role === 'EDITOR', prof.data?.role);
    const seen = await c.from('workspaces').select('id');
    rec('invitee sees only the workspace they were invited to', seen.data?.length === 1 && seen.data[0].id === ws);
    const esc = await c.from('workspace_members').update({ role: 'OWNER' }).eq('user_id', invitee.id).select();
    rec('invitee cannot escalate their role', !!esc.error || esc.data?.length === 0);
  }
  res = await clients.admin.from('workspace_invitations').select('accepted_at,accepted_by').eq('id', invId).single();
  rec('invitation shows as accepted by the invitee', !!res.data?.accepted_at && res.data?.accepted_by === invitee.id);

  // A registered but never-invited, confirmed account has no access to anything.
  const uninvited = createAuthUser(`e2e-uninvited-${RUN}${TEST_EMAIL_SUFFIX}`, true);
  {
    const c = mk();
    const login = await c.auth.signInWithPassword({ email: uninvited.email, password: uninvited.password });
    rec('uninvited user can sign in (they have an account)', !login.error, login.error?.message);
    for (const t of ['workspaces', 'workspace_members', 'spaces', 'lists', 'tasks', 'teams', 'workspace_invitations']) {
      const r2 = await c.from(t).select('*');
      rec(`...but sees no rows in ${t}`, !r2.error && r2.data.length === (t === 'workspace_members' ? 0 : 0), r2.error?.message);
    }
    const mkWs = await c.from('workspaces').insert({ name: 'Rogue', slug: `e2e-rogue-${RUN}`, owner_id: uninvited.id });
    rec('...and cannot create their own workspace', !!mkWs.error);
    const self = await c.from('profiles').select('id').eq('id', uninvited.id);
    rec('...but can read their own profile', self.data?.length === 1);
  }

  // Pods
  res = await clients.admin.from('teams').insert({ workspace_id: ws, name: 'E2E Pod Zim', lead_id: U.pm.id }).select().single();
  rec('admin creates a pod with a lead', !res.error, res.error?.message);
  const team = res.data?.id;
  for (const role of ['pm', 'editor', 'qc', 'client', 'stranger']) {
    res = await clients[role].from('teams').insert({ workspace_id: ws, name: `Pod by ${role}` });
    rec(`${role} cannot create pods`, !!res.error);
  }
  res = await clients.admin.from('teams').insert({ workspace_id: ws, name: 'e2e pod zim' });
  rec('pod names are unique per workspace', !!res.error);
  res = await clients.admin.from('teams').insert({ workspace_id: ws, name: 'Bad lead', lead_id: U.stranger.id });
  rec('pod lead must be a workspace member', !!res.error);
  res = await clients.editor.from('teams').select('id').eq('workspace_id', ws);
  rec('staff can read pods', res.data?.length === 1);
  res = await clients.client.from('teams').select('id');
  noRows('client viewer cannot read pods', res);
  res = await clients.stranger.from('teams').select('id');
  noRows('outsider cannot read pods', res);
  res = await clients.pm.from('team_members').insert({ team_id: team, user_id: U.editor.id }).select();
  rec('production manager adds a pod member', !res.error && res.data?.[0]?.workspace_id === ws, res.error?.message);
  res = await clients.editor.from('team_members').insert({ team_id: team, user_id: U.qc.id });
  rec('editor cannot add pod members', !!res.error);
  res = await clients.pm.from('team_members').insert({ team_id: team, user_id: U.stranger.id });
  rec('non-members cannot join a pod', !!res.error);
  res = await clients.editor.from('team_members').delete().eq('team_id', team).eq('user_id', U.editor.id).select();
  noRows('editor cannot remove pod members', res);
  res = await clients.pm.from('teams').delete().eq('id', team).select();
  noRows('production manager cannot delete pods', res);
  res = await clients.admin.from('teams').delete().eq('id', team).select();
  rec('admin deletes the pod (members cascade)', !res.error && res.data?.length === 1);

  console.log('\n== Phase 5: hierarchy (live) ==');
  {
    // The sidebar's exact tree query, as the app runs it
    const loadTree = async (c, workspaceId) => {
      const [s, f, l] = await Promise.all([
        c.from('spaces').select('id, workspace_id, name, slug, description, icon, color, is_private, position, created_at, updated_at').eq('workspace_id', workspaceId).order('position').order('name'),
        c.from('folders').select('id, workspace_id, space_id, name, description, position, is_collapsed_default, created_at, updated_at').eq('workspace_id', workspaceId).order('position').order('name'),
        c.from('lists').select('id, workspace_id, space_id, folder_id, name, description, color, position, created_at, updated_at').eq('workspace_id', workspaceId).order('position').order('name'),
      ]);
      return { spaces: s, folders: f, lists: l, ok: !s.error && !f.error && !l.error };
    };

    // presentation constraints
    res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Bad color', slug: `bad-c-${RUN}`, color: 'red' });
    rec('space color must be #RRGGBB', !!res.error);
    res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Bad icon', slug: `bad-i-${RUN}`, icon: 'Not An Icon' });
    rec('space icon must be a slug', !!res.error);
    res = await clients.pm.from('lists').insert({ space_id: space, name: 'Bad list color', color: 'url(x)' });
    rec('list color is validated', !!res.error);

    // cross-workspace parent injection
    res = await clients.admin.from('folders').insert({ space_id: spB, name: 'Injected' });
    rec("admin of A cannot create a folder under B's space", !!res.error);
    res = await clients.admin.from('lists').insert({ space_id: spB, name: 'Injected' });
    rec("admin of A cannot create a list under B's space", !!res.error);
    res = await clients.admin.from('spaces').insert({ workspace_id: wsB, name: 'Injected', slug: `inj-${RUN}` });
    rec('admin of A cannot create a space in B', !!res.error);
    res = await clients.pm.from('lists').insert({ space_id: spB, folder_id: folder, name: 'Cross nest' });
    rec('a manager of BOTH workspaces cannot nest a list under the other workspace\'s folder', !!res.error);

    // refused roles
    for (const role of ['editor', 'qc', 'client', 'stranger']) {
      res = await clients[role].from('spaces').update({ name: 'pwn' }).eq('id', space).select();
      noRows(`${role} cannot rename a space`, res);
      res = await clients[role].from('folders').update({ name: 'pwn' }).eq('id', folder).select();
      noRows(`${role} cannot rename a folder`, res);
      res = await clients[role].from('lists').update({ name: 'pwn' }).eq('id', list).select();
      noRows(`${role} cannot rename a list`, res);
      res = await clients[role].from('lists').delete().eq('id', list).select();
      noRows(`${role} cannot delete a list`, res);
      res = await clients[role].from('folders').delete().eq('id', folder).select();
      noRows(`${role} cannot delete a folder`, res);
      res = await clients[role].from('spaces').delete().eq('id', space2).select();
      noRows(`${role} cannot delete a space`, res);
    }
    res = await clients.pm.from('spaces').update({ name: 'pwn' }).eq('id', space).select();
    noRows('production manager cannot edit spaces', res);
    res = await clients.pm.from('folders').delete().eq('id', folder).select();
    noRows('production manager cannot delete folders', res);

    // managers and admins
    res = await clients.pm.from('folders').update({ name: 'ZIM renamed' }).eq('id', folder).select().single();
    rec('production manager renames a folder', !res.error && res.data?.name === 'ZIM renamed', res.error?.message);
    res = await clients.pm.from('lists').update({ name: 'EDAPTX renamed', color: '#22C55E' }).eq('id', list).select().single();
    rec('production manager renames and recolors a list', !res.error && res.data?.name === 'EDAPTX renamed' && res.data?.color === '#22C55E', res.error?.message);
    res = await clients.pm.from('folders').insert({ space_id: space, name: 'Second folder', position: 1 }).select().single();
    rec('production manager creates a folder', !res.error, res.error?.message);
    const folder2 = res.data?.id;
    res = await clients.pm.from('lists').update({ folder_id: folder2 }).eq('id', list).select().single();
    rec('a list moves to another folder in the same space', !res.error && res.data?.folder_id === folder2, res.error?.message);
    res = await clients.pm.from('lists').update({ folder_id: folder }).eq('id', list2).select();
    rec('a list cannot move into a folder of another space', !!res.error);
    res = await clients.admin.from('spaces').update({ name: 'Content renamed', color: '#EF4444', icon: 'rocket' }).eq('id', space).select().single();
    rec('admin edits a space', !res.error && res.data?.icon === 'rocket' && res.data?.color === '#EF4444', res.error?.message);

    // atomic, permission-checked reordering through the real API
    res = await clients.admin.rpc('reorder_hierarchy', { kind: 'space', ids: [space2, space] });
    rec('admin reorders spaces through reorder_hierarchy', !res.error && res.data === 2, res.error?.message);
    let tree = await loadTree(clients.admin, ws);
    rec('...and the sidebar query returns that order', tree.ok && tree.spaces.data.map((s) => s.id).join() === [space2, space].join());
    res = await clients.pm.rpc('reorder_hierarchy', { kind: 'space', ids: [space, space2] });
    rec('production manager cannot reorder spaces', !!res.error);
    res = await clients.pm.rpc('reorder_hierarchy', { kind: 'folder', ids: [folder2, folder] });
    rec('production manager reorders folders', !res.error && res.data === 2, res.error?.message);
    res = await clients.editor.rpc('reorder_hierarchy', { kind: 'folder', ids: [folder, folder2] });
    rec('editor cannot reorder', !!res.error);
    res = await clients.stranger.rpc('reorder_hierarchy', { kind: 'folder', ids: [folder, folder2] });
    rec('outsider cannot reorder', !!res.error);
    res = await anon.rpc('reorder_hierarchy', { kind: 'folder', ids: [folder, folder2] });
    rec('anon cannot call reorder_hierarchy', !!res.error);
    res = await clients.admin.rpc('reorder_hierarchy', { kind: 'list', ids: [list, listB] });
    rec("mixing in another workspace's list fails the whole reorder", !!res.error);
    res = await clients.admin.from('lists').select('position').eq('id', list).single();
    const positionAfterRefusal = res.data?.position;
    res = await clients.admin.rpc('reorder_hierarchy', { kind: 'list', ids: [list, listB] });
    res = await clients.admin.from('lists').select('position').eq('id', list).single();
    rec('...and nothing changed (atomic)', res.data?.position === positionAfterRefusal);

    // deleting
    res = await clients.admin.from('folders').delete().eq('id', folder2).select();
    rec('a folder that still has lists cannot be deleted', !!res.error);
    res = await clients.pm.from('spaces').insert({ workspace_id: ws, name: 'Temp', slug: `temp-${RUN}` });
    rec('production manager cannot create a space', !!res.error);
    res = await clients.admin.from('spaces').insert({ workspace_id: ws, name: 'Temp space', slug: `temp-${RUN}`, position: 9 }).select().single();
    const tempSpace = res.data?.id;
    res = await clients.pm.from('folders').insert({ space_id: tempSpace, name: 'Temp folder' }).select().single();
    const tempFolder = res.data?.id;
    res = await clients.pm.from('lists').insert({ space_id: tempSpace, folder_id: tempFolder, name: 'Temp list' }).select().single();
    const tempList = res.data?.id;
    res = await clients.admin.from('spaces').delete().eq('id', tempSpace).select();
    rec('admin deletes a space', !res.error && res.data?.length === 1, res.error?.message);
    res = await clients.admin.from('lists').select('id').eq('id', tempList);
    const resFolder = await clients.admin.from('folders').select('id').eq('id', tempFolder);
    rec('...its folders and lists are gone with it', res.data?.length === 0 && resFolder.data?.length === 0);

    // tree retrieval and persistence
    tree = await loadTree(clients.editor, ws);
    rec('editor loads the full tree with the app\'s query', tree.ok && tree.spaces.data.length >= 2 && tree.lists.data.length >= 1);
    tree = await loadTree(clients.client, ws);
    rec('client viewer gets an empty tree', tree.ok && tree.spaces.data.length === 0 && tree.folders.data.length === 0 && tree.lists.data.length === 0);
    tree = await loadTree(clients.stranger, ws);
    rec('outsider gets an empty tree for the workspace', tree.ok && tree.spaces.data.length === 0);
    tree = await loadTree(clients.editor, wsB);
    rec("workspace A staff get nothing for workspace B", tree.ok && tree.spaces.data.length === 0 && tree.lists.data.length === 0);
    const fresh = mk();
    const relog = await fresh.auth.signInWithPassword({ email: U.admin.email, password: U.admin.password });
    const before = (await loadTree(clients.admin, ws)).spaces.data.map((s) => `${s.id}:${s.name}`).join();
    const afterLogin = relog.error ? null : (await loadTree(fresh, ws)).spaces.data.map((s) => `${s.id}:${s.name}`).join();
    rec('signing out and back in shows the same hierarchy', !relog.error && afterLogin === before && before.length > 0);
  }

  console.log('\n== Privilege-escalation & cross-tenant attacks ==');
  // anon write attempts
  res = await anon.from('workspaces').insert({ name: 'anon', slug: `e2e-anon-${RUN}`, owner_id: U.owner.id });
  rec('anon cannot insert workspaces', !!res.error);
  res = await anon.from('tasks').insert({ list_id: list, title: 'anon' });
  rec('anon cannot insert tasks', !!res.error);
  res = await anon.from('profiles').update({ role: 'OWNER' }).eq('id', U.editor.id).select();
  rec('anon cannot update profiles', !!res.error);
  // stranger owns their own workspace and tries to reach into workspace A
  res = await clients.stranger.from('workspaces').select('id,slug').eq('slug', `e2e-s-${RUN}`).single();
  rec('outsider only sees their own separate workspace', !res.error && !!res.data?.id, res.error?.message);
  res = await clients.stranger.from('workspaces').select('id');
  rec('...and nothing else (exactly one workspace visible)', res.data?.length === 1);
  res = await clients.stranger.from('spaces').insert({ workspace_id: ws, name: 'Intruder', slug: 'intruder' });
  rec('outsider (even as owner elsewhere) cannot create a space in workspace A', !!res.error);
  res = await clients.stranger.from('folders').insert({ space_id: space, name: 'Intruder' });
  rec('outsider cannot create a folder under workspace A space', !!res.error);
  res = await clients.stranger.from('lists').insert({ space_id: space, name: 'Intruder' });
  rec('outsider cannot create a list under workspace A space', !!res.error);
  res = await clients.stranger.from('tasks').insert({ list_id: list, title: 'Intruder' });
  rec('outsider cannot create a task in workspace A list', !!res.error);
  res = await clients.stranger.from('subtasks').insert({ task_id: task, title: 'Intruder' });
  rec('outsider cannot create a subtask on workspace A task', !!res.error);
  res = await clients.stranger.from('workspace_members').select('user_id').eq('workspace_id', ws);
  noRows('outsider cannot list workspace A members', res);
  res = await clients.stranger.from('workspaces').update({ name: 'Taken over' }).eq('id', ws).select();
  noRows('outsider cannot rename workspace A', res);
  res = await clients.stranger.from('workspaces').delete().eq('id', ws).select();
  noRows('outsider cannot delete workspace A', res);
  // ownership / role escalation inside workspace A
  res = await clients.owner.from('workspaces').update({ owner_id: U.admin.id }).eq('id', ws).select();
  rec('even the owner cannot reassign workspace owner_id from the client', !!res.error, JSON.stringify(res.data));
  res = await clients.editor.from('workspaces').update({ name: 'Editor rename' }).eq('id', ws).select();
  noRows('editor cannot rename the workspace', res);
  res = await clients.pm.from('workspaces').update({ name: 'PM rename' }).eq('id', ws).select();
  noRows('production manager cannot rename the workspace', res);
  res = await clients.admin.from('workspaces').update({ description: 'admin edit' }).eq('id', ws).select();
  rec('admin CAN edit workspace details (allowed)', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.admin.from('workspace_members').update({ user_id: U.stranger.id }).eq('workspace_id', ws).eq('user_id', U.pm.id).select();
  rec('membership identity (user_id) cannot be rewritten', !!res.error);
  res = await clients.qc.from('tasks').insert({ list_id: list, title: 'QC create' });
  rec('QC cannot create tasks', !!res.error);
  res = await clients.qc.from('workspace_members').update({ role: 'OWNER' }).eq('workspace_id', ws).eq('user_id', U.qc.id).select();
  noRows('QC cannot promote self to OWNER', res);
  res = await clients.client.from('workspace_members').update({ role: 'EDITOR' }).eq('workspace_id', ws).eq('user_id', U.client.id).select();
  noRows('client viewer cannot promote self', res);
  res = await clients.pm.from('workspace_members').insert({ workspace_id: ws, user_id: U.stranger.id, role: 'ADMIN' });
  rec('production manager cannot add members', !!res.error);
  res = await clients.editor.from('profiles').update({ role: 'OWNER', is_active: true }).eq('id', U.editor.id).select();
  rec('profile role cannot be escalated together with other fields', !!res.error);
  // after all of that, nothing actually changed
  res = await clients.owner.from('workspaces').select('name,owner_id').eq('id', ws).single();
  rec('workspace name and owner unchanged after attacks', res.data?.name === 'E2E Workspace' && res.data?.owner_id === U.owner.id, JSON.stringify(res.data));
  res = await clients.owner.from('workspace_members').select('user_id,role').eq('workspace_id', ws);
  const roleOf = Object.fromEntries((res.data || []).map((m) => [m.user_id, m.role]));
  rec('every membership role unchanged after attacks',
    roleOf[U.owner.id] === 'OWNER' && roleOf[U.admin.id] === 'ADMIN' && roleOf[U.pm.id] === 'PRODUCTION_MANAGER' &&
    roleOf[U.qc.id] === 'QC_SPECIALIST' && roleOf[U.editor.id] === 'EDITOR' && roleOf[U.client.id] === 'CLIENT_VIEWER' && !roleOf[U.stranger.id],
    JSON.stringify(roleOf));

  console.log('\n== Phase 6: task engine (live) ==');
  {
    // Fresh list so ordering assertions are not affected by earlier fixtures.
    res = await clients.pm.from('lists').insert({ space_id: space, folder_id: folder, name: 'P6 DELIVERABLES' }).select().single();
    rec('manager creates a list for the task-engine checks', !res.error, res.error?.message);
    const l6 = res.data?.id;
    const ids = {};
    const rpc = (who, fn, args) => clients[who].rpc(fn, args);
    const dt = (days) => new Date(Date.now() + days * 86400000).toISOString();

    // ---- create_task: one transaction, assignees linked, position appended ----
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: '  Episode A  ', p_description: 'brief', p_priority: 'HIGH', p_aspect_ratio: '9:16', p_raw_footage_link: 'https://drive.google.com/x', p_due_date: dt(2), p_client_deadline: dt(5), p_editor_id: U.editor.id, p_qc_id: U.qc.id });
    rec('create_task: manager creates a deliverable with editor + QC in one call', !res.error && !!res.data?.id, res.error?.message);
    ids.a = res.data?.id;
    rec('create_task: title trimmed, created_by + workspace derived, position 0', res.data?.title === 'Episode A' && res.data?.created_by === U.pm.id && res.data?.workspace_id === ws && res.data?.position === 0, JSON.stringify(res.data));
    res = await rpc('admin', 'create_task', { p_list_id: l6, p_title: 'Episode B' });
    ids.b = res.data?.id;
    rec('create_task: next task appends at position 1 with defaults', !res.error && res.data?.position === 1 && res.data?.status === 'TODO' && res.data?.priority === 'MEDIUM', res.error?.message);
    res = await rpc('owner', 'create_task', { p_list_id: l6, p_title: 'Episode C' });
    ids.c = res.data?.id;
    rec('create_task: third task appends at position 2', res.data?.position === 2);

    // ---- the exact query shapes the app uses, through the real PostgREST ----
    // exactly TASK_SUMMARY_SELECT from src/database/task-mappers.ts (the list workspace's row query)
    const SUMMARY = 'id, list_id, title, status, priority, position, aspect_ratio, due_date, client_deadline, raw_footage_link, project_file_link, review_link, final_export_link, created_at, updated_at, task_assignees(role_type, user_id), subtasks(is_completed)';
    res = await clients.editor.from('tasks').select(SUMMARY, { count: 'exact' }).eq('list_id', l6).order('position', { ascending: true }).order('created_at', { ascending: true }).order('id', { ascending: true }).range(0, 99);
    rec('list query: one request returns rows with assignees + checklist embedded, exact count', !res.error && res.count === 3 && res.data?.length === 3, res.error?.message);
    const rowA = res.data?.find((r) => r.id === ids.a);
    rec('list query: assignee slots are readable by a colleague', rowA?.task_assignees?.length === 2 && rowA.task_assignees.some((x) => x.role_type === 'EDITOR' && x.user_id === U.editor.id) && rowA.task_assignees.some((x) => x.role_type === 'QC_REVIEWER' && x.user_id === U.qc.id), JSON.stringify(rowA?.task_assignees));
    rec('list query: ordered by position', res.data?.map((r) => r.id).join() === [ids.a, ids.b, ids.c].join());
    res = await clients.editor.from('tasks').select(SUMMARY).eq('list_id', l6).range(100, 199);
    rec('list query: a page past the end is simply empty', !res.error && res.data?.length === 0);
    res = await clients.pm.from('tasks').select('*, task_assignees(role_type, user_id), subtasks(*)').eq('id', ids.a).maybeSingle();
    rec('detail query: task + assignees + subtasks in one request', !res.error && res.data?.id === ids.a && Array.isArray(res.data?.subtasks) && res.data?.task_assignees?.length === 2, res.error?.message);

    // ---- who may create ----
    for (const who of ['editor', 'qc', 'client', 'stranger']) {
      res = await rpc(who, 'create_task', { p_list_id: l6, p_title: 'Sneaky' });
      rec(`create_task: ${who} is refused`, !!res.error, res.error ? '' : 'was allowed');
    }
    res = await clients.pm.from('tasks').select('id', { count: 'exact', head: true }).eq('list_id', l6);
    rec('...and none of those left a task behind', res.count === 3, String(res.count));
    res = await anon.rpc('create_task', { p_list_id: l6, p_title: 'x' });
    rec('create_task: anon is refused', !!res.error);
    res = await anon.from('task_assignees').select('task_id');
    rec('anon cannot read task_assignees', code(res) === '42501');

    // ---- invalid input is refused by the database itself ----
    const bad = {
      'blank title': { p_title: '   ' },
      'invalid priority': { p_title: 'x', p_priority: 'BLOCKER' },
      'invalid aspect ratio': { p_title: 'x', p_aspect_ratio: '3:2' },
      'javascript: raw footage link': { p_title: 'x', p_raw_footage_link: 'javascript:alert(1)' },
      'data: review link': { p_title: 'x', p_review_link: 'data:text/html,hi' },
      'link with a space': { p_title: 'x', p_project_file_link: 'https://a.co/a b' },
      'link without a host': { p_title: 'x', p_final_export_link: 'https://' },
      'link over 2048 characters': { p_title: 'x', p_raw_footage_link: `https://a.co/${'a'.repeat(2100)}` },
      'title over 500 characters': { p_title: 't'.repeat(501) },
    };
    for (const [name, args] of Object.entries(bad)) {
      res = await rpc('pm', 'create_task', { p_list_id: l6, ...args });
      rec(`rejects ${name}`, !!res.error, res.error ? '' : 'was accepted');
    }
    res = await clients.pm.from('tasks').select('id', { count: 'exact', head: true }).eq('list_id', l6);
    rec('...and none of the invalid attempts stored anything', res.count === 3, String(res.count));
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'Links ok', p_aspect_ratio: '16:9', p_raw_footage_link: 'HTTPS://drive.google.com/drive/folders/abc?usp=sharing', p_review_link: 'https://app.frame.io/reviews/1' });
    rec('accepts valid http(s) links and an allowed aspect ratio', !res.error, res.error?.message);
    ids.links = res.data?.id;

    // ---- assignment eligibility + atomicity ----
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'Atomic', p_editor_id: U.editor.id, p_qc_id: U.editor.id });
    rec('same person as editor AND QC reviewer is refused', !!res.error, res.error?.message);
    res = await clients.pm.from('tasks').select('id').eq('list_id', l6).eq('title', 'Atomic');
    rec('...and the half-created task was rolled back (transactional)', !res.error && res.data?.length === 0);
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'x', p_editor_id: U.qc.id });
    rec('a QC specialist cannot be the editor', !!res.error);
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'x', p_qc_id: U.editor.id });
    rec('an editor cannot be the QC reviewer', !!res.error);
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'x', p_editor_id: U.client.id });
    rec('a client viewer cannot be assigned', !!res.error);
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'x', p_editor_id: U.stranger.id });
    rec('a person outside the workspace cannot be assigned', !!res.error);
    res = await rpc('pm', 'create_task', { p_list_id: l6, p_title: 'x', p_editor_id: crypto.randomUUID() });
    rec('an unknown user id cannot be assigned', !!res.error);
    res = await rpc('pm', 'set_task_assignee', { p_task_id: ids.b, p_role_type: 'EDITOR', p_user_id: U.editor2.id });
    rec('manager assigns an editor', !res.error, res.error?.message);
    res = await rpc('pm', 'set_task_assignee', { p_task_id: ids.b, p_role_type: 'EDITOR', p_user_id: U.editor.id });
    rec('manager replaces the editor', !res.error, res.error?.message);
    res = await clients.pm.from('task_assignees').select('user_id').eq('task_id', ids.b).eq('role_type', 'EDITOR');
    rec('exactly one editor row after replacing', res.data?.length === 1 && res.data[0].user_id === U.editor.id);
    res = await rpc('pm', 'set_task_assignee', { p_task_id: ids.b, p_role_type: 'QC_REVIEWER', p_user_id: U.editor.id });
    rec('the editor cannot also be made QC reviewer', !!res.error);
    res = await rpc('pm', 'set_task_assignee', { p_task_id: ids.b, p_role_type: 'EDITOR', p_user_id: null });
    rec('manager clears the editor', !res.error, res.error?.message);
    res = await rpc('pm', 'set_task_assignee', { p_task_id: ids.b, p_role_type: 'CREATIVE_DIRECTOR', p_user_id: U.editor.id });
    rec('unknown assignment role refused', !!res.error);
    for (const who of ['editor', 'qc', 'client', 'stranger']) {
      res = await rpc(who, 'set_task_assignee', { p_task_id: ids.c, p_role_type: 'EDITOR', p_user_id: U[who].id });
      rec(`${who} cannot assign (not even themselves)`, !!res.error);
    }
    res = await clients.editor.from('task_assignees').insert({ task_id: ids.c, role_type: 'EDITOR', user_id: U.editor.id });
    rec('direct INSERT into task_assignees by an editor is refused', !!res.error);
    res = await clients.editor.from('task_assignees').update({ user_id: U.editor2.id }).eq('task_id', ids.a).eq('role_type', 'EDITOR').select();
    noRows('editor cannot re-point an assignment', res);
    for (const [who, want] of [['qc', 2], ['client', 0], ['stranger', 0]]) {
      res = await clients[who].from('task_assignees').select('task_id').eq('task_id', ids.a);
      rec(`${who} ${want ? 'sees' : 'does not see'} assignments`, !res.error && res.data?.length === want, `${res.data?.length}`);
    }

    // ---- editor rules: only assigned tasks, only operational columns ----
    res = await clients.editor.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', ids.c).select();
    rec('editor cannot change a task nobody assigned them', code(res) === '42501', JSON.stringify(res.error));
    res = await clients.editor2.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', ids.a).select();
    rec("editor cannot change a colleague's task", code(res) === '42501');
    res = await clients.editor.from('tasks').update({ status: 'IN_PROGRESS' }).eq('id', ids.a).select();
    rec('assigned editor starts work', !res.error && res.data?.length === 1, res.error?.message);
    res = await clients.editor.from('tasks').update({ review_link: 'https://app.frame.io/reviews/9', project_file_link: 'https://drive.google.com/p' }).eq('id', ids.a).select();
    rec('assigned editor submits review + project file links', !res.error && res.data?.length === 1, res.error?.message);
    for (const patch of [{ raw_footage_link: 'https://x.co/r' }, { final_export_link: 'https://x.co/f' }, { title: 'Mine' }, { priority: 'URGENT' }, { due_date: dt(1) }, { client_deadline: dt(1) }, { aspect_ratio: '1:1' }, { description: 'x' }]) {
      res = await clients.editor.from('tasks').update(patch).eq('id', ids.a).select();
      rec(`assigned editor cannot change ${Object.keys(patch)[0]}`, code(res) === '42501');
    }
    res = await clients.editor.from('tasks').update({ status: 'READY_TO_DELIVER' }).eq('id', ids.a).select();
    rec('assigned editor still cannot self-approve', code(res) === '42501');
    res = await clients.editor.from('tasks').update({ review_link: 'javascript:alert(1)' }).eq('id', ids.a).select();
    rec('even an assigned editor cannot store a javascript: link', !!res.error);
    res = await clients.editor.from('tasks').delete().eq('id', ids.a).select();
    noRows('assigned editor cannot delete the task', res);
    res = await clients.qc.from('tasks').update({ review_link: 'https://x.co/qc' }).eq('id', ids.a).select();
    rec('QC cannot edit the brief or links', code(res) === '42501');
    res = await clients.pm.from('tasks').select('status,review_link,title').eq('id', ids.a).single();
    rec('after those attempts the task holds exactly what was legitimately saved', res.data?.status === 'IN_PROGRESS' && res.data?.review_link === 'https://app.frame.io/reviews/9' && res.data?.title === 'Episode A', JSON.stringify(res.data));

    // ---- managers edit everything; clear optional fields ----
    res = await clients.pm.from('tasks').update({ title: 'Episode A (final)', description: 'd', priority: 'URGENT', aspect_ratio: '4:5', final_export_link: 'https://x.co/final', client_deadline: dt(7) }).eq('id', ids.a).select();
    rec('manager edits every deliverable field', !res.error && res.data?.length === 1, res.error?.message);
    res = await clients.pm.from('tasks').update({ aspect_ratio: null, client_deadline: null, review_link: null }).eq('id', ids.a).select();
    rec('manager can clear optional fields', !res.error && res.data?.length === 1);

    // ---- subtasks ----
    res = await clients.pm.from('subtasks').insert([{ task_id: ids.a, title: 'Rough cut', position: 0 }, { task_id: ids.a, title: 'Captions', position: 1 }]).select();
    rec('manager adds a checklist', !res.error && res.data?.length === 2, res.error?.message);
    const [s1, s2] = res.data ?? [];
    res = await clients.editor.from('subtasks').update({ is_completed: true }).eq('id', s1?.id).select();
    rec('assigned editor ticks a subtask of their task', !res.error && res.data?.length === 1, res.error?.message);
    res = await clients.editor2.from('subtasks').update({ is_completed: true }).eq('id', s2?.id).select();
    rec("editor cannot tick a subtask of a colleague's task", code(res) === '42501');
    res = await clients.qc.from('subtasks').update({ is_completed: true }).eq('id', s2?.id).select();
    rec('QC can tick a subtask', !res.error && res.data?.length === 1);
    res = await clients.pm.from('tasks').select('subtasks(is_completed)').eq('id', ids.a).single();
    rec('checklist progress reads back as 2 of 2', res.data?.subtasks?.length === 2 && res.data.subtasks.every((s) => s.is_completed));
    res = await clients.pm.from('subtasks').insert({ task_id: ids.a, title: '   ' });
    rec('blank subtask title refused', !!res.error);

    // ---- ordering ----
    const order = async () => (await clients.pm.from('tasks').select('id').eq('list_id', l6).order('position').order('created_at').order('id')).data.map((r) => r.id);
    let o = await order();
    res = await rpc('pm', 'move_task', { p_task_id: o[0], p_direction: 'down' });
    rec('manager moves the first task down', !res.error && res.data === true, res.error?.message);
    const o2 = await order();
    rec('exactly one swap happened', o2[0] === o[1] && o2[1] === o[0] && o2.slice(2).join() === o.slice(2).join());
    res = await rpc('pm', 'move_task', { p_task_id: o2[0], p_direction: 'up' });
    rec('moving the first task up is a no-op (false)', !res.error && res.data === false);
    res = await rpc('pm', 'move_task', { p_task_id: o2[0], p_direction: 'sideways' });
    rec('invalid direction refused', !!res.error);
    res = await rpc('editor', 'move_task', { p_task_id: o2[1], p_direction: 'up' });
    rec('an editor cannot reorder', !!res.error);
    res = await rpc('stranger', 'move_task', { p_task_id: o2[1], p_direction: 'up' });
    rec('a stranger cannot reorder', !!res.error);
    res = await clients.pm.from('tasks').select('position').eq('list_id', l6).order('position');
    rec('positions stay dense', res.data?.every((r, i) => r.position === i));

    // ---- isolation ----
    res = await clients.editor.from('task_assignees').select('task_id').eq('workspace_id', wsB);
    noRows("workspace A staff cannot read workspace B's assignments", res);
    res = await rpc('pm', 'create_task', { p_list_id: listB, p_title: 'cross', p_editor_id: U.editor.id });
    rec('a workspace-A editor cannot be assigned to a workspace-B task', !!res.error);
    res = await clients.stranger.from('tasks').select('id').eq('list_id', l6);
    noRows('an outsider sees none of these tasks', res);
    res = await clients.client.from('tasks').select('id').eq('list_id', l6);
    noRows('a client viewer sees none of these tasks', res);

    // ---- delete + cascade ----
    res = await clients.pm.from('tasks').delete().eq('id', ids.a).select();
    rec('manager deletes a task', !res.error && res.data?.length === 1, res.error?.message);
    res = await runSqlJson(`SELECT (SELECT count(*) FROM public.task_assignees WHERE task_id = '${ids.a}') AS a, (SELECT count(*) FROM public.subtasks WHERE task_id = '${ids.a}') AS s`);
    rec('deleting a task removes its assignments and subtasks', res.a === 0 && res.s === 0, JSON.stringify(res));
  }

  console.log('\n== Deactivation (flag flipped by the service owner) ==');
  const run = runSql;
  run(`UPDATE public.profiles SET is_active = false WHERE id = '${U.editor.id}'`);
  res = await clients.editor.from('tasks').select('id');
  noRows('deactivated user loses access to tasks', res);
  res = await clients.editor.from('workspaces').select('id');
  noRows('deactivated user sees no workspaces', res);
  run(`UPDATE public.profiles SET is_active = true WHERE id = '${U.editor.id}'`);
  res = await clients.editor.from('tasks').select('id');
  rec('re-activated user regains access', res.data?.length >= 1);

  console.log('\n== Deletes ==');
  res = await clients.admin.from('workspaces').delete().eq('id', ws).select();
  noRows('admin cannot delete the workspace', res);
  res = await clients.owner.from('workspaces').delete().eq('id', ws).select();
  rec('owner deletes workspace (cascade passes last-owner guard)', !res.error && res.data?.length === 1, res.error?.message);
  res = await clients.owner.from('tasks').select('id').eq('workspace_id', ws);
  noRows('cascade removed the tasks', res);
} catch (e) {
  fail++; failures.push('SCRIPT ERROR ' + e.message);
  console.log('SCRIPT ERROR:', e.message);
}
let clean = false;
try { clean = cleanup(); } catch (e) { console.log('CLEANUP ERROR:', e.message, '\nRun again with --cleanup-only.'); }
if (!clean) { fail++; failures.push('cleanup could not be verified'); }
try {
  const after = runSqlJson(TASK_TABLE_COUNTS_SQL);
  const same = ['tasks', 'task_assignees', 'subtasks'].every((k) => after[k] === BASELINE[k]);
  console.log(`Task tables before the run: ${JSON.stringify(BASELINE)}; after cleanup: ${JSON.stringify(after)}`);
  if (!same) { fail++; failures.push(`task tables changed: before ${JSON.stringify(BASELINE)}, after ${JSON.stringify(after)}`); }
} catch (e) { fail++; failures.push('could not verify the task tables after cleanup: ' + e.message); }
if (grantRefusals > 0) { fail++; failures.push(`${grantRefusals} signed-in request(s) were refused for missing table GRANTs (not RLS)`); }
console.log(`\ngrant-level refusals for signed-in users: ${grantRefusals}`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) console.log('FAILURES:\n' + failures.join('\n'));
process.exit(fail ? 1 : 0);
