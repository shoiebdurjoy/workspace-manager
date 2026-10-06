// RLS / permission test for the TBB core schema.
// Runs the real migration inside PGlite (WASM Postgres) with a stand-in for
// Supabase's auth schema and roles. No Docker, no network, never touches a live DB.
//
//   npm install --no-save @electric-sql/pglite   (once; does not change package.json)
//   node supabase/tests/rls-check.mjs

import { PGlite } from '@electric-sql/pglite';
import fs from 'fs';

import { fileURLToPath } from 'url';
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const MIGRATION_FILES = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const readMigration = (f) => fs.readFileSync(MIGRATIONS_DIR + f, 'utf8');
const db = new PGlite();

// ---- Minimal stand-in for Supabase's auth schema and roles -----------------
const BOOTSTRAP = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  -- Mirrors the live tbb-workspace project: objects created by the migration role get
  -- NO automatic grants for anon/authenticated/service_role (verified in pg_default_acl).
  -- Every privilege the app needs must therefore be granted explicitly by a migration.
`;
await db.exec(BOOTSTRAP);

// Apply every migration in order, exactly like `supabase db push`.
for (const f of MIGRATION_FILES) await db.exec(readMigration(f));
// Re-running the first migration must only trip on "already exists" (policies).
let rerunOk = true;
try { await db.exec(readMigration(MIGRATION_FILES[0])); } catch (e) { rerunOk = /already exists/.test(e.message); }

// ---- helpers ---------------------------------------------------------------
let pass = 0, fail = 0;
const failures = [];
function record(name, ok, detail = '') {
  if (ok) pass++; else { fail++; failures.push(`${name} ${detail}`); }
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : '  -> ' + detail}`);
}

