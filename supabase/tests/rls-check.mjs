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

// Phase 6 tightening (migration 7): an editor acts only on tasks assigned to them.
r = await as(editor, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot change a task that is NOT assigned to them', !!r.error);
r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [task, editor]);
ok('manager assigns the editor to the task', r);
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

console.log('\n== Phase 5: hierarchy (spaces, folders, lists) ==');
{
  // ---- presentation constraints (migration 6)
  r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug, color) VALUES ($1,'Bad','bad1','red')`, [ws]);
  record('space color must be a #RRGGBB hex', !!r.error);
  r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug, color) VALUES ($1,'Bad','bad2','#12345')`, [ws]);
  record('short hex colors are rejected', !!r.error);
  r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug, icon) VALUES ($1,'Bad','bad3','Bad Icon!')`, [ws]);
  record('icon must be a lowercase slug', !!r.error);
  r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug, color, icon) VALUES ($1,'Styled','styled','#AbCdEf','film') RETURNING id`, [ws]);
  ok('valid color and icon are accepted', r);
  const styled = r.rows[0]?.id;
  r = await as(pm, `INSERT INTO public.lists (space_id, name, color) VALUES ($1,'Bad list','javascript:alert(1)')`, [space]);
  record('list color is validated', !!r.error);
  r = await as(admin, `INSERT INTO public.teams (workspace_id, name, color) VALUES ($1,'Bad pod','url(x)')`, [ws]);
  record('pod color is validated', !!r.error);

  // ---- cross-workspace parent injection
  r = await as(admin, `INSERT INTO public.folders (space_id, name) VALUES ($1,'Injected')`, [spB]);
  record("admin of workspace A cannot create a folder under workspace B's space", !!r.error);
  r = await as(admin, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Injected')`, [spB]);
  record("admin of workspace A cannot create a list under workspace B's space", !!r.error);
  r = await as(admin, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'Injected','inj')`, [wsB]);
  record('admin of workspace A cannot create a space in workspace B', !!r.error);
  r = await as(pm, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'Cross')`, [spB, folder]);
  record('even a manager of BOTH workspaces cannot nest a list under a folder of the other workspace', !!r.error);
  r = await as(pm, `UPDATE public.lists SET space_id = $2, folder_id = NULL WHERE id = $1 RETURNING id`, [list, spB]);
  record('a list cannot be moved into another workspace', !!r.error || r.rows.length === 0);
  r = await as(pm, `UPDATE public.folders SET space_id = $2 WHERE id = $1 RETURNING id`, [folder, spB]);
  record('a folder cannot be moved into another workspace', !!r.error || r.rows.length === 0);
  r = await as(stranger, `SELECT id FROM public.spaces WHERE workspace_id = $1`, [ws]);
  record('outsider sees no spaces of the workspace', r.rows.length === 0 && !r.error);
  r = await as(stranger, `SELECT id FROM public.folders UNION ALL SELECT id FROM public.lists`);
  record('outsider sees no folders or lists', r.rows.length === 0 && !r.error);

  // ---- every non-privileged role is refused on update and delete
  for (const [roleName, who] of [['editor', editor], ['QC specialist', qc], ['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `UPDATE public.spaces SET name = 'pwn' WHERE id = $1 RETURNING id`, [space]);
    blocked(`${roleName} cannot rename a space`, r);
    r = await as(who, `UPDATE public.folders SET name = 'pwn' WHERE id = $1 RETURNING id`, [folder]);
    blocked(`${roleName} cannot rename a folder`, r);
    r = await as(who, `UPDATE public.lists SET name = 'pwn' WHERE id = $1 RETURNING id`, [list]);
    blocked(`${roleName} cannot rename a list`, r);
    r = await as(who, `DELETE FROM public.lists WHERE id = $1 RETURNING id`, [list]);
    blocked(`${roleName} cannot delete a list`, r);
    r = await as(who, `DELETE FROM public.folders WHERE id = $1 RETURNING id`, [folder]);
    blocked(`${roleName} cannot delete a folder`, r);
    r = await as(who, `DELETE FROM public.spaces WHERE id = $1 RETURNING id`, [space2]);
    blocked(`${roleName} cannot delete a space`, r);
  }
  r = await as(pm, `UPDATE public.spaces SET name = 'pwn' WHERE id = $1 RETURNING id`, [space]);
  blocked('production manager cannot edit spaces', r);
  r = await as(pm, `DELETE FROM public.folders WHERE id = $1 RETURNING id`, [folder]);
  blocked('production manager cannot delete folders', r);
  r = await as(pm, `DELETE FROM public.lists WHERE id = $1 RETURNING id`, [list2]);
  blocked('production manager cannot delete lists', r);

  // ---- what managers and admins may do
  r = await as(pm, `UPDATE public.folders SET name = 'ZIM (renamed)', description = 'd' WHERE id = $1 RETURNING name`, [folder]);
  record('production manager renames a folder', r.rows[0]?.name === 'ZIM (renamed)');
  r = await as(pm, `UPDATE public.lists SET name = 'EDAPTX (renamed)' WHERE id = $1 RETURNING name`, [list]);
  record('production manager renames a list', r.rows[0]?.name === 'EDAPTX (renamed)');
  r = await as(pm, `INSERT INTO public.folders (space_id, name, position) VALUES ($1,'Second folder',1) RETURNING id`, [space]);
  ok('production manager creates a second folder', r);
  const folder2 = r.rows[0]?.id;
  r = await as(pm, `UPDATE public.lists SET folder_id = $2 WHERE id = $1 RETURNING folder_id`, [list, folder2]);
  record('a list can move to another folder of the same space', r.rows[0]?.folder_id === folder2);
  r = await as(pm, `UPDATE public.lists SET folder_id = NULL WHERE id = $1 RETURNING folder_id`, [list]);
  record('...and out of its folder', r.rows.length === 1 && r.rows[0]?.folder_id === null);
  r = await as(pm, `UPDATE public.lists SET folder_id = $2 WHERE id = $1 RETURNING id`, [list, folder2]);
  ok('...and back into a folder', r);
  r = await as(pm, `UPDATE public.lists SET folder_id = $2 WHERE id = $1 RETURNING id`, [list2, folder2]);
  record("a list cannot move into a folder of a different space", !!r.error);
  r = await as(admin, `UPDATE public.spaces SET name = 'Content (renamed)', color = '#22C55E', icon = 'rocket' WHERE id = $1 RETURNING name, color, icon`, [space]);
  record('admin edits a space name, color and icon', r.rows[0]?.name === 'Content (renamed)' && r.rows[0]?.color === '#22C55E' && r.rows[0]?.icon === 'rocket');

  // ---- atomic, permission-checked reordering
  r = await as(admin, `SELECT public.reorder_hierarchy('space', ARRAY[$2::uuid, $1::uuid, $3::uuid]) AS n`, [space, space2, styled]);
  record('admin reorders spaces', !r.error && Number(r.rows[0]?.n) === 3, r.error?.message);
  r = await as(admin, `SELECT id FROM public.spaces WHERE workspace_id = $1 ORDER BY position`, [ws]);
  record('...and the new order is what was asked for', r.rows.map((x) => x.id).join() === [space2, space, styled].join());
  r = await as(pm, `SELECT public.reorder_hierarchy('space', ARRAY[$1::uuid, $2::uuid])`, [space, space2]);
  record('production manager cannot reorder spaces', !!r.error);
  r = await as(pm, `INSERT INTO public.folders (space_id, name, position) VALUES ($1,'Third folder',2) RETURNING id`, [space]);
  const folder3 = r.rows[0]?.id;
  r = await as(pm, `SELECT public.reorder_hierarchy('folder', ARRAY[$3::uuid, $1::uuid, $2::uuid]) AS n`, [folder, folder2, folder3]);
  record('production manager reorders folders', !r.error && Number(r.rows[0]?.n) === 3, r.error?.message);
  r = await as(pm, `SELECT id FROM public.folders WHERE space_id = $1 ORDER BY position`, [space]);
  record('...in the requested order', r.rows.map((x) => x.id).join() === [folder3, folder, folder2].join());
  r = await as(editor, `SELECT public.reorder_hierarchy('folder', ARRAY[$1::uuid, $2::uuid, $3::uuid])`, [folder, folder2, folder3]);
  record('editor cannot reorder', !!r.error);
  r = await as(stranger, `SELECT public.reorder_hierarchy('folder', ARRAY[$1::uuid])`, [folder]);
  record('outsider cannot reorder', !!r.error);
  r = await as('anon', `SELECT public.reorder_hierarchy('folder', ARRAY[$1::uuid])`, [folder]);
  record('anon cannot call reorder_hierarchy', !!r.error);
  r = await as(pm, `SELECT public.reorder_hierarchy('folder', ARRAY[$1::uuid, $1::uuid])`, [folder]);
  record('duplicate ids are rejected', !!r.error);
  r = await as(pm, `SELECT public.reorder_hierarchy('task', ARRAY[$1::uuid])`, [folder]);
  record('only space, folder and list can be reordered', !!r.error);
  const before = await svc(`SELECT position FROM public.lists WHERE id = $1`, [list]);
  r = await as(admin, `SELECT public.reorder_hierarchy('list', ARRAY[$1::uuid, $2::uuid])`, [list, listB]);
  record("mixing in another workspace's list fails the WHOLE reorder", !!r.error);
  const after = await svc(`SELECT position FROM public.lists WHERE id = $1`, [list]);
  record('...and nothing was changed (atomic)', before[0].position === after[0].position);
  r = await as(admin, `SELECT public.reorder_hierarchy('list', ARRAY[]::uuid[]) AS n`);
  record('reordering nothing is a no-op', !r.error && Number(r.rows[0]?.n) === 0);

  // ---- deleting
  r = await as(admin, `DELETE FROM public.folders WHERE id = $1 RETURNING id`, [folder2]);
  record('a folder that still has lists cannot be deleted', !!r.error);
  r = await as(admin, `DELETE FROM public.folders WHERE id = $1 RETURNING id`, [folder3]);
  ok('admin deletes an empty folder', r);
  r = await as(pm, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'Doomed') RETURNING id`, [styled, null]);
  const doomed = r.rows[0]?.id;
  r = await as(pm, `INSERT INTO public.folders (space_id, name) VALUES ($1,'Doomed folder') RETURNING id`, [styled]);
  const doomedFolder = r.rows[0]?.id;
  r = await as(admin, `DELETE FROM public.spaces WHERE id = $1 RETURNING id`, [styled]);
  ok('admin deletes a space', r);
  const gone = await svc(`SELECT (SELECT count(*)::int FROM public.lists WHERE id = $1) AS l, (SELECT count(*)::int FROM public.folders WHERE id = $2) AS f`, [doomed, doomedFolder]);
  record("deleting a space removes its folders and lists", gone[0].l === 0 && gone[0].f === 0);
  r = await as(admin, `DELETE FROM public.lists WHERE id = $1 RETURNING id`, [list2]);
  ok('admin deletes a list', r);

  // ---- hierarchy retrieval by role (the sidebar query)
  for (const [roleName, who, expected] of [['editor', editor, true], ['QC specialist', qc, true], ['client viewer', client, false]]) {
    r = await as(who, `SELECT id FROM public.spaces WHERE workspace_id = $1 ORDER BY position`, [ws]);
    record(`${roleName} ${expected ? 'sees' : 'does not see'} the workspace tree`, expected ? r.rows.length >= 1 : r.rows.length === 0);
  }
  r = await as(editor, `SELECT id FROM public.lists WHERE workspace_id = $1 AND space_id = $2`, [wsB, spB]);
  record("workspace A staff cannot read workspace B's lists even with the exact ids", r.rows.length === 0 && !r.error);
}

console.log('\n== Phase 6: task engine ==');
{
  const editor2 = await mkUser('editor2@tbb.test');
  r = await as(owner, `INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR') RETURNING user_id`, [ws, editor2]);
  ok('owner adds a second editor', r);
  await svc(`UPDATE public.profiles SET is_active = true, role = 'EDITOR' WHERE id = $1`, [editor]);
  await svc(`DELETE FROM public.tasks WHERE list_id = $1`, [list]); // clean slate for ordering tests
  const count = async () => Number((await svc(`SELECT count(*) AS n FROM public.tasks WHERE list_id = $1`, [list]))[0].n);
  const UNKNOWN_USER = '00000000-0000-4000-8000-00000000dead';
  const NULLS = 'NULL, NULL, NULL, NULL, NULL, NULL, NULL';

  // ---- create_task: positions, assignees, derived fields -------------------------------------
  r = await as(pm, `SELECT * FROM public.create_task($1, '  Video A  ', 'brief', 'HIGH', '9:16', 'https://drive.google.com/x', NULL, NULL, NULL, now() + interval '2 days', now() + interval '5 days', $2, $3)`, [list, editor, qc]);
  ok('manager creates a deliverable with editor + QC in one call', r);
  const tA = r.rows[0]?.id;
  record('title is trimmed, created_by/workspace derived, position starts at 0', r.rows[0]?.title === 'Video A' && r.rows[0]?.created_by === pm && r.rows[0]?.workspace_id === ws && r.rows[0]?.position === 0);
  record('priority, aspect ratio and dates are stored', r.rows[0]?.priority === 'HIGH' && r.rows[0]?.aspect_ratio === '9:16' && !!r.rows[0]?.client_deadline && !!r.rows[0]?.due_date);
  const asg = await svc(`SELECT role_type, user_id, assigned_by, workspace_id FROM public.task_assignees WHERE task_id = $1 ORDER BY role_type`, [tA]);
  record('both assignments created atomically, with assigned_by and workspace derived', asg.length === 2 && asg[0].role_type === 'EDITOR' && asg[0].user_id === editor && asg[1].user_id === qc && asg.every((a) => a.assigned_by === pm && a.workspace_id === ws));
  r = await as(admin, `SELECT * FROM public.create_task($1, 'Video B')`, [list]);
  ok('admin creates a bare task (defaults only)', r);
  const tB = r.rows[0]?.id;
  record('new tasks append: position 1, status TODO, priority MEDIUM', r.rows[0]?.position === 1 && r.rows[0]?.status === 'TODO' && r.rows[0]?.priority === 'MEDIUM' && r.rows[0]?.aspect_ratio === null);
  r = await as(owner, `SELECT * FROM public.create_task($1, 'Video C')`, [list]);
  const tC = r.rows[0]?.id;
  record('third task appended at position 2', r.rows[0]?.position === 2);

  // ---- who may create ------------------------------------------------------------------------
  for (const [name, who] of [['editor', editor], ['QC specialist', qc], ['client viewer', client], ['stranger', stranger]]) {
    const before = await count();
    r = await as(who, `SELECT * FROM public.create_task($1, 'Sneaky')`, [list]);
    record(`${name} cannot create tasks`, !!r.error && (await count()) === before, r.error?.message);
  }
  r = await as(pm, `SELECT * FROM public.create_task(gen_random_uuid(), 'Ghost list')`);
  record('creating a task in a non-existent list fails', !!r.error);

  // ---- input validation (the database is the last line of defence) ----------------------------
  const bad = [
    ['blank title', `SELECT * FROM public.create_task($1, '   ')`],
    ['invalid priority', `SELECT * FROM public.create_task($1, 'x', NULL, 'BLOCKER')`],
    ['invalid aspect ratio', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', '3:2')`],
    ['javascript: URL in raw footage link', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, 'javascript:alert(1)')`],
    ['data: URL in review link', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, 'data:text/html,hi')`],
    ['URL with whitespace', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, 'https://a.co/a b')`],
    ['URL without host', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, 'https://')`],
    ['URL over 2048 characters', `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, 'https://a.co/${'a'.repeat(2050)}')`],
    ['description over 20000 characters', `SELECT * FROM public.create_task($1, 'x', '${'d'.repeat(20001)}')`],
    ['title over 500 characters', `SELECT * FROM public.create_task($1, '${'t'.repeat(501)}')`],
  ];
  for (const [name, sql] of bad) {
    const before = await count();
    r = await as(pm, sql, [list]);
    record(`rejects ${name}`, !!r.error && (await count()) === before, r.error ? '' : 'was accepted');
  }
  r = await as(pm, `SELECT * FROM public.create_task($1, 'Links ok', NULL, 'LOW', '16:9', 'HTTPS://drive.google.com/drive/folders/abc?usp=sharing', 'http://x.co/p#f', 'https://app.frame.io/reviews/1', 'https://drive.google.com/file/d/1/view')`, [list]);
  ok('accepts valid http(s) links and an allowed aspect ratio', r);
  const tL = r.rows[0]?.id;

  // ---- assignment eligibility + atomicity -----------------------------------------------------
  const before = await count();
  r = await as(pm, `SELECT * FROM public.create_task($1, 'Atomic', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2, $3)`, [list, editor, editor]);
  record('same person as editor AND QC reviewer is refused, and NO task is left behind', !!r.error && (await count()) === before, r.error?.message);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, qc]);
  record('a QC specialist cannot be assigned as the editor', !!r.error);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, editor]);
  record('an editor cannot be assigned as QC reviewer', !!r.error);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, client]);
  record('a client viewer cannot be assigned', !!r.error);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, stranger]);
  record('a person outside the workspace cannot be assigned', !!r.error);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, UNKNOWN_USER]);
  record('an unknown user id cannot be assigned', !!r.error);
  await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [editor2]);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'x', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [list, editor2]);
  record('a deactivated account cannot be assigned', !!r.error);
  await svc(`UPDATE public.profiles SET is_active = true WHERE id = $1`, [editor2]);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'Managers can edit', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2, $3)`, [list, admin, owner]);
  ok('a manager may be assigned as editor and another manager as QC reviewer', r);

  // ---- set_task_assignee ---------------------------------------------------------------------
  r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [tB, editor2]);
  ok('manager assigns an editor to an unassigned task', r);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [tB, editor]);
  ok('manager re-assigns (replaces) the editor', r);
  const eds = await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'EDITOR'`, [tB]);
  record('exactly one editor row remains after replacing', eds.length === 1 && eds[0].user_id === editor);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'QC_REVIEWER', $2)`, [tB, editor]);
  record('re-assigning the editor as QC reviewer on the same task is refused', !!r.error);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', NULL)`, [tB]);
  ok('manager clears the editor', r);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', NULL)`, [tB]);
  ok('clearing an empty slot is a harmless no-op', r);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'CREATIVE_DIRECTOR', $2)`, [tB, editor]);
  record('unknown assignment role is refused', !!r.error);
  for (const [name, who] of [['editor', editor], ['QC specialist', qc], ['client viewer', client], ['stranger', stranger]]) {
    r = await as(who, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [tB, who]);
    record(`${name} cannot assign themselves`, !!r.error, r.error?.message);
  }
  r = await as(editor, `SELECT public.set_task_assignee($1, 'EDITOR', NULL)`, [tA]);
  record('an assigned editor cannot unassign themselves (managers only)', !!r.error);
  r = await as(editor, `INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [tC, editor]);
  record('direct INSERT into task_assignees by an editor is refused', !!r.error);
  r = await as(editor, `UPDATE public.task_assignees SET user_id = $2 WHERE task_id = $1 AND role_type = 'EDITOR' RETURNING task_id`, [tA, editor2]);
  blocked('editor cannot re-point an assignment', r);
  r = await as(pm, `UPDATE public.task_assignees SET role_type = 'QC_REVIEWER' WHERE task_id = $1 AND role_type = 'EDITOR' RETURNING task_id`, [tA]);
  record('an assignment cannot be switched to another role in place', !!r.error);

  // ---- visibility of assignments ------------------------------------------------------------
  for (const [name, who, want] of [['editor', editor, true], ['QC specialist', qc, true], ['client viewer', client, false], ['stranger', stranger, false]]) {
    r = await as(who, `SELECT task_id FROM public.task_assignees WHERE task_id = $1`, [tA]);
    record(`${name} ${want ? 'sees' : 'does not see'} assignments`, want ? r.rows.length === 2 : r.rows.length === 0 && !r.error);
  }
  r = await as('anon', `SELECT * FROM public.task_assignees`);
  record('anon cannot read task_assignees', !!r.error);
  r = await as('anon', `SELECT public.create_task($1, 'x')`, [list]);
  record('anon cannot call create_task', !!r.error);

  // ---- editor column + ownership rules ---------------------------------------------------
  r = await as(editor, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [tA]);
  ok('assigned editor starts work on their task', r);
  r = await as(editor, `UPDATE public.tasks SET review_link = 'https://app.frame.io/reviews/9', project_file_link = 'https://drive.google.com/p' WHERE id = $1 RETURNING id`, [tA]);
  ok('assigned editor submits review + project file links', r);
  for (const col of ["raw_footage_link = 'https://x.co/r'", "final_export_link = 'https://x.co/f'", "title = 'Mine'", "priority = 'URGENT'", 'due_date = now()', 'client_deadline = now()', "aspect_ratio = '1:1'", "description = 'x'"]) {
    r = await as(editor, `UPDATE public.tasks SET ${col} WHERE id = $1 RETURNING id`, [tA]);
    record(`assigned editor cannot change ${col.split(' ')[0]}`, !!r.error);
  }
  r = await as(editor, `UPDATE public.tasks SET status = 'READY_TO_DELIVER' WHERE id = $1 RETURNING id`, [tA]);
  record('assigned editor still cannot self-approve', !!r.error);
  r = await as(editor, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [tC]);
  record('editor cannot touch a task assigned to nobody', !!r.error);
  r = await as(editor2, `UPDATE public.tasks SET status = 'IN_PROGRESS' WHERE id = $1 RETURNING id`, [tA]);
  record("editor cannot touch a colleague's task", !!r.error);
  r = await as(editor2, `UPDATE public.tasks SET review_link = 'https://x.co/steal' WHERE id = $1 RETURNING id`, [tA]);
  record("editor cannot change a colleague's review link", !!r.error);
  r = await as(editor, `UPDATE public.tasks SET review_link = 'javascript:alert(1)' WHERE id = $1 RETURNING id`, [tA]);
  record('even an assigned editor cannot store a javascript: link', !!r.error);
  r = await as(editor, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [tA]);
  blocked('assigned editor cannot delete the task', r);

  // ---- QC rules remain ---------------------------------------------------------------------
  r = await as(editor, `UPDATE public.tasks SET status = 'IN_QC' WHERE id = $1 RETURNING id`, [tA]);
  ok('editor submits to QC', r);
  r = await as(qc, `UPDATE public.tasks SET status = 'READY_TO_DELIVER' WHERE id = $1 RETURNING id`, [tA]);
  ok('QC approves', r);
  r = await as(qc, `UPDATE public.tasks SET review_link = 'https://x.co/qc' WHERE id = $1 RETURNING id`, [tA]);
  record('QC cannot edit the brief or links', !!r.error);
  r = await as(client, `UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1 RETURNING id`, [tA]);
  blocked('client viewer cannot update', r);
  r = await as(stranger, `UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1 RETURNING id`, [tA]);
  blocked('stranger cannot update', r);

  // ---- managers edit everything ---------------------------------------------------------
  r = await as(pm, `UPDATE public.tasks SET title = 'Renamed', description = 'd', priority = 'URGENT', aspect_ratio = '4:5', raw_footage_link = 'https://x.co/raw', final_export_link = 'https://x.co/final', due_date = now(), client_deadline = now(), review_link = NULL WHERE id = $1 RETURNING id`, [tA]);
  ok('manager edits every deliverable field and can clear a link', r);
  r = await as(pm, `UPDATE public.tasks SET aspect_ratio = NULL, client_deadline = NULL WHERE id = $1 RETURNING id`, [tA]);
  ok('manager can clear optional fields', r);

  // ---- subtasks ----------------------------------------------------------------------------
  r = await as(pm, `INSERT INTO public.subtasks (task_id, title, position) VALUES ($1,'Rough cut',0),($1,'Captions',1) RETURNING id`, [tA]);
  ok('manager adds subtasks', r);
  const [s1, s2] = r.rows.map((x) => x.id);
  r = await as(editor, `UPDATE public.subtasks SET is_completed = true WHERE id = $1 RETURNING id`, [s1]);
  ok('assigned editor ticks a subtask of their task', r);
  r = await as(editor2, `UPDATE public.subtasks SET is_completed = true WHERE id = $1 RETURNING id`, [s2]);
  record("editor cannot tick a subtask of a colleague's task", !!r.error);
  r = await as(qc, `UPDATE public.subtasks SET is_completed = true WHERE id = $1 RETURNING id`, [s2]);
  ok('QC can tick subtasks', r);
  r = await as(editor, `DELETE FROM public.subtasks WHERE id = $1 RETURNING id`, [s1]);
  blocked('editor cannot delete subtasks', r);
  r = await as(pm, `INSERT INTO public.subtasks (task_id, title) VALUES ($1,'   ')`, [tA]);
  record('blank subtask title refused', !!r.error);

  // ---- ordering ------------------------------------------------------------------------------
  const order = async () => (await svc(`SELECT id FROM public.tasks WHERE list_id = $1 ORDER BY position, created_at, id`, [list])).map((x) => x.id);
  const positions = async () => (await svc(`SELECT position FROM public.tasks WHERE list_id = $1 ORDER BY position`, [list])).map((x) => x.position);
  const o = await order();
  r = await as(pm, `SELECT public.move_task($1, 'down') AS moved`, [o[0]]);
  record('manager moves the first task down', !r.error && r.rows[0]?.moved === true, r.error?.message);
  const o2 = await order();
  record('order changed by exactly one swap', o2[0] === o[1] && o2[1] === o[0] && o2.slice(2).join() === o.slice(2).join());
  record('positions stay dense 0..n-1', (await positions()).every((p, i) => p === i));
  r = await as(pm, `SELECT public.move_task($1, 'up') AS moved`, [o2[0]]);
  record('moving the first task up is a no-op (returns false)', !r.error && r.rows[0]?.moved === false);
  r = await as(pm, `SELECT public.move_task($1, 'down') AS moved`, [o2[o2.length - 1]]);
  record('moving the last task down is a no-op (returns false)', !r.error && r.rows[0]?.moved === false);
  r = await as(pm, `SELECT public.move_task($1, 'sideways')`, [o2[0]]);
  record('invalid direction refused', !!r.error);
  r = await as(editor, `SELECT public.move_task($1, 'up')`, [o2[1]]);
  record('an editor cannot reorder tasks', !!r.error);
  r = await as(stranger, `SELECT public.move_task($1, 'up')`, [o2[1]]);
  record('a stranger cannot reorder (task not visible)', !!r.error);
  r = await as(pm, `SELECT public.move_task(gen_random_uuid(), 'up')`);
  record('moving a non-existent task fails', !!r.error);
  // duplicate positions (legacy / concurrent inserts) are repaired by the next move
  await svc(`UPDATE public.tasks SET position = 0 WHERE list_id = $1`, [list]);
  r = await as(pm, `SELECT public.move_task($1, 'down') AS moved`, [(await order())[0]]);
  ok('a list with duplicate positions can still be reordered', r);
  record('...and comes out densely sequenced', (await positions()).every((p, i) => p === i));

  // ---- deletes + cascades --------------------------------------------------------------------
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [tA]);
  ok('manager deletes a task', r);
  const left = await svc(`SELECT (SELECT count(*) FROM public.task_assignees WHERE task_id = $1) a, (SELECT count(*) FROM public.subtasks WHERE task_id = $1) s`, [tA]);
  record('deleting a task removes its assignments and subtasks', Number(left[0].a) === 0 && Number(left[0].s) === 0);

  // ---- cross-workspace isolation ------------------------------------------------------------
  r = await as(editor, `SELECT task_id FROM public.task_assignees WHERE workspace_id = $1`, [wsB]);
  record("workspace A staff cannot read workspace B's assignments", r.rows.length === 0 && !r.error);
  r = await as(pm, `SELECT * FROM public.create_task($1, 'cross', NULL, 'LOW', NULL, NULL, NULL, NULL, NULL, NULL, NULL, $2)`, [listB, editor]);
  record('a workspace-A editor cannot be assigned to a workspace-B task', !!r.error);

  // ---- structure ----------------------------------------------------------------------------
  const cons = await svc(`SELECT conname FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND contype = 'c'`);
  record('task link / aspect ratio constraints exist', ['tasks_aspect_ratio_valid', 'tasks_raw_footage_link_url', 'tasks_project_file_link_url', 'tasks_review_link_url', 'tasks_final_export_link_url'].every((n) => cons.some((c) => c.conname === n)));
  const grants = await svc(`SELECT has_table_privilege('authenticated','public.task_assignees','SELECT') s, has_table_privilege('authenticated','public.task_assignees','INSERT') i, has_table_privilege('anon','public.task_assignees','SELECT') a, has_table_privilege('authenticated','public.task_assignees','TRUNCATE') t`);
  record('task_assignees: CRUD for signed-in users, nothing for anon, no TRUNCATE', grants[0].s && grants[0].i && !grants[0].a && !grants[0].t);
  const sig = 'public.create_task(uuid,text,text,text,text,text,text,text,text,timestamptz,timestamptz,uuid,uuid)';
  const rpcExec = await svc(`SELECT has_function_privilege('anon','${sig}','EXECUTE') a, has_function_privilege('authenticated','${sig}','EXECUTE') b`);
  record('task RPCs: executable by signed-in users only', !rpcExec[0].a && rpcExec[0].b);
  const definers = await svc(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname IN ('create_task','set_task_assignee','move_task') AND p.prosecdef`);
  record('task RPCs are SECURITY INVOKER (they add no privilege)', definers.length === 0);
  void NULLS; void tL;
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