async function as(userId, sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '${userId ?? ''}', false);`);
  await db.exec(userId === 'anon' ? 'SET ROLE anon' : 'SET ROLE authenticated');
  try { return { rows: (await db.query(sql, params)).rows, error: null }; }
  catch (e) { return { rows: [], error: e }; }
  finally { await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`); }
}
async function svc(sql, params = []) {
  await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false);`);
  return (await db.query(sql, params)).rows;
}
const ok = (name, r) => record(name, !r.error, r.error?.message);
const denied = (name, r) => record(name, !!r.error || (r.rows && r.rows.length === 0 && r.expectEmptyIsDenial), r.error ? '' : 'was allowed');
// For UPDATE/DELETE blocked by RLS (0 rows) we use rowcount via RETURNING
const blocked = (name, r) => record(name, !!r.error || r.rows.length === 0, 'was allowed');

async function mkUser(email, meta = {}, confirmed = false) {
  const [u] = await svc(`INSERT INTO auth.users (email, raw_user_meta_data, email_confirmed_at) VALUES ($1, $2, ${confirmed ? 'now()' : 'NULL'}) RETURNING id`, [email, JSON.stringify(meta)]);
  return u.id;
}

// ---- users -----------------------------------------------------------------
const owner = await mkUser('owner@tbb.test', { name: 'Olive Owner', role: 'OWNER' }); // metadata role must be ignored
const admin = await mkUser('admin@tbb.test', { full_name: 'Ada Admin' });
const pm = await mkUser('pm@tbb.test');
const qc = await mkUser('qc@tbb.test');
const editor = await mkUser('editor@tbb.test');
const client = await mkUser('client@tbb.test');
const stranger = await mkUser('stranger@tbb.test');
const other = await mkUser('other@tbb.test');

console.log('\n== Profiles ==');
const prof = await svc(`SELECT role, full_name FROM public.profiles WHERE id = $1`, [owner]);
record('profile auto-created by trigger', prof.length === 1);
record('metadata "role: OWNER" is ignored (always EDITOR)', prof[0]?.role === 'EDITOR');
record('full_name taken from metadata', prof[0]?.full_name === 'Olive Owner');

let r = await as(editor, `UPDATE public.profiles SET role = 'OWNER' WHERE id = $1 RETURNING id`, [editor]);
record('user cannot promote own profile role', !!r.error);
r = await as(editor, `UPDATE public.profiles SET is_active = false WHERE id = $1 RETURNING id`, [editor]);
record('user cannot change own is_active', !!r.error);
r = await as(editor, `UPDATE public.profiles SET email = 'x@y.z' WHERE id = $1 RETURNING id`, [editor]);
record('user cannot change own email', !!r.error);
r = await as(editor, `UPDATE public.profiles SET full_name = 'Eddie' WHERE id = $1 RETURNING id`, [editor]);
ok('user can edit own full_name', r);
r = await as(editor, `UPDATE public.profiles SET full_name = 'Hax' WHERE id = $1 RETURNING id`, [owner]);
blocked("user cannot edit someone else's profile", r);
r = await as(stranger, `INSERT INTO public.profiles (id, email, full_name, role) VALUES (gen_random_uuid(), 'fake@x.y', 'Fake', 'OWNER')`);
record('client cannot insert profiles', !!r.error);

console.log('\n== Anonymous ==');
r = await as('anon', `SELECT * FROM public.workspaces`);
record('anon cannot read workspaces', !!r.error);
r = await as('anon', `SELECT * FROM public.tasks`);
record('anon cannot read tasks', !!r.error);
r = await as('anon', `SELECT private.is_workspace_member(gen_random_uuid())`);
record('anon cannot call private helper functions', !!r.error);
r = await as(editor, `SELECT public.is_workspace_member(gen_random_uuid())`);
record('helpers no longer exist in the exposed public schema', !!r.error);
{
  const exposed = await svc(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  record('no SECURITY DEFINER function in public is executable by signed-in users', exposed.length === 0, exposed.map((x) => x.proname).join(','));
  const anonUsage = await svc(`SELECT has_schema_privilege('anon', 'private', 'USAGE') AS u`);
  record('anon has no access to the private schema', anonUsage[0].u === false);
  const policies = await svc(`SELECT count(*) AS n FROM pg_policies WHERE schemaname = 'public' AND (qual ~ 'auth\.uid\(\)' OR with_check ~ 'auth\.uid\(\)') AND NOT (coalesce(qual,'') ~ 'SELECT auth\.uid\(\)' OR coalesce(with_check,'') ~ 'SELECT auth\.uid\(\)')`);
  record('every policy that uses auth.uid() wraps it in (SELECT ...)', Number(policies[0].n) === 0, String(policies[0].n));
}
r = await as(editor, `SELECT public.handle_new_user()`);
record('users cannot call trigger functions directly', !!r.error);

console.log('\n== Workspace creation & membership ==');
r = await as(owner, `INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('TBB', 'tbb', $1) RETURNING id`, [owner]);
ok('owner creates workspace and can read it back (RETURNING)', r);
const ws = r.rows[0]?.id;
r = await as(owner, `SELECT role FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, owner]);
record('creator became OWNER via trigger', r.rows[0]?.role === 'OWNER');
r = await as(stranger, `INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('Fake', 'fake', $1) RETURNING id`, [owner]);
record('cannot create workspace owned by someone else', !!r.error);

for (const [uid, role] of [[admin, 'ADMIN'], [pm, 'PRODUCTION_MANAGER'], [qc, 'QC_SPECIALIST'], [editor, 'EDITOR'], [client, 'CLIENT_VIEWER']]) {
  r = await as(owner, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,$3) RETURNING user_id`, [ws, uid, role]);
  ok(`owner adds ${role}`, r);
}
r = await as(stranger, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'OWNER')`, [ws, stranger]);
record('stranger cannot add themselves to a workspace', !!r.error);
r = await as(editor, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'ADMIN')`, [ws, stranger]);
record('editor cannot add members', !!r.error);
r = await as(admin, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'OWNER')`, [ws, stranger]);
record('admin cannot create an OWNER', !!r.error);
r = await as(admin, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR') RETURNING user_id`, [ws, other]);
ok('admin can add an EDITOR', r);
r = await as(admin, `UPDATE public.workspace_members SET role = 'EDITOR' WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, owner]);
blocked('admin cannot demote the OWNER', r);
r = await as(admin, `UPDATE public.workspace_members SET role = 'OWNER' WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, admin]);
record('admin cannot promote self to OWNER', !!r.error || r.rows.length === 0);
r = await as(admin, `DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, owner]);
blocked('admin cannot remove the OWNER', r);
r = await as(owner, `UPDATE public.workspace_members SET role = 'ADMIN' WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, owner]);
record('last OWNER cannot demote self', !!r.error);
r = await as(owner, `DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, owner]);
record('last OWNER cannot leave', !!r.error);
r = await as(editor, `UPDATE public.workspace_members SET role = 'ADMIN' WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, editor]);
blocked('editor cannot promote self', r);
r = await as(editor, `DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, other]);
await svc(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, other]);
blocked('editor cannot remove another member', r);

console.log('\n== Visibility ==');
r = await as(stranger, `SELECT id FROM public.workspaces`);
record('stranger sees no workspaces', r.rows.length === 0 && !r.error);
r = await as(editor, `SELECT id FROM public.workspaces WHERE id = $1`, [ws]);
record('member sees own workspace', r.rows.length === 1);
r = await as(editor, `SELECT id FROM public.profiles WHERE id = $1`, [owner]);
record('colleague profile visible to staff', r.rows.length === 1);
r = await as(stranger, `SELECT id FROM public.profiles WHERE id = $1`, [owner]);
record("stranger cannot see staff profile", r.rows.length === 0);
r = await as(client, `SELECT user_id FROM public.workspace_members WHERE workspace_id = $1`, [ws]);
record('client viewer sees only their own membership row', r.rows.length === 1 && r.rows[0].user_id === client);
r = await as(client, `SELECT id FROM public.profiles WHERE id = $1`, [owner]);
record('client viewer cannot see staff profiles', r.rows.length === 0);

console.log('\n== Hierarchy permissions ==');
r = await as(pm, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'Content','content') RETURNING id`, [ws]);
record('production manager cannot create spaces', !!r.error);
r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'Content','content') RETURNING id`, [ws]);
ok('admin creates space', r);
const space = r.rows[0]?.id;
r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug, is_private) VALUES ($1,'Secret','secret', true)`, [ws]);
record('private spaces are rejected (fail closed)', !!r.error);
r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'Design','design') RETURNING id`, [ws]);
const space2 = r.rows[0]?.id;

r = await as(pm, `INSERT INTO public.folders (space_id, name) VALUES ($1,'ZIM') RETURNING id, workspace_id`, [space]);
ok('manager creates folder WITHOUT sending workspace_id', r);
const folder = r.rows[0]?.id;
record('workspace_id derived from space', r.rows[0]?.workspace_id === ws);
r = await as(editor, `INSERT INTO public.folders (space_id, name) VALUES ($1,'Nope')`, [space]);
record('editor cannot create folders', !!r.error);
r = await as(pm, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'25. EDAPTX') RETURNING id`, [space, folder]);
ok('manager creates list in folder', r);
const list = r.rows[0]?.id;
r = await as(pm, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'Wrong')`, [space2, folder]);
record('list cannot reference a folder from another space', !!r.error);
r = await as(pm, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Loose') RETURNING id`, [space2]);
const list2 = r.rows[0]?.id;
r = await as(admin, `DELETE FROM public.folders WHERE id = $1 RETURNING id`, [folder]);
record('folder with lists cannot be deleted (no orphaning)', !!r.error);
r = await as(pm, `DELETE FROM public.spaces WHERE id = $1 RETURNING id`, [space2]);
blocked('manager cannot delete spaces', r);

console.log('\n== Tasks ==');
r = await as(pm, `INSERT INTO public.tasks (list_id, title, created_by, workspace_id) VALUES ($1,'Video 1',$2,gen_random_uuid()) RETURNING id, created_by, workspace_id`, [list, owner]);
ok('manager creates task', r);
const task = r.rows[0]?.id;
record('created_by forced to caller (forgery ignored)', r.rows[0]?.created_by === pm);
record('workspace_id forced from list (forgery ignored)', r.rows[0]?.workspace_id === ws);
r = await as(editor, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Sneaky')`, [list]);
record('editor cannot create tasks', !!r.error);
r = await as(client, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Sneaky')`, [list]);
record('client viewer cannot create tasks', !!r.error);
r = await as(stranger, `SELECT id FROM public.tasks`);
record('stranger sees no tasks', r.rows.length === 0 && !r.error);
r = await as(client, `SELECT id FROM public.tasks`);
record('client viewer sees no tasks (fail closed)', r.rows.length === 0 && !r.error);
r = await as(client, `UPDATE public.tasks SET status = 'COMPLETED' WHERE id = $1 RETURNING id`, [task]);
blocked('client viewer cannot update tasks', r);
r = await as(stranger, `UPDATE public.tasks SET title = 'pwn' WHERE id = $1 RETURNING id`, [task]);
blocked('stranger cannot update tasks', r);

r = await as(editor, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [task]);
ok('editor can start work (TODO -> IN_PROGRESS)', r);
r = await as(editor, `UPDATE public.tasks SET status = 'IN_QC', position = 3 WHERE id = $1 RETURNING id`, [task]);
ok('editor can submit to QC and reorder', r);
r = await as(editor, `UPDATE public.tasks SET status = 'READY_TO_DELIVER' WHERE id = $1 RETURNING id`, [task]);
record('EDITOR CANNOT SELF-APPROVE (-> READY_TO_DELIVER)', !!r.error);
r = await as(editor, `UPDATE public.tasks SET status = 'COMPLETED' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot complete tasks', !!r.error);
r = await as(editor, `UPDATE public.tasks SET title = 'Renamed' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot edit task title', !!r.error);
r = await as(editor, `UPDATE public.tasks SET due_date = now() WHERE id = $1 RETURNING id`, [task]);
record('editor cannot edit due date', !!r.error);
r = await as(editor, `UPDATE public.tasks SET list_id = $2 WHERE id = $1 RETURNING id`, [task, list2]);
record('editor cannot move task to another list', !!r.error);
r = await as(editor, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [task]);
blocked('editor cannot delete tasks', r);

r = await as(qc, `UPDATE public.tasks SET status = 'READY_TO_DELIVER' WHERE id = $1 RETURNING id`, [task]);
ok('QC approves (IN_QC -> READY_TO_DELIVER)', r);
r = await as(qc, `UPDATE public.tasks SET status = 'CLIENT_REVIEW' WHERE id = $1 RETURNING id`, [task]);
ok('QC delivers to client', r);
r = await as(qc, `UPDATE public.tasks SET status = 'COMPLETED' WHERE id = $1 RETURNING id`, [task]);
record('QC cannot complete tasks', !!r.error);
r = await as(qc, `UPDATE public.tasks SET title = 'QC rename' WHERE id = $1 RETURNING id`, [task]);
record('QC cannot edit task fields', !!r.error);
r = await as(editor, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot pull a delivered task back', !!r.error);

r = await as(pm, `UPDATE public.tasks SET status = 'COMPLETED', title = 'Final' WHERE id = $1 RETURNING id`, [task]);
ok('manager can complete and edit', r);
r = await as(pm, `UPDATE public.tasks SET created_by = $2 WHERE id = $1 RETURNING created_by`, [task, owner]);
record('created_by cannot be rewritten', r.rows[0]?.created_by === pm);

// cross-workspace move
// TBB is single-workspace: clients cannot create a second one, so the isolation fixture is created by the service role.
r = await as(pm, `INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('B2','b2',$1) RETURNING id`, [pm]);
record('a second workspace cannot be created from the client (single-workspace rule)', !!r.error);
const wsB = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('B','b',$1) RETURNING id`, [pm]))[0].id;
const spB = (await as(pm, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsB])).rows[0].id;
const listB = (await as(pm, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spB])).rows[0].id;
r = await as(pm, `UPDATE public.tasks SET list_id = $2 WHERE id = $1 RETURNING id`, [task, listB]);
record('task cannot be moved to a list in another workspace', !!r.error);
r = await as(pm, `UPDATE public.lists SET space_id = $2 WHERE id = $1 RETURNING id`, [list, spB]);
record('list cannot be moved to a space in another workspace', !!r.error);
r = await as(pm, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'x')`, [listB]);
ok('pm (owner of B) can create tasks in own other workspace', r);
r = await as(editor, `SELECT id FROM public.tasks WHERE workspace_id = $1`, [wsB]);
record('workspace B tasks invisible to workspace A staff', r.rows.length === 0);

console.log('\n== Subtasks ==');
r = await as(pm, `INSERT INTO public.subtasks (task_id, title) VALUES ($1,'Cut intro') RETURNING id, workspace_id`, [task]);
ok('manager creates subtask', r);
const sub = r.rows[0]?.id;
record('subtask workspace_id derived', r.rows[0]?.workspace_id === ws);
r = await as(editor, `UPDATE public.subtasks SET is_completed = true WHERE id = $1 RETURNING id`, [sub]);
ok('editor can tick subtask', r);
r = await as(editor, `UPDATE public.subtasks SET title = 'x' WHERE id = $1 RETURNING id`, [sub]);
record('editor cannot rename subtask', !!r.error);
r = await as(editor, `INSERT INTO public.subtasks (task_id, title) VALUES ($1,'x')`, [task]);
record('editor cannot add subtasks', !!r.error);
r = await as(client, `SELECT id FROM public.subtasks`);
record('client viewer sees no subtasks', r.rows.length === 0 && !r.error);

console.log('\n== Phase 4: pods (teams) ==');
{
  r = await as(admin, `INSERT INTO public.teams (workspace_id, name, lead_id) VALUES ($1,'Pod Zim',$2) RETURNING id, workspace_id`, [ws, pm]);
  ok('admin creates a pod with a workspace member as lead', r);
  const team = r.rows[0]?.id;
  r = await as(pm, `INSERT INTO public.teams (workspace_id, name) VALUES ($1,'Pod Myla')`, [ws]);
  record('production manager cannot create pods', !!r.error);
  r = await as(editor, `INSERT INTO public.teams (workspace_id, name) VALUES ($1,'Pod Editor')`, [ws]);
  record('editor cannot create pods', !!r.error);
  r = await as(stranger, `INSERT INTO public.teams (workspace_id, name) VALUES ($1,'Pod Intruder')`, [ws]);
  record('outsider cannot create pods in the workspace', !!r.error);
  r = await as(admin, `INSERT INTO public.teams (workspace_id, name) VALUES ($1,'pod zim')`, [ws]);
  record('pod names are unique per workspace (case-insensitive)', !!r.error);
  r = await as(admin, `INSERT INTO public.teams (workspace_id, name, lead_id) VALUES ($1,'Pod Bad Lead',$2)`, [ws, stranger]);
  record('pod lead must belong to the workspace', !!r.error);
  r = await as(editor, `SELECT id FROM public.teams WHERE workspace_id = $1`, [ws]);
  record('staff can read pods', r.rows.length === 1);
  r = await as(client, `SELECT id FROM public.teams WHERE workspace_id = $1`, [ws]);
  record('client viewer cannot read pods', r.rows.length === 0 && !r.error);
  r = await as(stranger, `SELECT id FROM public.teams`);
  record('outsider cannot read pods', r.rows.length === 0 && !r.error);

  r = await as(pm, `INSERT INTO public.team_members (team_id, user_id, workspace_id) VALUES ($1,$2,gen_random_uuid()) RETURNING workspace_id`, [team, editor]);
  ok('production manager adds a member to a pod', r);
  record('team_members.workspace_id is derived (forgery ignored)', r.rows[0]?.workspace_id === ws);
  r = await as(editor, `INSERT INTO public.team_members (team_id, user_id) VALUES ($1,$2)`, [team, qc]);
  record('editor cannot add pod members', !!r.error);
  r = await as(pm, `INSERT INTO public.team_members (team_id, user_id) VALUES ($1,$2)`, [team, stranger]);
  record('only workspace members can join a pod', !!r.error);
  r = await as(editor, `DELETE FROM public.team_members WHERE team_id = $1 AND user_id = $2 RETURNING user_id`, [team, editor]);
  blocked('editor cannot remove pod members', r);
  r = await as(admin, `UPDATE public.teams SET workspace_id = $2 WHERE id = $1 RETURNING id`, [team, wsB]);
  record('a pod cannot be moved to another workspace', !!r.error || r.rows.length === 0);
  r = await as(pm, `DELETE FROM public.teams WHERE id = $1 RETURNING id`, [team]);
  blocked('production manager cannot delete pods', r);

  // removing someone from the workspace removes their pod seats and lead position
  r = await as(admin, `DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, editor]);
  ok('admin removes a member from the workspace', r);
  let left = await svc(`SELECT count(*)::int AS n FROM public.team_members WHERE user_id = $1`, [editor]);
  record('leaving the workspace removes pod memberships', left[0].n === 0);
  r = await as(admin, `DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, pm]);
  ok('admin removes the pod lead from the workspace', r);
  left = await svc(`SELECT lead_id FROM public.teams WHERE id = $1`, [team]);
  record('lead position is cleared when the lead leaves', left[0].lead_id === null);
  // restore the two members so later checks keep their fixtures
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'PRODUCTION_MANAGER')`, [ws, editor, pm]);
  r = await as(admin, `DELETE FROM public.teams WHERE id = $1 RETURNING id`, [team]);
  ok('admin deletes a pod', r);
}

console.log('\n== Phase 4: invitations ==');
{
  const inviteeEmail = 'new.hire@tbb.test';
  r = await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role, invited_by) VALUES ($1,'  New.Hire@TBB.test ','QC_SPECIALIST',$2) RETURNING id, email, invited_by, accepted_at`, [ws, owner]);
  ok('admin invites an e-mail address', r);
  record('e-mail is normalised to lower case', r.rows[0]?.email === inviteeEmail);
  record('invited_by is forced to the caller (forgery ignored)', r.rows[0]?.invited_by === admin);
  const inv = r.rows[0]?.id;
  r = await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,$2,'EDITOR')`, [ws, inviteeEmail]);
  record('a second open invitation for the same e-mail is rejected', !!r.error);
  r = await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,'boss@tbb.test','OWNER')`, [ws]);
  record('OWNER can never be granted by invitation', !!r.error);
  r = await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role, accepted_at, accepted_by) VALUES ($1,'sneaky@tbb.test','EDITOR', now(), $2) RETURNING accepted_at`, [ws, admin]);
  record('a client cannot create a pre-accepted invitation', r.rows[0]?.accepted_at === null);
  r = await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email) VALUES ($1,'not-an-email')`, [ws]);
  record('malformed e-mail addresses are rejected', !!r.error);
  for (const [name, who] of [['production manager', pm], ['QC specialist', qc], ['editor', editor], ['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `INSERT INTO public.workspace_invitations (workspace_id, email) VALUES ($1,$2)`, [ws, `${name.replace(' ', '.')}@x.test`]);
    record(`${name} cannot invite`, !!r.error);
  }
  for (const [name, who] of [['production manager', pm], ['editor', editor], ['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `SELECT id FROM public.workspace_invitations`);
    record(`${name} cannot see invitations`, r.rows.length === 0 && !r.error);
  }
  r = await as(admin, `UPDATE public.workspace_invitations SET role = 'ADMIN' WHERE id = $1 RETURNING id`, [inv]);
  record('invitations cannot be edited from the client', !!r.error);

  // 1) invited before the account exists: claimed only once the e-mail is CONFIRMED
  const hire = await mkUser(inviteeEmail, { name: 'New Hire', role: 'OWNER' }, false);
  let m = await svc(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, hire]);
  record('an UNCONFIRMED account does not claim the invitation', m.length === 0);
  await svc(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1`, [hire]);
  m = await svc(`SELECT role FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, hire]);
  record('confirming the e-mail grants the invited role (QC_SPECIALIST)', m[0]?.role === 'QC_SPECIALIST', JSON.stringify(m));
  m = await svc(`SELECT accepted_by FROM public.workspace_invitations WHERE id = $1`, [inv]);
  record('invitation is marked accepted by the new user', m[0]?.accepted_by === hire);
  m = await svc(`SELECT role FROM public.profiles WHERE id = $1`, [hire]);
  record('profile role stays EDITOR (metadata role ignored)', m[0]?.role === 'EDITOR');

  // 2) account already confirmed at creation (e.g. confirmations disabled): claimed immediately
  await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,'early@tbb.test','PRODUCTION_MANAGER')`, [ws]);
  const early = await mkUser('early@tbb.test', {}, true);
  m = await svc(`SELECT role FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, early]);
  record('a confirmed account claims an existing invitation at creation', m[0]?.role === 'PRODUCTION_MANAGER');

  // 3) account exists and is confirmed BEFORE the invitation
  const late = await mkUser('late@tbb.test', {}, true);
  m = await svc(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, late]);
  record('a registered account has no access before being invited', m.length === 0);
  r = await as(late, `SELECT id FROM public.workspaces`);
  record('...and sees no workspace', r.rows.length === 0 && !r.error);
  r = await as(late, `SELECT id FROM public.tasks`);
  record('...and sees no tasks', r.rows.length === 0 && !r.error);
  await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,'late@tbb.test','EDITOR')`, [ws]);
  m = await svc(`SELECT role FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, late]);
  record('inviting a confirmed account grants access immediately', m[0]?.role === 'EDITOR');
  r = await as(late, `SELECT id FROM public.workspaces`);
  record('...and the new member now sees the workspace', r.rows.length === 1);

  // 4) existing but UNCONFIRMED account stays pending
  const pending = await mkUser('pending@tbb.test', {}, false);
  await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,'pending@tbb.test','EDITOR')`, [ws]);
  m = await svc(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, pending]);
  record('an unconfirmed existing account stays pending', m.length === 0);

  // 5) deactivated accounts never claim
  const off = await mkUser('off@tbb.test', {}, true);
  await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [off]);
  await as(admin, `INSERT INTO public.workspace_invitations (workspace_id, email, role) VALUES ($1,'off@tbb.test','EDITOR')`, [ws]);
  m = await svc(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, off]);
  record('a deactivated account does not claim invitations', m.length === 0);

  // revoke
  r = await as(admin, `SELECT id FROM public.workspace_invitations WHERE email = 'pending@tbb.test'`);
  const pendingInv = r.rows[0]?.id;
  r = await as(admin, `DELETE FROM public.workspace_invitations WHERE id = $1 RETURNING id`, [pendingInv]);
  ok('admin revokes a pending invitation', r);
  await svc(`UPDATE auth.users SET email_confirmed_at = now() WHERE id = $1`, [pending]);
  m = await svc(`SELECT 1 FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, pending]);
  record('a revoked invitation can no longer be claimed', m.length === 0);

  // grants for the new tables
  const g = await svc(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('teams','team_members','workspace_invitations')
      AND grantee IN ('anon','authenticated')`);
  record('anon has no privileges on the new tables', !g.some((x) => x.grantee === 'anon'));
  record('invitations cannot be UPDATEd by signed-in users (no grant)', !g.some((x) => x.grantee === 'authenticated' && x.table_name === 'workspace_invitations' && x.privilege_type === 'UPDATE'));
  record('team_members has no UPDATE grant for signed-in users', !g.some((x) => x.grantee === 'authenticated' && x.table_name === 'team_members' && x.privilege_type === 'UPDATE'));

  // single-workspace bootstrap
  r = await as(late, `INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('Rival','rival',$1)`, [late]);
  record('a registered user cannot create a second workspace', !!r.error);
}

console.log('\n== Deactivation & service role ==');
await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [editor]);
r = await as(editor, `SELECT id FROM public.tasks`);
record('deactivated user loses all access', r.rows.length === 0 && !r.error);
r = await as(editor, `INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('Ghost','ghost',$1)`, [editor]);
record('deactivated user cannot create workspaces', !!r.error);
await svc(`UPDATE public.profiles SET is_active = true, role = 'QC_SPECIALIST' WHERE id = $1`, [editor]);
record('service role (no JWT) may change role/is_active', (await svc(`SELECT role FROM public.profiles WHERE id = $1`, [editor]))[0].role === 'QC_SPECIALIST');

console.log('\n== Deletes ==');
r = await as(admin, `DELETE FROM public.workspaces WHERE id = $1 RETURNING id`, [ws]);
blocked('admin cannot delete workspace', r);
r = await as(owner, `DELETE FROM public.workspaces WHERE id = $1 RETURNING id`, [ws]);
ok('owner can delete workspace (cascade passes last-owner guard)', r);
const left = await svc(`SELECT (SELECT count(*) FROM public.tasks WHERE workspace_id = $1) t, (SELECT count(*) FROM public.workspace_members WHERE workspace_id = $1) m`, [ws]);
record('cascade removed tasks and members', Number(left[0].t) === 0 && Number(left[0].m) === 0);

console.log('\n== Table grants (20260930000003) ==');
{
  const g = await svc(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','service_role')`);
  const has = (grantee, table, priv) => g.some((x) => x.grantee === grantee && x.table_name === table && x.privilege_type === priv);
  record('anon has no table privileges at all', !g.some((x) => x.grantee === 'anon'));
  record('authenticated never gets TRUNCATE/REFERENCES/TRIGGER', !g.some((x) => x.grantee === 'authenticated' && ['TRUNCATE', 'REFERENCES', 'TRIGGER'].includes(x.privilege_type)));
  record('authenticated can only SELECT/UPDATE profiles', has('authenticated', 'profiles', 'SELECT') && has('authenticated', 'profiles', 'UPDATE') && !has('authenticated', 'profiles', 'INSERT') && !has('authenticated', 'profiles', 'DELETE'));
  record('authenticated has CRUD on all 7 app tables', ['workspaces', 'workspace_members', 'spaces', 'folders', 'lists', 'tasks', 'subtasks'].every((t) => ['SELECT', 'INSERT', 'UPDATE', 'DELETE'].every((p) => has('authenticated', t, p))));
  record('service_role has privileges on every table', ['profiles', 'workspaces', 'workspace_members', 'spaces', 'folders', 'lists', 'tasks', 'subtasks'].every((t) => has('service_role', t, 'SELECT')));
}

console.log('\n== NOT NULL defaults migration (20260930000002) ==');
{
  const cols = await svc(`SELECT table_name||'.'||column_name AS c, is_nullable, column_default FROM information_schema.columns
    WHERE table_schema='public' AND (table_name,column_name) IN (('lists','color'),('spaces','color'),('spaces','icon'),('profiles','timezone'))`);
  record('four columns are NOT NULL', cols.length === 4 && cols.every((c) => c.is_nullable === 'NO'));
  record('their defaults are preserved', cols.length === 4 && cols.every((c) => c.column_default !== null));
  const u = await mkUser('nn@tbb.test');
  record('profile created without timezone still gets UTC', (await svc(`SELECT timezone FROM public.profiles WHERE id=$1`, [u]))[0].timezone === 'UTC');
  r = await as(u, `UPDATE public.profiles SET timezone = NULL WHERE id = $1 RETURNING id`, [u]);
  record('explicit NULL timezone is rejected', !!r.error);
  const w = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('NN','nn',$1) RETURNING id`, [u]))[0].id;
  r = await as(u, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING icon, color`, [w]);
  record('space inserted without icon/color gets defaults', r.rows[0]?.icon === 'folder' && r.rows[0]?.color === '#7B68EE');
  r = await as(u, `INSERT INTO public.spaces (workspace_id, name, slug, icon) VALUES ($1,'S2','s2',NULL)`, [w]);
  record('explicit NULL icon is rejected', !!r.error);
  r = await as(u, `INSERT INTO public.lists (space_id, name, color) SELECT id,'L',NULL FROM public.spaces WHERE workspace_id=$1 LIMIT 1`, [w]);
  record('explicit NULL list color is rejected', !!r.error);

  // Backfill path: a database that already holds NULL rows when migration 2 runs.
  const old = new PGlite();
  await old.exec(BOOTSTRAP);
  await old.exec(readMigration(MIGRATION_FILES[0]));
  await old.exec(`INSERT INTO auth.users (id,email) VALUES ('00000000-0000-0000-0000-000000000001','old@tbb.test');
    UPDATE public.profiles SET timezone = NULL;
    INSERT INTO public.workspaces (name,slug,owner_id) VALUES ('O','o','00000000-0000-0000-0000-000000000001');
    INSERT INTO public.spaces (workspace_id,name,slug,icon,color) SELECT id,'S','s',NULL,NULL FROM public.workspaces;
    INSERT INTO public.lists (space_id,name,color) SELECT id,'L',NULL FROM public.spaces;`);
  let applied = true;
  try { await old.exec(readMigration(MIGRATION_FILES[1])); } catch (e) { applied = false; console.log(e.message); }
  const back = (await old.query(`SELECT (SELECT timezone FROM public.profiles LIMIT 1) tz,(SELECT icon FROM public.spaces LIMIT 1) icon,(SELECT color FROM public.spaces LIMIT 1) sc,(SELECT color FROM public.lists LIMIT 1) lc`)).rows[0];
  record('migration 2 applies on a database that already has NULL rows (backfill)', applied && back.tz === 'UTC' && back.icon === 'folder' && back.sc === '#7B68EE' && back.lc === '#7B68EE');

  // The rollback statements documented in the migration header work.
  await db.exec(`ALTER TABLE public.lists ALTER COLUMN color DROP NOT NULL; ALTER TABLE public.spaces ALTER COLUMN color DROP NOT NULL; ALTER TABLE public.spaces ALTER COLUMN icon DROP NOT NULL; ALTER TABLE public.profiles ALTER COLUMN timezone DROP NOT NULL;`);
  const after = await svc(`SELECT count(*) n FROM information_schema.columns WHERE table_schema='public' AND is_nullable='YES' AND (table_name,column_name) IN (('lists','color'),('spaces','color'),('spaces','icon'),('profiles','timezone'))`);
  record('documented rollback restores nullability', Number(after[0].n) === 4);
}

console.log(`\nmigration re-run tolerated: ${rerunOk}`);
console.log(`\n${pass} passed, ${fail} failed`);
if (fail) { console.log('FAILURES:\n' + failures.join('\n')); process.exit(1); }
