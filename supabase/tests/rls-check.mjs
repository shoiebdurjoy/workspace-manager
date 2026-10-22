// RLS / permission test for the TBB core schema.
// Runs the real migration inside PGlite (WASM Postgres) with a stand-in for
// Supabase's auth schema and roles. No Docker, no network, never touches a live DB.
//
//   npm install --no-save @electric-sql/pglite   (once; does not change package.json)
//   node supabase/tests/rls-check.mjs

import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import fs from 'fs';

import { fileURLToPath } from 'url';
const MIGRATIONS_DIR = fileURLToPath(new URL('../migrations/', import.meta.url));
const MIGRATION_FILES = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
const readMigration = (f) => fs.readFileSync(MIGRATIONS_DIR + f, 'utf8');
const db = new PGlite({ extensions: { pg_trgm } });

// ---- Minimal stand-in for Supabase's auth schema and roles -----------------
const BOOTSTRAP = `
  CREATE ROLE anon NOLOGIN;
  CREATE ROLE authenticated NOLOGIN;
  CREATE ROLE service_role NOLOGIN BYPASSRLS;
  CREATE SCHEMA auth;
  CREATE SCHEMA extensions;
  CREATE TABLE auth.users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    email text UNIQUE,
    email_confirmed_at timestamptz,
    raw_user_meta_data jsonb DEFAULT '{}'::jsonb
  );
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS
    $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  GRANT USAGE ON SCHEMA auth, public, extensions TO anon, authenticated, service_role;
  GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
  -- A stand-in for Supabase Storage's tables (the real Storage API fills owner_id from the caller's token
  -- and metadata from the bytes it actually stored; the trigger below mimics the first, tests supply the second).
  CREATE SCHEMA storage;
  CREATE TABLE storage.buckets (
    id text PRIMARY KEY, name text NOT NULL, public boolean DEFAULT false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  CREATE TABLE storage.objects (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    bucket_id text REFERENCES storage.buckets(id),
    name text NOT NULL,
    owner uuid,
    owner_id text,
    metadata jsonb,
    created_at timestamptz DEFAULT now(),
    UNIQUE (bucket_id, name)
  );
  ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
  CREATE FUNCTION storage.stamp_owner() RETURNS trigger LANGUAGE plpgsql AS
    $$ BEGIN NEW.owner_id := auth.uid()::text; RETURN NEW; END $$;
  CREATE TRIGGER trg_stamp_owner BEFORE INSERT ON storage.objects FOR EACH ROW EXECUTE FUNCTION storage.stamp_owner();
  GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
  GRANT SELECT, INSERT, DELETE ON storage.objects TO authenticated;
  GRANT ALL ON storage.objects, storage.buckets TO service_role;
  GRANT SELECT ON storage.buckets TO authenticated;
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
r = await as(client, `UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1 RETURNING id`, [task]);
blocked('client viewer cannot update tasks', r);
r = await as(stranger, `UPDATE public.tasks SET title = 'pwn' WHERE id = $1 RETURNING id`, [task]);
blocked('stranger cannot update tasks', r);

// Phase 6 tightening (migration 7): an editor acts only on tasks assigned to them.
// Phase 7 (migration 8): every status change is an edge of the TBB workflow allowed for the role.
r = await as(editor, `UPDATE public.tasks SET status = 'ASSIGNED' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot change a task that is NOT assigned to them', /assigned to them/.test(r.error?.message ?? ''), r.error?.message);
r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [task, editor]);
ok('manager assigns the editor to the task', r);
r = await as(editor, `UPDATE public.tasks SET status = 'ASSIGNED' WHERE id = $1 RETURNING id`, [task]);
record('an editor cannot assign work (TO BE EDITED -> ASSIGNED is a manager step)', /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
r = await as(pm, `UPDATE public.tasks SET status = 'ASSIGNED' WHERE id = $1 RETURNING id`, [task]);
ok('manager puts the task in the editor\'s queue', r);
r = await as(editor, `UPDATE public.tasks SET status = 'STARTED_EDITING', position = 3 WHERE id = $1 RETURNING id`, [task]);
ok('editor starts editing (and may reorder)', r);
r = await as(editor, `UPDATE public.tasks SET status = 'QC_FIRST_APPROVAL' WHERE id = $1 RETURNING id`, [task]);
record('submitting to QC needs the review link of the cut', /review link/.test(r.error?.message ?? ''), r.error?.message);
r = await as(editor, `UPDATE public.tasks SET status = 'QC_FIRST_APPROVAL', review_link = 'https://app.frame.io/r/1' WHERE id = $1 RETURNING id`, [task]);
ok('editor submits to QC with the review link', r);
r = await as(editor, `UPDATE public.tasks SET status = 'QC_APPROVED_RTD' WHERE id = $1 RETURNING id`, [task]);
record('EDITOR CANNOT SELF-APPROVE (-> QC- APPROVED (RTD))', /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
r = await as(editor, `UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot close tasks', !!r.error);
r = await as(editor, `UPDATE public.tasks SET title = 'Renamed' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot edit task title', !!r.error);
r = await as(editor, `UPDATE public.tasks SET due_date = now() WHERE id = $1 RETURNING id`, [task]);
record('editor cannot edit due date', !!r.error);
r = await as(editor, `UPDATE public.tasks SET list_id = $2 WHERE id = $1 RETURNING id`, [task, list2]);
record('editor cannot move task to another list', !!r.error);
r = await as(editor, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [task]);
blocked('editor cannot delete tasks', r);

r = await as(qc, `UPDATE public.tasks SET status = 'QC_APPROVED_RTD' WHERE id = $1 RETURNING id`, [task]);
ok('QC approves (QC- FIRST APPROVAL -> QC- APPROVED (RTD))', r);
r = await as(qc, `UPDATE public.tasks SET status = 'SENT_TO_CLIENT' WHERE id = $1 RETURNING id`, [task]);
record('sending to the client needs the final export link', /final export/.test(r.error?.message ?? ''), r.error?.message);
r = await as(qc, `UPDATE public.tasks SET status = 'SENT_TO_CLIENT', final_export_link = 'https://drive.google.com/final' WHERE id = $1 RETURNING id`, [task]);
ok('QC attaches the final export and delivers to the client', r);
r = await as(qc, `UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1 RETURNING id`, [task]);
record('QC cannot close tasks', /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
r = await as(qc, `UPDATE public.tasks SET title = 'QC rename' WHERE id = $1 RETURNING id`, [task]);
record('QC cannot edit task fields', !!r.error);
r = await as(editor, `UPDATE public.tasks SET status = 'STARTED_EDITING' WHERE id = $1 RETURNING id`, [task]);
record('editor cannot pull a delivered task back', !!r.error);

r = await as(pm, `UPDATE public.tasks SET status = 'CLOSED', title = 'Final' WHERE id = $1 RETURNING id`, [task]);
ok('manager can close and edit', r);
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
  // clean slate for ordering tests: earlier tasks move to a parking list (a task that reached first QC
  // carries a permanent production credit and cannot be deleted, migration 9)
  const parking = (await svc(`INSERT INTO public.lists (space_id, name) SELECT space_id, 'Parking' FROM public.lists WHERE id = $1 RETURNING id`, [list]))[0].id;
  await svc(`UPDATE public.tasks SET list_id = $2 WHERE list_id = $1`, [list, parking]);
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
  record('new tasks append: position 1, status TO BE EDITED, priority MEDIUM', r.rows[0]?.position === 1 && r.rows[0]?.status === 'TO_BE_EDITED' && r.rows[0]?.priority === 'MEDIUM' && r.rows[0]?.aspect_ratio === null);
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
  await svc(`UPDATE public.tasks SET status = 'ASSIGNED' WHERE id = $1`, [tA]); // fixture: in the editor's queue
  r = await as(editor, `UPDATE public.tasks SET status = 'STARTED_EDITING' WHERE id = $1 RETURNING id`, [tA]);
  ok('assigned editor starts work on their task', r);
  r = await as(editor, `UPDATE public.tasks SET review_link = 'https://app.frame.io/reviews/9', project_file_link = 'https://drive.google.com/p' WHERE id = $1 RETURNING id`, [tA]);
  ok('assigned editor submits review + project file links', r);
  for (const col of ["raw_footage_link = 'https://x.co/r'", "final_export_link = 'https://x.co/f'", "title = 'Mine'", "priority = 'URGENT'", 'due_date = now()', 'client_deadline = now()', "aspect_ratio = '1:1'", "description = 'x'"]) {
    r = await as(editor, `UPDATE public.tasks SET ${col} WHERE id = $1 RETURNING id`, [tA]);
    record(`assigned editor cannot change ${col.split(' ')[0]}`, !!r.error);
  }
  r = await as(editor, `UPDATE public.tasks SET status = 'QC_APPROVED_RTD' WHERE id = $1 RETURNING id`, [tA]);
  record('assigned editor still cannot self-approve', /your role cannot move|cannot move/.test(r.error?.message ?? ''), r.error?.message);
  r = await as(editor, `UPDATE public.tasks SET status = 'IN_EDIT' WHERE id = $1 RETURNING id`, [tC]);
  record('editor cannot touch a task assigned to nobody', /assigned to them/.test(r.error?.message ?? ''), r.error?.message);
  r = await as(editor2, `UPDATE public.tasks SET status = 'QC_FIRST_APPROVAL' WHERE id = $1 RETURNING id`, [tA]);
  record("editor cannot touch a colleague's task", !!r.error);
  r = await as(editor2, `UPDATE public.tasks SET review_link = 'https://x.co/steal' WHERE id = $1 RETURNING id`, [tA]);
  record("editor cannot change a colleague's review link", !!r.error);
  r = await as(editor, `UPDATE public.tasks SET review_link = 'javascript:alert(1)' WHERE id = $1 RETURNING id`, [tA]);
  record('even an assigned editor cannot store a javascript: link', !!r.error);
  r = await as(editor, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [tA]);
  blocked('assigned editor cannot delete the task', r);

  // ---- QC rules remain ---------------------------------------------------------------------
  r = await as(editor, `UPDATE public.tasks SET status = 'QC_FIRST_APPROVAL' WHERE id = $1 RETURNING id`, [tA]);
  ok('editor submits to QC', r);
  r = await as(qc, `UPDATE public.tasks SET status = 'QC_APPROVED_RTD' WHERE id = $1 RETURNING id`, [tA]);
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
  // tA reached first QC above, so it carries a permanent production credit (migration 9)
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [tA]);
  record('a task that earned a production credit cannot be deleted', r.error?.code === '23503', r.error?.message);
  await as(pm, `SELECT public.set_task_assignee($1, 'QC_REVIEWER', $2)`, [tB, qc]);
  await as(pm, `INSERT INTO public.subtasks (task_id, title) VALUES ($1, 'Rough cut')`, [tB]);
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [tB]);
  ok('manager deletes a task that never reached first QC', r);
  const left = await svc(`SELECT (SELECT count(*) FROM public.task_assignees WHERE task_id = $1) a, (SELECT count(*) FROM public.subtasks WHERE task_id = $1) s, (SELECT count(*) FROM public.task_status_events WHERE task_id = $1) e`, [tB]);
  record('deleting a task removes its assignments, subtasks and status history', Number(left[0].a) === 0 && Number(left[0].s) === 0 && Number(left[0].e) === 0);

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

console.log('\n== Phase 7: workflow engine ==');
{
  const NAMES = ['TO BE EDITED', 'IN EDIT', 'ASSIGNED', 'STARTED EDITING', 'QC- FIRST APPROVAL', 'QC- REVISION NEEDED', 'QC- FINAL APPROVAL', 'QC- APPROVED (RTD)', 'SENT TO CLIENT', 'CLIENT REVISION NEEDED', 'CLIENT APPROVED', 'PAUSED', 'CLOSED'];
  // ---- configuration ----------------------------------------------------------------------
  const wfRows = await svc(`SELECT id FROM public.workflows WHERE workspace_id = $1 AND is_default`, [ws]);
  record('the workspace has exactly one default workflow', wfRows.length === 1);
  const wf = wfRows[0]?.id;
  const st = await svc(`SELECT key, name, category FROM public.workflow_statuses WHERE workflow_id = $1 ORDER BY position`, [wf]);
  record('the TBB workflow has the 13 canonical stages, in order, with their exact names', JSON.stringify(st.map((x) => x.name)) === JSON.stringify(NAMES), st.map((x) => x.name).join(' | '));
  record('stages map to the reporting categories', st.map((x) => x.category).join(',') === 'NOT_STARTED,IN_PROGRESS,IN_PROGRESS,IN_PROGRESS,IN_REVIEW,IN_REVIEW,IN_REVIEW,READY,CLIENT,CLIENT,CLIENT,NOT_STARTED,COMPLETED');
  const tr = await svc(`SELECT count(*)::int n FROM public.workflow_transitions WHERE workflow_id = $1`, [wf]);
  record('34 transitions are defined', tr[0].n === 34, String(tr[0].n));
  const wfB = await svc(`SELECT count(*)::int n FROM public.workflows WHERE workspace_id = $1 AND is_default`, [wsB]);
  record('a workspace created later gets the TBB workflow automatically', wfB[0].n === 1);
  const cons = await svc(`SELECT count(*)::int n FROM pg_constraint WHERE conrelid = 'public.tasks'::regclass AND conname = 'tasks_status_check'`);
  record('status is no longer a CHECK constraint (statuses live in the workflow)', cons[0].n === 0);

  for (const [name, who, want] of [['editor', editor, 13], ['QC', qc, 13], ['client viewer', client, 0], ['stranger', stranger, 0]]) {
    r = await as(who, `SELECT key FROM public.workflow_statuses WHERE workflow_id = $1`, [wf]);
    record(`${name} ${want ? 'can' : 'cannot'} read the workflow`, !r.error && r.rows.length === want, `${r.rows.length}`);
  }
  r = await as('anon', `SELECT * FROM public.workflow_statuses`);
  record('anon cannot read the workflow', !!r.error);
  // only Owner / Admin customize the workflow (migration 27, tested under "Customize: status editor")
  r = await as(editor, `INSERT INTO public.workflow_statuses (workflow_id, key, name, category, color, position) VALUES ($1, 'HACK', 'HACK', 'READY', '#000000', 99)`, [wf]);
  record('an editor cannot add stages through the API', !!r.error);
  r = await as(qc, `UPDATE public.workflow_transitions SET roles = ARRAY['EDITOR'] WHERE workflow_id = $1 RETURNING to_key`, [wf]);
  record('QC cannot rewrite who may take a transition', !!r.error || r.rows.length === 0);
  r = await as(admin, `DELETE FROM public.workflows WHERE id = $1 RETURNING id`, [wf]);
  record('nobody can delete the workflow through the API', !!r.error || r.rows.length === 0);

  // ---- a fresh deliverable, created with editor + QC ---------------------------------------
  r = await as(pm, `SELECT * FROM public.create_task($1, 'P7 deliverable', NULL, 'HIGH', '9:16', NULL, NULL, NULL, NULL, NULL, NULL, $2, $3)`, [list, editor, qc]);
  ok('manager creates a deliverable', r);
  const t = r.rows[0]?.id;
  record('it starts at TO BE EDITED with revision 0', r.rows[0]?.status === 'TO_BE_EDITED' && r.rows[0]?.revision_count === 0);
  const go = (who, to, extra = '', params = []) => as(who, `SELECT (public.transition_task($1, $2${extra})).status AS status`, [t, to, ...params]);
  const statusNow = async () => (await svc(`SELECT status, revision_count FROM public.tasks WHERE id = $1`, [t]))[0];

  // ---- creation rules ---
  r = await as(pm, `INSERT INTO public.tasks (list_id, title, status) VALUES ($1, 'skip ahead', 'QC_APPROVED_RTD') RETURNING id`, [list]);
  record('a production manager cannot create a task in a later stage', /start at/.test(r.error?.message ?? ''), r.error?.message);
  r = await as(admin, `INSERT INTO public.tasks (list_id, title, status) VALUES ($1, 'admin import', 'QC_APPROVED_RTD') RETURNING id, status`, [list]);
  record('an admin may (e.g. importing work already done)', !r.error && r.rows[0]?.status === 'QC_APPROVED_RTD', r.error?.message);
  r = await as(pm, `INSERT INTO public.tasks (list_id, title, status) VALUES ($1, 'bad', 'DONE_DONE')`, [list]);
  record('an unknown status is refused', /unknown status/.test(r.error?.message ?? ''));

  // ---- the early stages ---
  r = await go(editor, 'IN_EDIT');
  record('an editor cannot queue work (TO BE EDITED -> IN EDIT is a manager step)', !!r.error);
  r = await go(qc, 'IN_EDIT');
  record('QC cannot queue work', !!r.error);
  r = await go(pm, 'QC_APPROVED_RTD');
  record('a manager cannot jump TO BE EDITED -> QC- APPROVED (RTD) (not an edge)', /a task cannot move from TO BE EDITED to QC- APPROVED \(RTD\)/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(pm, 'IN_EDIT');
  record('manager: TO BE EDITED -> IN EDIT', !r.error && r.rows[0]?.status === 'IN_EDIT', r.error?.message);
  r = await go(pm, 'TO_BE_EDITED');
  record('manager: IN EDIT -> TO BE EDITED (back)', !r.error, r.error?.message);
  r = await go(pm, 'ASSIGNED');
  record('manager: TO BE EDITED -> ASSIGNED (skipping the queue)', !r.error, r.error?.message);
  r = await go(pm, 'IN_EDIT');
  record('manager: ASSIGNED -> IN EDIT (back to the queue)', !r.error, r.error?.message);
  r = await go(pm, 'ASSIGNED');
  record('manager: IN EDIT -> ASSIGNED', !r.error, r.error?.message);
  r = await go(editor, 'STARTED_EDITING');
  record('assigned editor: ASSIGNED -> STARTED EDITING', !r.error, r.error?.message);
  r = await go(editor, 'ASSIGNED');
  record('assigned editor: STARTED EDITING -> ASSIGNED (pause)', !r.error, r.error?.message);
  r = await go(editor, 'STARTED_EDITING');
  ok('assigned editor resumes', r);

  // ---- submission to QC needs the review link; one call can set it ---
  r = await go(editor, 'QC_FIRST_APPROVAL');
  record('submitting without a review link is refused', /review link/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(editor, 'QC_FIRST_APPROVAL', ', NULL, $3', ['javascript:alert(1)']);
  record('...and a javascript: review link is refused too', !!r.error);
  r = await go(editor, 'QC_FIRST_APPROVAL', ', NULL, $3', ['https://app.frame.io/reviews/p7']);
  record('assigned editor submits for QC, attaching the review link in the same call', !r.error && r.rows[0]?.status === 'QC_FIRST_APPROVAL', r.error?.message);
  r = await go(editor, 'STARTED_EDITING');
  record('assigned editor: QC- FIRST APPROVAL -> STARTED EDITING (withdraw)', !r.error, r.error?.message);
  r = await go(editor, 'QC_FIRST_APPROVAL');
  ok('assigned editor resubmits (link already there)', r);

  // ---- approvals are QC / manager decisions ---
  for (const to of ['QC_APPROVED_RTD', 'QC_FINAL_APPROVAL', 'QC_REVISION_NEEDED']) {
    r = await go(editor, to, ', $3', ['self review']);
    record(`EDITOR CANNOT DECIDE QC (-> ${to})`, /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
  }
  const otherEditor = (await svc(`SELECT id FROM auth.users WHERE email = 'editor2@tbb.test'`))[0].id;
  r = await go(otherEditor, 'QC_APPROVED_RTD');
  record("another editor cannot approve a colleague's video", !!r.error);

  // ---- revision cycle: a note is required, the counter is system-managed ---
  r = await go(qc, 'QC_REVISION_NEEDED');
  record('requesting a revision without a note is refused', /needs a note/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(qc, 'QC_REVISION_NEEDED', ', $3', ['   ']);
  record('...and a blank note does not count', /needs a note/.test(r.error?.message ?? ''));
  r = await go(qc, 'QC_REVISION_NEEDED', ', $3', ['x'.repeat(2001)]);
  record('...and an over-long note is refused', !!r.error);
  r = await go(qc, 'QC_REVISION_NEEDED', ', $3', ['00:45 audio pop; tighten the hook']);
  record('QC requests a revision with a note', !r.error && r.rows[0]?.status === 'QC_REVISION_NEEDED', r.error?.message);
  record('revision count went to 1', (await statusNow()).revision_count === 1);
  let ev = await svc(`SELECT from_status, to_status, actor_id, note, revision_number, is_override FROM public.task_status_events WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [t]);
  record('the history records who, from, to, the note and the revision number', ev[0]?.from_status === 'QC_FIRST_APPROVAL' && ev[0]?.to_status === 'QC_REVISION_NEEDED' && ev[0]?.actor_id === qc && ev[0]?.note === '00:45 audio pop; tighten the hook' && ev[0]?.revision_number === 1 && ev[0]?.is_override === false, JSON.stringify(ev[0]));

  r = await as(pm, `UPDATE public.tasks SET revision_count = 99 WHERE id = $1 RETURNING revision_count`, [t]);
  record('not even a manager can set the revision count', !r.error && r.rows[0]?.revision_count === 1, JSON.stringify(r.rows[0] ?? r.error?.message));
  r = await as(editor, `UPDATE public.tasks SET revision_count = 0 WHERE id = $1 RETURNING revision_count`, [t]);
  record('nor the editor (it cannot be reset to hide revisions)', (await statusNow()).revision_count === 1);

  r = await go(qc, 'QC_FINAL_APPROVAL');
  record('QC cannot submit the editor\'s revision for them', /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(editor, 'QC_FINAL_APPROVAL', ', NULL, $3', ['https://app.frame.io/reviews/p7-v2']);
  record('assigned editor: QC- REVISION NEEDED -> QC- FINAL APPROVAL with the new cut', !r.error, r.error?.message);
  ev = await svc(`SELECT note FROM public.task_status_events WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [t]);
  record('a note never carries over to the next change', ev[0]?.note === null);
  r = await go(qc, 'QC_REVISION_NEEDED', ', $3', ['colour still off']);
  record('QC: QC- FINAL APPROVAL -> QC- REVISION NEEDED (another round)', !r.error, r.error?.message);
  record('revision count went to 2', (await statusNow()).revision_count === 2);
  r = await go(editor, 'QC_FINAL_APPROVAL');
  ok('editor resubmits', r);
  r = await go(qc, 'QC_APPROVED_RTD');
  record('QC: QC- FINAL APPROVAL -> QC- APPROVED (RTD)', !r.error, r.error?.message);
  r = await go(qc, 'QC_FINAL_APPROVAL');
  record('QC: QC- APPROVED (RTD) -> QC- FINAL APPROVAL (reopen)', !r.error, r.error?.message);
  r = await go(qc, 'QC_APPROVED_RTD');
  ok('QC approves again', r);

  // ---- stale decisions are refused ---
  r = await as(qc, `SELECT public.transition_task($1, 'SENT_TO_CLIENT', NULL, NULL, 'https://x.co/final', 'QC_FIRST_APPROVAL')`, [t]);
  record('a move decided on a stale status is refused (someone else moved it)', r.error?.code === 'TB409', r.error?.message);
  record('...and nothing changed', (await statusNow()).status === 'QC_APPROVED_RTD');

  // ---- delivery needs the final export; closing is for managers ---
  r = await go(qc, 'SENT_TO_CLIENT');
  record('sending to the client without the final export is refused', /final export/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(qc, 'SENT_TO_CLIENT', ', NULL, NULL, $3', ['https://drive.google.com/final-p7']);
  record('QC: QC- APPROVED (RTD) -> SENT TO CLIENT, attaching the final export', !r.error, r.error?.message);
  r = await go(qc, 'CLOSED');
  record('QC cannot close', /your role cannot move/.test(r.error?.message ?? ''), r.error?.message);
  r = await go(editor, 'CLOSED');
  record('the editor cannot close', !!r.error);
  r = await go(qc, 'QC_REVISION_NEEDED', ', $3', ['client: swap the music']);
  record('client feedback: SENT TO CLIENT -> QC- REVISION NEEDED (with note)', !r.error, r.error?.message);
  record('revision count went to 3', (await statusNow()).revision_count === 3);
  await go(editor, 'QC_FINAL_APPROVAL');
  await go(qc, 'QC_APPROVED_RTD');
  await go(qc, 'SENT_TO_CLIENT');
  r = await go(pm, 'CLOSED');
  record('manager: SENT TO CLIENT -> CLOSED', !r.error && r.rows[0]?.status === 'CLOSED', r.error?.message);
  r = await go(pm, 'SENT_TO_CLIENT');
  record('manager: CLOSED -> SENT TO CLIENT (reopen)', !r.error, r.error?.message);
  await go(pm, 'CLOSED');

  // ---- overrides: owner / admin only, and visible in the history ---
  r = await go(pm, 'TO_BE_EDITED');
  record('a production manager cannot override the workflow (CLOSED -> TO BE EDITED)', !!r.error);
  r = await go(admin, 'TO_BE_EDITED');
  record('an admin can override (CLOSED -> TO BE EDITED)', !r.error, r.error?.message);
  ev = await svc(`SELECT is_override, actor_id FROM public.task_status_events WHERE task_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1`, [t]);
  record('...and the history marks it as an override by that admin', ev[0]?.is_override === true && ev[0]?.actor_id === admin);
  r = await go(owner, 'QC_REVISION_NEEDED');
  record('an override still needs what the target stage needs (a revision note)', /needs a note/.test(r.error?.message ?? ''));

  // ---- direct REST bypass attempts behave exactly like the RPC ---
  r = await as(editor, `UPDATE public.tasks SET status = 'QC_APPROVED_RTD' WHERE id = $1 RETURNING id`, [t]);
  record('a direct PATCH cannot bypass the workflow', !!r.error);
  r = await as(client, `SELECT public.transition_task($1, 'CLOSED')`, [t]);
  record('client viewer cannot change status (task not visible)', !!r.error);
  r = await as(stranger, `SELECT public.transition_task($1, 'CLOSED')`, [t]);
  record('outsider cannot change status', !!r.error);
  r = await as('anon', `SELECT public.transition_task($1, 'CLOSED')`, [t]);
  record('anon cannot call transition_task', !!r.error);
  r = await as(pm, `SELECT public.transition_task(gen_random_uuid(), 'CLOSED')`);
  record('a task that does not exist is "not found"', r.error?.code === 'P0002');

  // ---- an assigned slot is required for ASSIGNED ---
  r = await as(pm, `SELECT * FROM public.create_task($1, 'no editor yet')`, [list]);
  const lonely = r.rows[0]?.id;
  r = await as(pm, `SELECT public.transition_task($1, 'ASSIGNED')`, [lonely]);
  record('ASSIGNED needs an editor', /needs an editor/.test(r.error?.message ?? ''), r.error?.message);

  // ---- history: complete, readable by staff only, append-only ---
  const all = await svc(`SELECT count(*)::int n, count(*) FILTER (WHERE from_status IS NULL)::int created FROM public.task_status_events WHERE task_id = $1`, [t]);
  record('every change is in the history, starting with the creation', all[0].n >= 25 && all[0].created === 1, JSON.stringify(all[0]));
  for (const [name, who, want] of [['editor', editor, true], ['QC', qc, true], ['client viewer', client, false], ['stranger', stranger, false]]) {
    r = await as(who, `SELECT id FROM public.task_status_events WHERE task_id = $1`, [t]);
    record(`${name} ${want ? 'can' : 'cannot'} read the history`, want ? r.rows.length > 0 : r.rows.length === 0 && !r.error);
  }
  r = await as(owner, `INSERT INTO public.task_status_events (task_id, workspace_id, to_status) VALUES ($1, $2, 'CLOSED')`, [t, ws]);
  record('nobody can write fake history', !!r.error);
  r = await as(owner, `UPDATE public.task_status_events SET note = 'rewritten' WHERE task_id = $1 RETURNING id`, [t]);
  record('nobody can rewrite history', !!r.error || r.rows.length === 0);
  r = await as(owner, `DELETE FROM public.task_status_events WHERE task_id = $1 RETURNING id`, [t]);
  record('nobody can erase history', !!r.error || r.rows.length === 0);

  // ---- security posture ---
  const definers = await svc(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname='public' AND p.proname = 'transition_task' AND p.prosecdef`);
  record('transition_task is SECURITY INVOKER', definers.length === 0);
  const exposed = await svc(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.prosecdef AND has_function_privilege('authenticated', p.oid, 'EXECUTE')`);
  record('still no SECURITY DEFINER function callable from the API', exposed.length === 0, exposed.map((x) => x.proname).join(','));
  const g = await svc(`SELECT has_table_privilege('authenticated','public.workflow_statuses','INSERT') a, has_table_privilege('authenticated','public.task_status_events','INSERT') b, has_table_privilege('anon','public.task_status_events','SELECT') c`);
  record('no write grants on workflow or history; nothing for anon', !g[0].a && !g[0].b && !g[0].c);
}

console.log('\n== Phase 7b: first-QC production credits ==');
{
  const editor2 = (await svc(`SELECT id FROM auth.users WHERE email = 'editor2@tbb.test'`))[0].id;
  const spaceId = (await svc(`SELECT space_id FROM public.lists WHERE id = $1`, [list]))[0].space_id;
  const l9 = (await svc(`INSERT INTO public.lists (space_id, name) VALUES ($1, 'P9 PRODUCTION') RETURNING id`, [spaceId]))[0].id;
  const mkTask = async (title, ed) => (await as(pm, `SELECT * FROM public.create_task(p_list_id => $1, p_title => $2, p_editor_id => $3, p_qc_id => $4)`, [l9, title, ed, qc])).rows[0]?.id;
  const mv = (who, id, to, o = {}) => as(who, `SELECT public.transition_task(p_task_id => $1, p_to => $2, p_note => $3, p_review_link => $4, p_final_export_link => $5)`, [id, to, o.note ?? null, o.review ?? null, o.export ?? null]);
  const credit = async (id) => (await svc(`SELECT editor_id, first_qc_submitted_at AS at, submitted_by FROM public.task_production_credits WHERE task_id = $1`, [id]))[0];
  const nCredits = async (id) => Number((await svc(`SELECT count(*) AS n FROM public.task_production_credits WHERE task_id = $1`, [id]))[0].n);
  const toFirstQc = async (id, who, review = 'https://app.frame.io/r/x') => {
    await mv(pm, id, 'ASSIGNED');
    await mv(who, id, 'STARTED_EDITING');
    return mv(who, id, 'QC_FIRST_APPROVAL', { review });
  };
  const backdate = async (id, ts) => {
    await svc(`ALTER TABLE public.task_production_credits DISABLE TRIGGER trg_production_credits_guard`);
    await svc(`UPDATE public.task_production_credits SET first_qc_submitted_at = $2 WHERE task_id = $1`, [id, ts]);
    await svc(`ALTER TABLE public.task_production_credits ENABLE TRIGGER trg_production_credits_guard`);
  };

  const prod = await svc(`SELECT count(*)::int n FROM public.workflow_statuses WHERE key = 'QC_FIRST_APPROVAL' AND credits_production`);
  const prodAll = await svc(`SELECT count(*)::int n FROM public.workflow_statuses WHERE credits_production`);
  record('QC- FIRST APPROVAL is the one production stage of every workflow', prod[0].n === prodAll[0].n && prodAll[0].n >= 2, JSON.stringify([prod[0], prodAll[0]]));

  // 1. first submission credits the editor who made it
  const t1 = await mkTask('Video X', editor);
  record('no credit before the first QC submission', (await nCredits(t1)) === 0);
  await mv(pm, t1, 'ASSIGNED');
  await mv(editor, t1, 'STARTED_EDITING');
  record('no credit while the task is still being edited', (await nCredits(t1)) === 0);
  r = await mv(editor, t1, 'QC_FIRST_APPROVAL', { review: 'https://app.frame.io/r/x1' });
  ok('editor submits Video X for first QC', r);
  const c1 = await credit(t1);
  record('1. the editor gets exactly one credit, with the submission time and who submitted', (await nCredits(t1)) === 1 && c1.editor_id === editor && c1.submitted_by === editor && Math.abs(Date.now() - new Date(c1.at).getTime()) < 120000);

  // 2 + 4. later stages and reassignment never change it
  await mv(qc, t1, 'QC_FINAL_APPROVAL');
  await mv(qc, t1, 'QC_APPROVED_RTD');
  await mv(qc, t1, 'SENT_TO_CLIENT', { export: 'https://drive.google.com/final' });
  await mv(pm, t1, 'CLOSED');
  let c1b = await credit(t1);
  record('2. final approval, delivery and closing change neither the editor nor the date', c1b.editor_id === editor && +new Date(c1b.at) === +new Date(c1.at) && (await nCredits(t1)) === 1);
  r = await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t1, editor2]);
  ok('the closed task is reassigned to another editor', r);
  c1b = await credit(t1);
  record('4. reassignment AFTER first QC: the original editor keeps the credit', c1b.editor_id === editor && (await nCredits(t1)) === 1);

  // 3. reassignment before first QC: the new editor earns it
  const t2 = await mkTask('Video Y', editor);
  await mv(pm, t2, 'ASSIGNED');
  await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t2, editor2]);
  await mv(editor2, t2, 'STARTED_EDITING');
  r = await mv(editor, t2, 'QC_FIRST_APPROVAL', { review: 'https://app.frame.io/r/y' });
  record('the previous editor can no longer submit it', !!r.error);
  await mv(editor2, t2, 'QC_FIRST_APPROVAL', { review: 'https://app.frame.io/r/y' });
  const c2 = await credit(t2);
  record('3. reassignment BEFORE first QC: the new editor gets +1, the first one +0', c2?.editor_id === editor2 && Number((await svc(`SELECT count(*) AS n FROM public.task_production_credits WHERE task_id = $1 AND editor_id = $2`, [t2, editor]))[0].n) === 0);

  // 5 + 6. revisions and repeated first-QC entries never add a credit
  const t3 = await mkTask('Video Z', editor);
  await toFirstQc(t3, editor);
  const c3 = await credit(t3);
  await mv(qc, t3, 'QC_REVISION_NEEDED', { note: 'fix intro' });
  await mv(editor, t3, 'QC_FINAL_APPROVAL');
  await mv(qc, t3, 'QC_REVISION_NEEDED', { note: 'again' });
  record('5. a revision cycle creates no second credit', (await nCredits(t3)) === 1);
  r = await mv(owner, t3, 'STARTED_EDITING');
  ok('an admin override sends it back to STARTED EDITING', r);
  await as(pm, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t3, editor2]);
  r = await mv(editor2, t3, 'QC_FIRST_APPROVAL', { review: 'https://app.frame.io/r/z2' });
  ok('another editor submits it for first QC AGAIN', r);
  const c3b = await credit(t3);
  record('6. repeating QC- FIRST APPROVAL: still one credit, same editor, same time', (await nCredits(t3)) === 1 && c3b.editor_id === editor && +new Date(c3b.at) === +new Date(c3.at));
  await mv(editor2, t3, 'STARTED_EDITING');
  await mv(editor2, t3, 'QC_FIRST_APPROVAL');
  record('...also after "withdraw from QC" and a third submission', (await nCredits(t3)) === 1);
  const evts = await svc(`SELECT count(*)::int n FROM public.task_status_events WHERE to_status = 'QC_FIRST_APPROVAL' AND task_id = ANY($1::uuid[])`, [[t1, t2, t3]]);
  record('the history shows every submission but the credits only the first', evts[0].n === 5 && (await nCredits(t1)) + (await nCredits(t2)) + (await nCredits(t3)) === 3, String(evts[0].n));

  // 7 + 8. several videos per month, several years, time zones
  const dates = ['2019-03-05T10:00:00Z', '2019-03-20T10:00:00Z', '2019-03-31T23:30:00Z', '2019-04-02T08:00:00Z', '2020-03-15T09:00:00Z'];
  const ids = [];
  for (const [i, d] of dates.entries()) {
    const t = await mkTask(`Archive ${i + 1}`, editor);
    await toFirstQc(t, editor, `https://app.frame.io/r/a${i + 1}`);
    await backdate(t, d);
    ids.push(t);
  }
  await backdate(t1, '2019-05-10T10:00:00Z'); // keeps its original editor
  await backdate(t2, '2019-03-12T10:00:00Z'); // editor2's
  await backdate(t3, '2020-12-31T20:00:00Z');
  const monthly = (who, tz = 'UTC') => as(who, `SELECT editor_id, year, month, credits FROM public.production_monthly($1, $2) WHERE year <= 2021 ORDER BY editor_id, year, month`, [ws, tz]);
  const key = (rows, e) => rows.filter((x) => x.editor_id === e).map((x) => `${x.year}-${x.month}:${x.credits}`).join(',');
  r = await monthly(owner);
  record('7+8. monthly counts: several videos per month, several years, per editor', !r.error && key(r.rows, editor) === '2019-3:3,2019-4:1,2019-5:1,2020-3:1,2020-12:1' && key(r.rows, editor2) === '2019-3:1', r.error?.message ?? `${key(r.rows, editor)} | ${key(r.rows, editor2)}`);
  r = await monthly(admin, 'Asia/Dhaka');
  record('months follow the chosen time zone (23:30 UTC on 31 Mar is 1 Apr in Dhaka)', !r.error && key(r.rows, editor).startsWith('2019-3:2,2019-4:2'), r.error?.message ?? key(r.rows, editor));
  r = await monthly(owner, 'Not/AZone');
  record('an unknown time zone is refused', !!r.error);

  // 9 + 10. the videos behind a month are the real tasks, with their own links
  r = await as(admin, `SELECT * FROM public.production_videos($1, $2, 2019, 3)`, [ws, editor]);
  record('9. the month lists exactly its videos, newest first, as real task ids', !r.error && r.rows.map((x) => x.task_id).join() === [ids[2], ids[1], ids[0]].join(), r.error?.message ?? r.rows.map((x) => x.title).join());
  const v = r.rows[2];
  record("10. each video carries the task's own review link, title, list, status and date", v?.review_link === 'https://app.frame.io/r/a1' && v.title === 'Archive 1' && v.list_name === 'P9 PRODUCTION' && v.list_id === l9 && v.status === 'QC_FIRST_APPROVAL' && new Date(v.first_qc_submitted_at).toISOString().startsWith('2019-03-05'));
  r = await as(admin, `SELECT * FROM public.production_videos($1, $2, 2019, 3)`, [ws, editor2]);
  record("another editor's month shows only their own video", r.rows.length === 1 && r.rows[0].task_id === t2);
  r = await as(admin, `SELECT * FROM public.production_videos($1, $2, 2019, 13)`, [ws, editor]);
  record('an invalid month is refused', !!r.error);
  const t1Final = (await as(admin, `SELECT * FROM public.production_videos($1, $2, 2019, 5)`, [ws, editor])).rows[0];
  record('a task reassigned and closed since still appears under its original editor, with its current status and links', t1Final?.task_id === t1 && t1Final.status === 'CLOSED' && t1Final.final_export_link === 'https://drive.google.com/final');

  // 11 + 12. only Owner / Admin
  for (const [name, who] of [['production manager', pm], ['QC specialist', qc], ['editor', editor], ['client viewer', client], ['stranger', stranger]]) {
    const sum = await as(who, `SELECT * FROM public.production_monthly($1, 'UTC')`, [ws]);
    const rows = await as(who, `SELECT * FROM public.production_videos($1, $2, 2019, 3)`, [ws, editor]);
    const tbl = await as(who, `SELECT * FROM public.task_production_credits`);
    record(`11/12. ${name}: production summary, month list and credits table are all denied`, sum.error?.code === '42501' && rows.error?.code === '42501' && !tbl.error && tbl.rows.length === 0, `${sum.error?.code} ${rows.error?.code} ${tbl.rows.length}`);
  }
  r = await as('anon', `SELECT * FROM public.production_monthly($1, 'UTC')`, [ws]);
  record('11/12. anon cannot call the production functions', !!r.error);
  r = await as('anon', `SELECT * FROM public.task_production_credits`);
  record('11/12. anon cannot read the credits table', !!r.error);
  for (const [name, who] of [['owner', owner], ['admin', admin]]) {
    r = await as(who, `SELECT count(*)::int n FROM public.task_production_credits WHERE workspace_id = $1`, [ws]);
    record(`${name} can read the credits`, !r.error && r.rows[0].n >= 8, r.error?.message);
  }
  r = await as(owner, `SELECT * FROM public.production_monthly($1, 'UTC')`, [wsB]);
  record("an admin of one workspace cannot read another workspace's production", r.error?.code === '42501');

  // permanence: nobody writes, changes or deletes credits
  r = await as(owner, `INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at) VALUES ($1, $2, $3, now())`, [t1, ws, editor2]);
  record('nobody can insert a credit through the API (owner)', !!r.error);
  r = await as(owner, `UPDATE public.task_production_credits SET editor_id = $2 WHERE task_id = $1 RETURNING task_id`, [t1, editor2]);
  record('nobody can re-attribute a credit through the API (owner)', !!r.error || r.rows.length === 0);
  r = await as(owner, `DELETE FROM public.task_production_credits WHERE task_id = $1 RETURNING task_id`, [t1]);
  record('nobody can delete a credit through the API (owner)', !!r.error || r.rows.length === 0);
  try { await svc(`UPDATE public.task_production_credits SET editor_id = $2 WHERE task_id = $1`, [t1, editor2]); record('even the service role cannot change a credit', false, 'was allowed'); }
  catch (e) { record('even the service role cannot change a credit', /permanent/.test(e.message), e.message); }
  try { await svc(`DELETE FROM public.task_production_credits WHERE task_id = $1`, [t1]); record('even the service role cannot delete a credit directly', false, 'was allowed'); }
  catch (e) { record('even the service role cannot delete a credit directly', /permanent/.test(e.message), e.message); }
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [t1]);
  record('a credited task cannot be deleted (its production history would vanish)', r.error?.code === '23503' || r.rows.length === 0, r.error?.message);
  const stillThere = await credit(t1);
  record('...and the credit is untouched after all of those attempts', stillThere.editor_id === editor && new Date(stillThere.at).toISOString().startsWith('2019-05-10'));
  r = await as(editor, `UPDATE public.tasks SET status = 'QC_FIRST_APPROVAL' WHERE id = $1 RETURNING id`, [t1]);
  record('a plain PATCH cannot mint a second credit either (the workflow refuses the move)', !!r.error);

  // a credit is a fact about a moment, not about the editor's account
  const [{ n: before }] = await svc(`SELECT count(*)::int n FROM public.task_production_credits WHERE editor_id = $1`, [editor]);
  await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [editor]);
  await svc(`UPDATE public.profiles SET is_active = true WHERE id = $1`, [editor]);
  const [{ n: after }] = await svc(`SELECT count(*)::int n FROM public.task_production_credits WHERE editor_id = $1`, [editor]);
  record('deactivating and re-activating an editor keeps their credits', before === after && before >= 6);

  // deleting a whole workspace is the only way credits disappear
  const wsC = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('C','c-prod',$1) RETURNING id`, [pm]))[0].id;
  const spC = (await svc(`INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsC]))[0].id;
  const lC = (await svc(`INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spC]))[0].id;
  const tC = (await svc(`INSERT INTO public.tasks (list_id, title) VALUES ($1,'t') RETURNING id`, [lC]))[0].id;
  await svc(`INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at) VALUES ($1,$2,$3,now())`, [tC, wsC, editor]);
  try { await svc(`DELETE FROM public.workspaces WHERE id = $1`, [wsC]); record('deleting a whole workspace removes its credits (cascade)', (await nCredits(tC)) === 0); }
  catch (e) { record('deleting a whole workspace removes its credits (cascade)', false, e.message); }
}

console.log('\n== Phase 9: database-side task search, filters and sorting ==');
{
  const editor2 = (await svc(`SELECT id FROM auth.users WHERE email = 'editor2@tbb.test'`))[0].id;
  await svc(`UPDATE public.profiles SET full_name = 'Zelda Zimmer' WHERE id = $1`, [editor]);
  await svc(`UPDATE public.profiles SET full_name = 'Yara Young' WHERE id = $1`, [editor2]);
  await svc(`UPDATE public.profiles SET full_name = 'Quentin Quill' WHERE id = $1`, [qc]);

  // ---- a controlled corner of the workspace: two spaces, a folder, three lists, six tasks ----------
  const SP = (await svc(`INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1, 'Search Space', 'p9-a'), ($1, 'Elsewhere', 'p9-b') RETURNING id, name`, [ws]));
  const spA = SP.find((x) => x.name === 'Search Space').id;
  const spB = SP.find((x) => x.name === 'Elsewhere').id;
  const fd = (await svc(`INSERT INTO public.folders (space_id, name) VALUES ($1, 'Folder Nine') RETURNING id`, [spA]))[0].id;
  const lA = (await svc(`INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1, $2, 'Alpha pipeline') RETURNING id`, [spA, fd]))[0].id;
  const lB = (await svc(`INSERT INTO public.lists (space_id, name) VALUES ($1, 'Beta pipeline') RETURNING id`, [spA]))[0].id;
  const lC = (await svc(`INSERT INTO public.lists (space_id, name) VALUES ($1, 'Gamma pipeline') RETURNING id`, [spB]))[0].id;
  await svc(`UPDATE public.spaces SET position = CASE WHEN id = $1 THEN 0 ELSE 1 END WHERE id IN ($1, $2)`, [spA, spB]);
  await svc(`UPDATE public.lists SET position = CASE WHEN id = $2 THEN 1 ELSE 0 END WHERE id IN ($1, $2, $3)`, [lA, lB, lC]);
  const mkTask = async (key, o) => {
    const t = (await svc(`INSERT INTO public.tasks (list_id, title, description, priority, due_date, client_deadline, aspect_ratio) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [o.list, o.title, o.desc ?? null, o.priority, o.due ?? null, o.client ?? null, o.aspect ?? null]))[0].id;
    if (o.editor) await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [t, o.editor]);
    if (o.qc) await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'QC_REVIEWER',$2)`, [t, o.qc]);
    if (o.status) await svc(`UPDATE public.tasks SET status = $2, review_link = 'https://app.frame.io/r/x' WHERE id = $1`, [t, o.status]);
    await svc(`UPDATE public.tasks SET position = $2 WHERE id = $1`, [t, o.pos ?? 0]);
    if (o.created) await svc(`UPDATE public.tasks SET created_at = $2 WHERE id = $1`, [t, o.created]);
    return [key, t];
  };
  const day = (n) => new Date(Date.now() + n * 86400000).toISOString();
  const ids = Object.fromEntries(await Promise.all([
    mkTask('t1', { list: lA, title: 'Walmart hook test', desc: 'Cut to 58 seconds', priority: 'HIGH', due: day(2), client: day(10), aspect: '9:16', pos: 0 }),
  ]));
  // sequential, so created_at order (the tie-break) is the order written here
  for (const [key, o] of [
    ['t2', { list: lA, title: 'Walmart long cut', priority: 'URGENT', due: day(-3), aspect: '16:9', editor, qc, status: 'STARTED_EDITING', pos: 1 }],
    ['t3', { list: lB, title: 'Lori Bales testimonial', priority: 'MEDIUM', aspect: '9:16', editor: editor2, qc, status: 'QC_FIRST_APPROVAL', pos: 0 }],
    ['t4', { list: lB, title: 'Patton Moving 100% done', priority: 'LOW', due: day(-20), editor, status: 'CLOSED', pos: 1 }],
    ['t5', { list: lC, title: 'under_score task', priority: 'MEDIUM', pos: 0 }],
    ['t6', { list: lC, title: 'Gamma ad', priority: 'LOW', status: 'IN_EDIT', created: day(-40), pos: 1 }],
  ]) ids[key] = (await mkTask(key, o))[1];
  await svc(`UPDATE public.tasks SET status = 'IN_EDIT' WHERE id = $1`, [ids.t6]);
  // another workspace's task with a matching word: it must never show up here
  await svc(`INSERT INTO public.tasks (workspace_id, list_id, title) VALUES ($1, $2, 'Walmart secret of another workspace')`, [wsB, listB]);

  const BASE = { spaces: [spA, spB] };
  const search = (who, q, filters = {}, sort = 'manual', dir = 'asc', limit = 500, offset = 0) =>
    as(who, `SELECT * FROM public.search_tasks($1, $2, $3::jsonb, $4, $5, $6, $7)`, [ws, q, JSON.stringify({ ...BASE, ...filters }), sort, dir, limit, offset]);
  const named = (res) => res.rows.map((r) => Object.keys(ids).find((k) => ids[k] === r.id));
  const set = (...keys) => keys.sort().join(',');
  let last = '';
  const sameSet = (res, ...keys) => {
    last = res.error ? res.error.message : named(res).join(',');
    return !res.error && named(res).sort().join(',') === set(...keys);
  };

  // ---- who may search ------------------------------------------------------------------------
  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['QC specialist', qc], ['editor', editor]]) {
    r = await search(who, null);
    record(`${name} can search the workspace's tasks`, !r.error && r.rows.length === 6, r.error?.message ?? String(r.rows.length));
  }
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    r = await search(who, null);
    record(`${name} is refused (42501)`, r.error?.code === '42501', r.error?.message);
  }
  r = await as('anon', `SELECT * FROM public.search_tasks($1)`, [ws]);
  record('anon cannot call search_tasks', !!r.error);
  r = await as(editor, `SELECT * FROM public.search_tasks($1)`, [wsB]);
  record("a staff member of one workspace cannot search another workspace's tasks", r.error?.code === '42501', r.error?.message);
  r = await search(editor, 'secret');
  record("another workspace's task never appears, even for a matching word", !r.error && r.rows.length === 0);
  r = await as(editor, `SELECT proname FROM pg_proc WHERE proname = 'search_tasks' AND prosecdef`);
  record('search_tasks runs as the caller (SECURITY INVOKER), so RLS applies to every table it reads', r.rows.length === 0);

  // ---- free text -----------------------------------------------------------------------------
  const q = (text, ...keys) => async () => sameSet(await search(editor, text), ...keys);
  const cases = [
    ['title, any case', 'WALMART', ['t1', 't2']],
    ['every word must match, in any order', 'hook walmart', ['t1']],
    ['the brief', '58 seconds', ['t1']],
    ['the list name', 'alpha', ['t1', 't2']],
    ['a word in two list names', 'pipeline', ['t1', 't2', 't3', 't4', 't5', 't6']],
    ['the folder name', 'nine', ['t1', 't2']],
    ['the space name', 'elsewhere', ['t5', 't6']],
    ['the editor name', 'zelda', ['t2', 't4']],
    ['the QC reviewer name', 'quentin', ['t2', 't3']],
    ['a name and a title word together', 'zelda walmart', ['t2']],
    ['nothing matches', 'zzzzzz-no-such', []],
    ['an empty search returns everything', '   ', ['t1', 't2', 't3', 't4', 't5', 't6']],
    ['a literal % is not a wildcard', '100%', ['t4']],
    ['a lone % matches only text that really contains one', '%', ['t4']],
    ['a literal _ is not a wildcard', '_', ['t5']],
    ['a backslash is just a character', '\\', []],
  ];
  for (const [name, text, keys] of cases) { const ok = await q(text, ...keys)(); record(`search: ${name}`, ok, `${text} -> ${last}`); }
  const prefix = ids.t3.slice(0, 8);
  r = await search(editor, `#${prefix}`);
  record('search: a short task id (with #) finds that task', sameSet(r, 't3'), named(r).join());
  r = await search(editor, prefix.toUpperCase());
  record('search: a short id is case-insensitive', sameSet(r, 't3'));
  r = await search(editor, `'; DROP TABLE public.tasks; --`);
  const stillThere = await svc(`SELECT count(*)::int n FROM public.tasks`);
  record('search: SQL in the search box is just text (nothing dropped, nothing matched)', !r.error && r.rows.length === 0 && stillThere[0].n >= 7, r.error?.message);
  r = await search(editor, 'a '.repeat(40));
  record('search: a very long query is bounded, not an error', !r.error);
  r = await search(editor, 'x'.repeat(500));
  record('search: a very long word is cut short, not an error', !r.error);

  // ---- filters (each alone, then together) -------------------------------------------------------
  const f = async (filters, ...keys) => sameSet(await search(editor, null, filters), ...keys);
  const rf = async (name, filters, ...keys) => { const ok = await f(filters, ...keys); record(name, ok, last); };
  await rf('filter: status', { statuses: ['QC_FIRST_APPROVAL', 'CLOSED'] }, 't3', 't4');
  await rf('filter: priority', { priorities: ['URGENT', 'LOW'] }, 't2', 't4', 't6');
  await rf('filter: aspect ratio', { aspectRatios: ['9:16'] }, 't1', 't3');
  await rf('filter: editor', { editors: [editor] }, 't2', 't4');
  await rf('filter: no editor', { noEditor: true }, 't1', 't5', 't6');
  await rf('filter: an editor or nobody', { editors: [editor2], noEditor: true }, 't3', 't1', 't5', 't6');
  await rf('filter: QC reviewer', { qcs: [qc] }, 't2', 't3');
  await rf('filter: no QC reviewer', { noQc: true }, 't1', 't4', 't5', 't6');
  await rf('filter: assigned to (editor or QC)', { people: [qc] }, 't2', 't3');
  await rf('filter: assigned to someone who is only an editor', { people: [editor2] }, 't3');
  await rf('filter: space', { spaces: [spB] }, 't5', 't6');
  await rf('filter: folder', { folders: [fd] }, 't1', 't2');
  await rf('filter: list', { lists: [lB] }, 't3', 't4');
  await rf('filter: due date range', { dueFrom: day(-5), dueTo: day(5) }, 't1', 't2');
  await rf('filter: no due date', { noDue: true }, 't3', 't5', 't6');
  await rf('filter: client deadline range', { clientFrom: day(5), clientTo: day(15) }, 't1');
  await rf('filter: created before a date', { createdTo: day(-30) }, 't6');
  await rf('filter: created since a date', { createdFrom: day(-1) }, 't1', 't2', 't3', 't4', 't5');
  await rf('filter: overdue = unfinished with a past deadline (a closed task never counts)', { overdue: true, overdueBefore: new Date().toISOString() }, 't2');
  await rf('filter: hide finished', { hideFinished: true }, 't1', 't2', 't3', 't5', 't6');
  await rf('filters combine with AND', { editors: [editor], statuses: ['CLOSED'] }, 't4');
  record('filters combine with the search text', sameSet(await search(editor, 'walmart', { priorities: ['URGENT'] }), 't2'));
  await rf('three filters at once (editor + status + priority)', { editors: [editor], statuses: ['STARTED_EDITING'], priorities: ['URGENT'] }, 't2');
  await rf('unknown filter keys are ignored', { nonsense: [1], statuses: ['CLOSED'] }, 't4');
  await rf('an empty list is no filter', { statuses: [], priorities: null }, 't1', 't2', 't3', 't4', 't5', 't6');
  r = await search(editor, null, { lists: ['not-a-uuid'] });
  record('a malformed id is refused, not ignored', !!r.error, r.error?.message);
  r = await as(editor, `SELECT * FROM public.search_tasks($1, NULL, '["a"]'::jsonb)`, [ws]);
  record('filters must be an object', r.error?.code === '22023', r.error?.code);
  r = await search(editor, null, { statuses: Array.from({ length: 101 }, (_, i) => `S${i}`) });
  record('more than 100 values in one filter is refused (never silently dropped)', r.error?.code === '22023', r.error?.code);
  r = await search(editor, null, { dueFrom: 'yesterday-ish' });
  record('a malformed date is refused', !!r.error);

  // ---- sorting ---------------------------------------------------------------------------------
  const order = async (sort, dir) => named(await search(editor, null, {}, sort, dir));
  const sorted = (keys, ranks, dir = 'asc') => keys.every((k, i) => i === 0 || (dir === 'asc' ? ranks[keys[i - 1]] <= ranks[k] : ranks[keys[i - 1]] >= ranks[k]));
  const prio = { t1: 1, t2: 0, t3: 2, t4: 3, t5: 2, t6: 3 };
  record('sort: priority, most urgent first', sorted(await order('priority', 'asc'), prio));
  record('sort: priority descending', sorted(await order('priority', 'desc'), prio, 'desc'));
  let o = await order('dueDate', 'asc');
  record('sort: due date ascending, empty dates last', o.slice(0, 3).join() === 't4,t2,t1' && new Set(o.slice(3)).size === 3, o.join());
  o = await order('dueDate', 'desc');
  record('sort: due date descending, empty dates STILL last', o.slice(0, 3).join() === 't1,t2,t4', o.join());
  o = await order('status', 'asc');
  record('sort: stage in workflow order', o.join() === 't1,t5,t6,t2,t3,t4', o.join());
  o = await order('editor', 'asc');
  record('sort: editor by name, nobody last', o.slice(0, 3).join() === 't3,t2,t4' && new Set(o.slice(3)).size === 3, o.join());
  o = await order('editor', 'desc');
  record('sort: editor descending, nobody still last', o.slice(0, 3).join() === 't2,t4,t3', o.join());
  o = await order('qc', 'asc');
  record('sort: QC reviewer, nobody last', new Set(o.slice(0, 2)).has('t2') && new Set(o.slice(0, 2)).has('t3') && new Set(o.slice(2)).size === 4, o.join());
  o = await order('title', 'asc');
  record('sort: title, case-insensitive', o.join() === 't6,t3,t4,t5,t1,t2', o.join());
  o = await order('created', 'asc');
  record('sort: oldest created first', o[0] === 't6', o.join());
  o = await order('created', 'desc');
  record('sort: newest created first', o[o.length - 1] === 't6', o.join());
  r = await search(editor, null, {}, 'updated', 'desc');
  record('sort: last updated', !r.error && r.rows.length === 6 && new Date(r.rows[0].updated_at) >= new Date(r.rows[5].updated_at));
  const m1 = await order('manual', 'asc');
  const m2 = await order('manual', 'asc');
  record('sort: manual order is the hierarchy order: space, folders before loose lists, list, then position', m1.join() === 't1,t2,t3,t4,t5,t6' && m1.join() === m2.join(), m1.join());
  r = await search(editor, null, {}, 'robert); drop table tasks;--', 'sideways');
  record('an unknown sort or direction falls back safely (nothing is spliced into SQL)', !r.error && r.rows.length === 6);

  // ---- paging ----------------------------------------------------------------------------------
  r = await search(editor, null, {}, 'title', 'asc', 2, 0);
  const p1 = named(r);
  const p2 = named(await search(editor, null, {}, 'title', 'asc', 2, 2));
  const p3 = named(await search(editor, null, {}, 'title', 'asc', 2, 4));
  record('paging: three pages of two, in order, no overlap', [...p1, ...p2, ...p3].join() === 't6,t3,t4,t5,t1,t2', [p1, p2, p3].join('|'));
  record('paging: every row carries the full match count', r.rows.every((x) => Number(x.total_count) === 6));
  r = await search(editor, null, {}, 'title', 'asc', 2, 6);
  record('paging: past the end is empty, not an error', !r.error && r.rows.length === 0);
  r = await search(editor, null, {}, 'title', 'asc', 0, -5);
  record('paging: a limit of 0 and a negative offset are clamped', !r.error && r.rows.length === 1);
  r = await search(editor, null, {}, 'title', 'asc', 999999, 0);
  record('paging: a huge limit is clamped to 1000', !r.error && r.rows.length === 6);

  // ---- what each row carries ---------------------------------------------------------------------
  await svc(`INSERT INTO public.subtasks (task_id, title, is_completed) VALUES ($1,'a',true), ($1,'b',false), ($1,'c',true)`, [ids.t2]);
  r = await search(editor, 'walmart long');
  const row = r.rows[0];
  record('rows carry assignees, revision count, subtask progress and the properties the views show',
    row?.editor_id === editor && row.qc_id === qc && row.subtask_total === 3 && row.subtask_done === 2 && row.revision_count === 0 &&
    row.status === 'STARTED_EDITING' && row.priority === 'URGENT' && row.aspect_ratio === '16:9' && row.list_id === lA, JSON.stringify(row));

  // ---- the index, and speed on a realistic amount of data ------------------------------------------
  await svc(`SET session_replication_role = replica`);
  await svc(`INSERT INTO public.lists (workspace_id, space_id, name) VALUES ($1, $2, 'PERF')`, [ws, spA]);
  const perfList = (await svc(`SELECT id FROM public.lists WHERE name = 'PERF' AND space_id = $1`, [spA]))[0].id;
  await svc(`INSERT INTO public.tasks (workspace_id, list_id, title, description, status, priority, position)
             SELECT $1, $2, 'perf video ' || g || CASE WHEN g % 2500 = 0 THEN ' zebrafish' ELSE '' END, 'brief number ' || g,
                    'TO_BE_EDITED', 'MEDIUM', g FROM generate_series(1, 40000) g`, [ws, perfList]);
  await svc(`SET session_replication_role = origin`);
  await svc(`ANALYZE public.tasks`);
  const plan = (await svc(`EXPLAIN SELECT id FROM public.tasks WHERE title ILIKE '%zebrafish%'`)).map((x) => x['QUERY PLAN']).join('\n');
  record('the trigram index is used for a title search on thousands of tasks', /idx_tasks_title_trgm/.test(plan), plan);
  const t0 = Date.now();
  r = await as(editor, `SELECT * FROM public.search_tasks($1, 'zebrafish', '{}'::jsonb)`, [ws]);
  const ms = Date.now() - t0;
  record('searching 40,000 tasks for a rare word finds exactly the right ones', !r.error && r.rows.length === 16 && Number(r.rows[0].total_count) === 16, r.error?.message ?? String(r.rows.length));
  console.log(`      (search over ${40000 + 7} tasks took ${ms} ms in the in-process test database)`);
  record('...quickly (well under a second even here)', ms < 3000, `${ms}ms`);
  r = await as(editor, `SELECT * FROM public.search_tasks($1, NULL, $2::jsonb, 'priority', 'asc', 500, 0)`, [ws, JSON.stringify({ lists: [perfList], priorities: ['MEDIUM'] })]);
  record('a filtered, sorted page of a big list returns exactly one page', !r.error && r.rows.length === 500 && Number(r.rows[0].total_count) === 40000, r.error?.message);
  await svc(`SET session_replication_role = replica`);
  await svc(`DELETE FROM public.tasks WHERE list_id = $1`, [perfList]);
  await svc(`SET session_replication_role = origin`);
  await svc(`DELETE FROM public.lists WHERE id = $1`, [perfList]);

  // ---- nothing the search did changed any data -----------------------------------------------------
  const after = await svc(`SELECT count(*)::int n FROM public.tasks WHERE list_id IN ($1,$2,$3)`, [lA, lB, lC]);
  record('searching changes nothing', after[0].n === 6);
}

console.log('\n== Phase 10: comments, attachments, activity and notifications ==');
{
  const editor2 = (await svc(`SELECT id FROM auth.users WHERE email = 'editor2@tbb.test'`))[0].id;
  const uuid = async () => (await svc(`SELECT gen_random_uuid() AS u`))[0].u;
  const n = async (sql, params = []) => Number((await svc(`SELECT count(*) AS n FROM (${sql}) x`, params))[0].n);
  const mention = (name, id) => `@[${name}](${id})`;
  const kinds = async (task) => (await svc(`SELECT kind FROM public.task_activity WHERE task_id = $1 ORDER BY created_at, id`, [task])).map((x) => x.kind);

  const ct = (await svc(`INSERT INTO public.tasks (list_id, title) VALUES ($1, 'P10 collaboration task') RETURNING id`, [list]))[0].id;
  // a task in the other workspace, to prove nothing crosses over
  const foreign = (await svc(`INSERT INTO public.tasks (workspace_id, list_id, title) VALUES ($1, $2, 'P10 foreign task') RETURNING id`, [wsB, listB]))[0].id;

  // ---- activity: real events only -------------------------------------------------------------------
  console.log('  -- activity');
  record('creating a task wrote one "created" entry', (await kinds(ct)).join() === 'created');
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2), ($1,'QC_REVIEWER',$3)`, [ct, editor, qc]);
  record('assigning an editor and a QC reviewer wrote two "assigned" entries', (await kinds(ct)).join() === 'created,assigned,assigned');
  r = await svc(`SELECT data FROM public.task_activity WHERE task_id = $1 AND kind = 'assigned' ORDER BY created_at, id`, [ct]);
  record('...saying who and in which role', r.some((x) => x.data.role_type === 'EDITOR' && x.data.user_id === editor) && r.some((x) => x.data.role_type === 'QC_REVIEWER' && x.data.user_id === qc));
  await svc(`UPDATE public.tasks SET position = 7 WHERE id = $1`, [ct]);
  record('a change nobody would call an edit (position) writes nothing', (await kinds(ct)).length === 3);
  await svc(`UPDATE public.tasks SET title = 'P10 collaboration task v2', priority = 'HIGH' WHERE id = $1`, [ct]);
  r = await svc(`SELECT data FROM public.task_activity WHERE task_id = $1 AND kind = 'updated'`, [ct]);
  const ch = r[0]?.data.changes ?? [];
  record('editing title and priority wrote ONE "updated" entry with both changes', r.length === 1 && ch.length === 2
    && ch.some((c) => c.field === 'title' && c.from === 'P10 collaboration task' && c.to === 'P10 collaboration task v2')
    && ch.some((c) => c.field === 'priority' && c.from === 'MEDIUM' && c.to === 'HIGH'));
  await svc(`UPDATE public.tasks SET description = 'a secret brief', review_link = 'https://app.frame.io/r/p10' WHERE id = $1`, [ct]);
  r = await svc(`SELECT data FROM public.task_activity WHERE task_id = $1 AND kind = 'updated' ORDER BY created_at DESC, id LIMIT 1`, [ct]);
  record('long text and links only record THAT they changed, never their content', JSON.stringify(r[0].data).indexOf('secret brief') === -1
    && JSON.stringify(r[0].data).indexOf('frame.io') === -1 && r[0].data.changes.every((c) => c.changed === true));
  await svc(`UPDATE public.tasks SET title = title WHERE id = $1`, [ct]);
  record('a save that changes nothing writes nothing', (await svc(`SELECT count(*)::int n FROM public.task_activity WHERE task_id = $1 AND kind = 'updated'`, [ct]))[0].n === 2);

  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['QC specialist', qc], ['editor', editor]]) {
    r = await as(who, `SELECT id FROM public.task_activity WHERE task_id = $1`, [ct]);
    record(`${name} can read the activity feed`, !r.error && r.rows.length >= 3);
  }
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `SELECT id FROM public.task_activity WHERE task_id = $1`, [ct]);
    record(`${name} sees no activity`, !r.error && r.rows.length === 0);
  }
  r = await as('anon', `SELECT id FROM public.task_activity`);
  record('anon cannot read activity', !!r.error);
  for (const [name, who] of [['owner', owner], ['production manager', pm], ['editor', editor]]) {
    r = await as(who, `INSERT INTO public.task_activity (task_id, workspace_id, kind) VALUES ($1, $2, 'created')`, [ct, ws]);
    record(`${name} cannot write a fake activity entry`, !!r.error);
  }
  r = await as(owner, `UPDATE public.task_activity SET kind = 'created' WHERE task_id = $1 RETURNING id`, [ct]);
  record('nobody can rewrite history (update)', !!r.error);
  r = await as(owner, `DELETE FROM public.task_activity WHERE task_id = $1 RETURNING id`, [ct]);
  record('nobody can erase history (delete)', !!r.error);
  r = await as(editor, `SELECT private.log_activity($1, $2, NULL, 'created', '{}'::jsonb)`, [ct, ws]);
  record('the activity writer is not callable from the API', !!r.error);

  // ---- notifications from the events above ----------------------------------------------------------
  console.log('  -- notifications from assignment and status');
  const nots = (user, kind) => svc(`SELECT * FROM public.notifications WHERE user_id = $1 AND task_id = $2 ${kind ? `AND kind = '${kind}'` : ''} ORDER BY created_at, id`, [user, ct]);
  r = await nots(editor, 'assigned');
  record('the assigned editor was notified once', r.length === 1 && r[0].read_at === null && r[0].data.role_type === 'EDITOR' && r[0].data.title === 'P10 collaboration task');
  r = await nots(qc, 'assigned');
  record('the assigned QC reviewer was notified once', r.length === 1 && r[0].data.role_type === 'QC_REVIEWER');
  record('nobody else was notified of the assignment', (await n(`SELECT 1 FROM public.notifications WHERE task_id = $1 AND kind = 'assigned'`, [ct])) === 2);
  await svc(`UPDATE public.tasks SET status = 'ASSIGNED' WHERE id = $1`, [ct]);
  record('a move with no actor (service role) notifies both people working on the task', (await nots(editor, 'status')).length === 1 && (await nots(qc, 'status')).length === 1);
  r = await as(editor, `SELECT (public.transition_task($1, 'STARTED_EDITING')).status AS status`, [ct]);
  ok('the editor starts editing', r);
  r = await nots(qc, 'status');
  record('the QC reviewer is told the stage changed, and by whom', r.length === 2 && r[1].data.from === 'ASSIGNED' && r[1].data.to === 'STARTED_EDITING' && r[1].actor_id === editor);
  record('the person who made the move is not notified of their own action', (await nots(editor, 'status')).length === 1);
  await svc(`UPDATE public.tasks SET status = 'STARTED_EDITING' WHERE id = $1`, [ct]);
  record('re-saving the same stage creates no notification', (await nots(editor, 'status')).length === 1 && (await nots(qc, 'status')).length === 2);
  record('a stage move writes nothing into the activity feed (task_status_events is that history)',
    (await svc(`SELECT count(*)::int n FROM public.task_activity WHERE task_id = $1 AND kind = 'updated'`, [ct]))[0].n === 2);

  // ---- comments -------------------------------------------------------------------------------------
  console.log('  -- comments');
  const post = (who, body, extra = '') => as(who, `INSERT INTO public.task_comments (task_id, workspace_id, author_id, body) VALUES ($1, $2, $3, $4) RETURNING *${extra}`, [ct, ws, who, body]);
  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['QC specialist', qc], ['editor', editor], ['unassigned editor', editor2]]) {
    r = await post(who, `hello from ${name}`);
    record(`${name} can comment`, !r.error && r.rows[0]?.author_id === who && r.rows[0]?.workspace_id === ws, r.error?.message);
  }
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    r = await post(who, 'let me in');
    record(`${name} cannot comment`, !!r.error);
    r = await as(who, `SELECT id FROM public.task_comments`);
    record(`${name} cannot read comments`, !r.error && r.rows.length === 0);
  }
  r = await as('anon', `INSERT INTO public.task_comments (task_id, workspace_id, author_id, body) VALUES ($1,$2,$3,'x')`, [ct, ws, owner]);
  record('anon cannot comment', !!r.error);
  r = await as('anon', `SELECT id FROM public.task_comments`);
  record('anon cannot read comments', !!r.error);
  r = await as(editor, `INSERT INTO public.task_comments (task_id, workspace_id, author_id, body) VALUES ($1,$2,$3,'forged') RETURNING author_id`, [ct, ws, owner]);
  record('a forged author is replaced by the signed-in person', !r.error && r.rows[0]?.author_id === editor, r.error?.message);
  r = await as(editor, `INSERT INTO public.task_comments (task_id, workspace_id, author_id, body) VALUES ($1,$2,$3,'wrong workspace') RETURNING workspace_id`, [ct, wsB, editor]);
  record('a forged workspace is replaced by the task\'s own', !r.error && r.rows[0]?.workspace_id === ws, r.error?.message);
  r = await as(editor, `INSERT INTO public.task_comments (task_id, author_id, body) VALUES ($1,$2,'x')`, [foreign, editor]);
  record("cannot comment on another workspace's task", !!r.error);
  r = await post(editor, '   ');
  record('an empty comment is refused', !!r.error);
  r = await post(editor, 'x'.repeat(10001));
  record('a comment over 10,000 characters is refused', !!r.error);
  r = await post(editor, 'x'.repeat(10000));
  record('...exactly 10,000 is fine', !r.error);
  r = await as(editor, `SELECT id FROM public.task_comments WHERE task_id = $1`, [ct]);
  record('staff see every comment on the task', !r.error && r.rows.length >= 6);
  r = await as(editor, `SELECT id FROM public.task_comments WHERE task_id = $1`, [foreign]);
  record("staff do not see another workspace's comments", !r.error && r.rows.length === 0);

  // mentions: only verified staff of this workspace
  console.log('  -- mentions');
  const text = `Hi ${mention('Quentin Quill', qc)}, ${mention('Client', client)}, ${mention('Nobody', await uuid())}, ${mention('Outsider', stranger)}, ${mention('Again', qc)} and ${mention('Ada', admin)}`;
  r = await post(editor, text);
  const mentionsC = r.rows[0];
  record('only active staff of this workspace become mentions (deduplicated)', !r.error && mentionsC.mentions.length === 2
    && mentionsC.mentions.includes(qc) && mentionsC.mentions.includes(admin), JSON.stringify(mentionsC?.mentions));
  r = await as(editor, `INSERT INTO public.task_comments (task_id, author_id, body, mentions) VALUES ($1,$2,'plain', ARRAY[$3::uuid]) RETURNING mentions`, [ct, editor, owner]);
  record('a client-supplied mentions list is ignored', !r.error && r.rows[0].mentions.length === 0, r.error?.message);
  r = await post(editor, `${mention('Evil', editor2)} ]( @[x](zzz) @[](${owner}) not a token`);
  record('a malformed token mentions nobody', !r.error && r.rows[0].mentions.length === 1 && r.rows[0].mentions[0] === editor2);
  await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [editor2]);
  r = await post(editor, mention('Sleeper', editor2));
  record('a deactivated account cannot be mentioned', !r.error && r.rows[0].mentions.length === 0);
  await svc(`UPDATE public.profiles SET is_active = true WHERE id = $1`, [editor2]);

  // mention notifications
  const mentionNots = (user) => nots(user, 'mention');
  r = await mentionNots(qc);
  record('the mentioned QC specialist got exactly one mention notification for that comment',
    r.filter((x) => x.data.comment_id === mentionsC.id).length === 1);
  record('...with the comment text (mention tokens made readable) and the task title', (() => {
    const x = r.find((y) => y.data.comment_id === mentionsC.id);
    return x && x.data.snippet.startsWith('Hi @Quentin Quill, @Client') && x.data.title === 'P10 collaboration task v2' && x.actor_id === editor;
  })());
  record('the mentioned admin got one too', (await mentionNots(admin)).filter((x) => x.data.comment_id === mentionsC.id).length === 1);
  record('the client viewer was NOT notified', (await svc(`SELECT 1 FROM public.notifications WHERE user_id = $1`, [client])).length === 0);
  record('the outsider was NOT notified', (await svc(`SELECT 1 FROM public.notifications WHERE user_id = $1`, [stranger])).length === 0);
  record('the author is never notified of their own comment', (await mentionNots(editor)).length === 0);
  record('the QC reviewer, mentioned, did not ALSO get a plain "comment" notification for it',
    (await nots(qc, 'comment')).filter((x) => x.data.comment_id === mentionsC.id).length === 0);
  r = await post(pm, 'A question from the production manager');
  const pmComment = r.rows[0];
  record('a comment by someone else notifies the editor and the QC reviewer who work on the task',
    (await nots(editor, 'comment')).some((x) => x.data.comment_id === pmComment.id)
    && (await nots(qc, 'comment')).some((x) => x.data.comment_id === pmComment.id));
  record('...and nobody who does not (admin, owner, the other editor)',
    (await n(`SELECT 1 FROM public.notifications WHERE kind = 'comment' AND data ->> 'comment_id' = $1 AND user_id NOT IN ($2, $3)`, [pmComment.id, editor, qc])) === 0);
  // editing: a new mention notifies once; re-saving never repeats
  r = await as(editor, `UPDATE public.task_comments SET body = body || ' ' || $2 WHERE id = $1 RETURNING mentions, edited_at, updated_at, created_at`, [mentionsC.id, mention('Pat', pm)]);
  record('editing a comment recomputes its mentions and stamps edited_at', !r.error && r.rows[0].mentions.length === 3 && r.rows[0].mentions.includes(pm) && r.rows[0].edited_at !== null, r.error?.message);
  record('...the newly mentioned person is notified once', (await mentionNots(pm)).filter((x) => x.data.comment_id === mentionsC.id).length === 1);
  await as(editor, `UPDATE public.task_comments SET body = body || ' (typo)' WHERE id = $1`, [mentionsC.id]);
  record('...editing again does not notify anyone a second time',
    (await mentionNots(pm)).filter((x) => x.data.comment_id === mentionsC.id).length === 1
    && (await mentionNots(qc)).filter((x) => x.data.comment_id === mentionsC.id).length === 1);
  r = await as(editor, `UPDATE public.task_comments SET body = $2 WHERE id = $1 RETURNING mentions`, [mentionsC.id, 'no mentions any more']);
  record('removing a mention removes it from the comment', !r.error && r.rows[0].mentions.length === 0);

  // editing and deleting: author only (+ admin delete)
  console.log('  -- editing and deleting comments');
  r = await as(editor, `INSERT INTO public.task_comments (task_id, author_id, body) VALUES ($1,$2,'mine') RETURNING id, created_at`, [ct, editor]);
  const mine = r.rows[0];
  r = await as(editor, `UPDATE public.task_comments SET body = 'mine, edited' WHERE id = $1 RETURNING body, edited_at`, [mine.id]);
  record('the author edits their own comment', !r.error && r.rows[0]?.body === 'mine, edited' && r.rows[0].edited_at !== null);
  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['another editor', editor2], ['QC specialist', qc]]) {
    r = await as(who, `UPDATE public.task_comments SET body = 'hijack' WHERE id = $1 RETURNING id`, [mine.id]);
    blocked(`${name} cannot edit someone else's comment`, r);
  }
  for (const col of ['author_id', 'task_id', 'workspace_id', 'created_at', 'edited_at', 'mentions']) {
    const val = { author_id: `'${owner}'`, task_id: `'${foreign}'`, workspace_id: `'${wsB}'`, created_at: 'now()', edited_at: 'now()', mentions: `ARRAY['${owner}']::uuid[]` }[col];
    r = await as(editor, `UPDATE public.task_comments SET ${col} = ${val} WHERE id = $1 RETURNING id`, [mine.id]);
    record(`the author cannot change ${col}`, !!r.error);
  }
  r = await svc(`SELECT body FROM public.task_comments WHERE id = $1`, [mine.id]);
  record('...and the text is still the author\'s', r[0].body === 'mine, edited');
  r = await as(client, `UPDATE public.task_comments SET body = 'x' WHERE id = $1 RETURNING id`, [mine.id]);
  record('a client viewer cannot edit', !!r.error || r.rows.length === 0);
  for (const [name, who] of [['production manager', pm], ['another editor', editor2], ['QC specialist', qc], ['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `DELETE FROM public.task_comments WHERE id = $1 RETURNING id`, [mine.id]);
    blocked(`${name} cannot delete someone else's comment`, r);
  }
  r = await as(admin, `DELETE FROM public.task_comments WHERE id = $1 RETURNING id`, [mine.id]);
  record('an admin can delete a comment (moderation)', !r.error && r.rows.length === 1);
  r = await as(editor, `INSERT INTO public.task_comments (task_id, author_id, body) VALUES ($1,$2,'to delete') RETURNING id`, [ct, editor]);
  r = await as(editor, `DELETE FROM public.task_comments WHERE id = $1 RETURNING id`, [r.rows[0].id]);
  record('the author deletes their own comment', !r.error && r.rows.length === 1);
  record('comment activity: one "commented" per comment posted (and none for edits)',
    (await n(`SELECT 1 FROM public.task_activity WHERE task_id = $1 AND kind = 'commented'`, [ct])) === (await n(`SELECT 1 FROM public.task_comments WHERE task_id = $1`, [ct])) + 2);
  r = await as(editor, `INSERT INTO public.task_comments (task_id, author_id, body) SELECT id, $1, 'bulk' FROM public.tasks WHERE id = $2 RETURNING id`, [editor, ct]);
  ok('(an INSERT … SELECT comment is guarded the same way)', r);

  // ---- notification access -------------------------------------------------------------------------
  console.log('  -- reading and clearing notifications');
  r = await as(qc, `SELECT id, user_id FROM public.notifications`);
  record('a person reads only their own notifications', !r.error && r.rows.length > 0 && r.rows.every((x) => x.user_id === qc));
  r = await as(qc, `SELECT id FROM public.notifications WHERE user_id = $1`, [editor]);
  record("...and cannot read a colleague's even by asking for them", !r.error && r.rows.length === 0);
  r = await as(owner, `SELECT id FROM public.notifications WHERE user_id = $1`, [editor]);
  record('...not even an owner can', !r.error && r.rows.length === 0);
  r = await as('anon', `SELECT id FROM public.notifications`);
  record('anon cannot read notifications', !!r.error);
  r = await as(qc, `INSERT INTO public.notifications (user_id, workspace_id, task_id, kind, dedupe_key) VALUES ($1,$2,$3,'mention','forged')`, [editor, ws, ct]);
  record('nobody can create a notification through the API', !!r.error);
  r = await as(qc, `DELETE FROM public.notifications WHERE user_id = $1 RETURNING id`, [qc]);
  record('...or delete one', !!r.error);
  const qcNot = (await nots(qc, 'status'))[0];
  for (const [col, val] of [['kind', `'mention'`], ['user_id', `'${editor}'`], ['task_id', `'${foreign}'`], ['data', `'{}'::jsonb`], ['dedupe_key', `'x'`], ['created_at', 'now()'], ['actor_id', 'NULL']]) {
    r = await as(qc, `UPDATE public.notifications SET ${col} = ${val} WHERE id = $1 RETURNING id`, [qcNot.id]);
    record(`the recipient cannot change ${col} of a notification`, !!r.error);
  }
  r = await as(editor, `UPDATE public.notifications SET read_at = now() WHERE id = $1 RETURNING id`, [qcNot.id]);
  record("a colleague cannot mark someone else's notification read", !r.error && r.rows.length === 0);
  r = await as(qc, `UPDATE public.notifications SET read_at = '2001-01-01' WHERE id = $1 RETURNING read_at`, [qcNot.id]);
  record('the recipient marks it read; the time is the server\'s, not a forged one', !r.error && new Date(r.rows[0].read_at).getFullYear() >= 2026, r.error?.message ?? String(r.rows[0]?.read_at));
  const firstRead = r.rows[0]?.read_at;
  r = await as(qc, `UPDATE public.notifications SET read_at = now() + interval '1 day' WHERE id = $1 RETURNING read_at`, [qcNot.id]);
  record('...reading it again keeps the first read time', !r.error && +new Date(r.rows[0].read_at) === +new Date(firstRead));
  r = await as(qc, `UPDATE public.notifications SET read_at = NULL WHERE id = $1 RETURNING read_at`, [qcNot.id]);
  record('...and it can be marked unread again', !r.error && r.rows[0].read_at === null);
  r = await as(qc, `UPDATE public.notifications SET read_at = now() WHERE read_at IS NULL RETURNING id`);
  record('mark-all-read touches only the recipient\'s own rows', !r.error && r.rows.length > 0
    && (await svc(`SELECT count(*)::int n FROM public.notifications WHERE user_id <> $1 AND read_at IS NOT NULL`, [qc]))[0].n === 0);
  record('...and leaves nothing unread for them', (await svc(`SELECT count(*)::int n FROM public.notifications WHERE user_id = $1 AND read_at IS NULL`, [qc]))[0].n === 0);

  // the writer itself: who can be notified, and only once
  console.log('  -- who can be notified');
  const notify = (user, key) => svc(`SELECT private.notify($1, $2, $3, NULL, 'mention', $4, '{}'::jsonb)`, [user, ws, ct, key]);
  const countFor = (user, key) => n(`SELECT 1 FROM public.notifications WHERE user_id = $1 AND dedupe_key = $2`, [user, key]);
  await notify(client, 'k-client');
  record('a client viewer cannot be notified about a task (no task access)', (await countFor(client, 'k-client')) === 0);
  await notify(stranger, 'k-stranger');
  record('someone outside the workspace cannot be notified', (await countFor(stranger, 'k-stranger')) === 0);
  await svc(`UPDATE public.profiles SET is_active = false WHERE id = $1`, [editor2]);
  await notify(editor2, 'k-inactive');
  record('a deactivated account cannot be notified', (await countFor(editor2, 'k-inactive')) === 0);
  await svc(`UPDATE public.profiles SET is_active = true WHERE id = $1`, [editor2]);
  r = await svc(`SELECT private.notify($1, $2, $3, NULL, 'mention', 'k-cross', '{}'::jsonb)`, [editor2, ws, foreign]);
  record("a task from another workspace cannot be used to notify (task must belong to the workspace)", (await countFor(editor2, 'k-cross')) === 0);
  await notify(editor2, 'k-once');
  await notify(editor2, 'k-once');
  record('the same event notifies a person exactly once (dedupe key)', (await countFor(editor2, 'k-once')) === 1);
  r = await svc(`SELECT private.notify($1, $2, $3, $1, 'mention', 'k-self', '{}'::jsonb)`, [editor2, ws, ct]);
  record('nobody is notified of their own action', (await countFor(editor2, 'k-self')) === 0);
  r = await svc(`INSERT INTO public.notifications (user_id, workspace_id, task_id, kind, dedupe_key) VALUES ($1,$2,$3,'mention','k-once') RETURNING id`, [editor2, ws, ct]).catch((e) => ({ error: e }));
  record('the database itself refuses a duplicate (UNIQUE user + dedupe key)', !!r.error);
  r = await svc(`INSERT INTO public.notifications (user_id, workspace_id, task_id, kind, dedupe_key) VALUES ($1,$2,$3,'sms','k-bad') RETURNING id`, [editor2, ws, ct]).catch((e) => ({ error: e }));
  record('only the known kinds exist', !!r.error);
  // access is re-checked when reading: leaving the workspace hides what you were sent
  const leaver = await mkUser('leaver@tbb.test');
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR')`, [ws, leaver]);
  await svc(`SELECT private.notify($1, $2, $3, NULL, 'mention', 'k-leaver', '{}'::jsonb)`, [leaver, ws, ct]);
  record('a member receives a notification', (await as(leaver, `SELECT id FROM public.notifications`)).rows.length === 1);
  await svc(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, leaver]);
  record('...after leaving the workspace they can no longer read it (RLS re-checks membership)', (await as(leaver, `SELECT id FROM public.notifications`)).rows.length === 0);

  // ---- attachments and storage ------------------------------------------------------------------
  console.log('  -- attachments and storage');
  const bucket = (await svc(`SELECT * FROM storage.buckets WHERE id = 'task-attachments'`))[0];
  record('the bucket exists and is PRIVATE', !!bucket && bucket.public === false);
  record('...limited to 25 MB per file', Number(bucket?.file_size_limit) === 26214400);
  record('...and to an explicit list of file types (no HTML, SVG, scripts or executables)', Array.isArray(bucket?.allowed_mime_types)
    && bucket.allowed_mime_types.includes('application/pdf')
    && !['text/html', 'image/svg+xml', 'application/javascript', 'application/x-msdownload', 'application/octet-stream'].some((m) => bucket.allowed_mime_types.includes(m)));

  const pathFor = async (task = ct, wsId = ws, file = 'cut-notes.pdf') => {
    const a = await uuid();
    return { att: a, path: `${wsId}/${task}/${a}/${file}` };
  };
  const upload = (who, path, meta = { size: 2048, mimetype: 'application/pdf' }, bucketId = 'task-attachments') =>
    as(who, `INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ($1, $2, $3::jsonb) RETURNING id, owner_id`, [bucketId, path, JSON.stringify(meta)]);
  const addRow = (who, p, o = {}) =>
    as(who, `INSERT INTO public.task_attachments (id, task_id, file_name, storage_path, mime_type, size_bytes, uploaded_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [p.att, o.task ?? ct, o.name ?? 'cut-notes.pdf', p.path, o.mime ?? 'application/pdf', o.size ?? 2048, o.by ?? who]);

  // who may upload (storage policy)
  let p = await pathFor();
  r = await upload(editor, p.path);
  record('an editor assigned to the task can upload into its folder', !r.error && r.rows[0].owner_id === editor, r.error?.message);
  const mainPath = p;
  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['QC specialist', qc]]) {
    p = await pathFor();
    r = await upload(who, p.path);
    record(`${name} can upload to any task`, !r.error, r.error?.message);
  }
  p = await pathFor();
  r = await upload(editor2, p.path);
  record('an editor NOT assigned to the task cannot upload to it', !!r.error);
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    p = await pathFor();
    r = await upload(who, p.path);
    record(`${name} cannot upload`, !!r.error);
  }
  r = await as('anon', `INSERT INTO storage.objects (bucket_id, name, metadata) VALUES ('task-attachments', $1, '{}'::jsonb)`, [(await pathFor()).path]);
  record('anon cannot upload', !!r.error);
  p = await pathFor(foreign, wsB);
  r = await upload(editor, p.path);
  record("cannot upload into another workspace's task folder", !!r.error);
  p = await pathFor(foreign, ws);
  r = await upload(editor, p.path);
  record("cannot claim this workspace's folder for another workspace's task", !!r.error);
  p = await pathFor(ct, wsB);
  r = await upload(editor, p.path);
  record("cannot claim another workspace's folder for this workspace's task", !!r.error);
  const a1 = await uuid();
  for (const [label, bad] of [
    ['a path with no file name', `${ws}/${ct}/${a1}`],
    ['a path with only two levels', `${ws}/${ct}/file.pdf`],
    ['a path with a traversal segment', `${ws}/${ct}/${a1}/../x.pdf`],
    ['an upper-case id', `${ws.toUpperCase()}/${ct}/${a1}/f.pdf`],
    ['a file name with a space', `${ws}/${ct}/${a1}/a b.pdf`],
    ['a nested file name', `${ws}/${ct}/${a1}/sub/f.pdf`],
    ['a path starting with a slash', `/${ws}/${ct}/${a1}/f.pdf`],
    ['a path outside the structure', `loose/${a1}.pdf`],
  ]) {
    r = await upload(pm, bad);
    record(`${label} is refused`, !!r.error);
  }
  await svc(`INSERT INTO storage.buckets (id, name) VALUES ('some-other-bucket', 'some-other-bucket')`);
  p = await pathFor();
  r = await upload(pm, p.path, { size: 10, mimetype: 'application/pdf' }, 'some-other-bucket');
  record('the policies only cover the task-attachments bucket (a task-shaped path in another bucket gets nothing)', !!r.error);
  p = await pathFor();
  r = await upload(pm, p.path);
  r = await upload(pm, p.path);
  record('the same path cannot be uploaded twice (no overwrite)', !!r.error);

  // the metadata row
  r = await addRow(editor, mainPath, { size: 1, mime: 'application/zip' });
  const row1 = r.rows[0];
  record('the uploader records the attachment', !r.error && !!row1, r.error?.message);
  record('...size and type are what Storage stored, not what the client claimed', Number(row1?.size_bytes) === 2048 && row1.mime_type === 'application/pdf', JSON.stringify([row1?.size_bytes, row1?.mime_type]));
  record('...workspace and uploader are derived', row1?.workspace_id === ws && row1?.uploaded_by === editor);
  p = await pathFor();
  await upload(pm, p.path);
  r = await addRow(pm, p, { by: owner });
  record('a forged uploaded_by is replaced by the signed-in person', !r.error && r.rows[0].uploaded_by === pm, r.error?.message);
  const pmRow = r.rows[0];
  p = await pathFor();
  r = await addRow(pm, p);
  record('a row cannot be created for a file that was never uploaded', !!r.error);
  p = await pathFor();
  await upload(pm, p.path);
  r = await addRow(pm, { att: await uuid(), path: p.path });
  record('the row id must match the id in the path', !!r.error);
  p = await pathFor();
  await upload(pm, p.path);
  r = await addRow(pm, p, { task: foreign });
  record('a row cannot point a stored file at a different task', !!r.error);
  p = await pathFor();
  await upload(pm, p.path, { size: 1024, mimetype: 'text/html' });
  r = await addRow(pm, p);
  record('a stored file of a forbidden type (HTML) cannot be recorded, whatever the client says', !!r.error);
  p = await pathFor();
  await upload(pm, p.path, { size: 26214401, mimetype: 'application/pdf' });
  r = await addRow(pm, p);
  record('a stored file over 25 MB cannot be recorded', !!r.error);
  p = await pathFor();
  await upload(pm, p.path, { size: 0, mimetype: 'application/pdf' });
  r = await addRow(pm, p);
  record('an empty file cannot be recorded', !!r.error);
  p = await pathFor();
  await upload(pm, p.path);
  for (const bad of ['a/b.pdf', 'a\\b.pdf', 'tab\there.pdf', '', 'x'.repeat(181)]) {
    r = await addRow(pm, p, { name: bad });
    record(`a file name like ${JSON.stringify(bad.length > 20 ? bad.slice(0, 8) + '…' : bad)} is refused`, !!r.error);
  }
  r = await addRow(pm, p, { name: 'Résumé of the cut — v2.pdf' });
  record('a normal name with spaces and accents is fine (display name only; the stored name is safe)', !r.error, r.error?.message);
  const row3 = r.rows[0];
  p = await pathFor();
  await upload(editor2, p.path).catch(() => undefined);
  r = await addRow(editor2, p);
  record('an editor not assigned cannot add a row', !!r.error);
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    r = await addRow(who, p);
    record(`${name} cannot add a row`, !!r.error);
  }
  r = await as('anon', `INSERT INTO public.task_attachments (task_id, file_name, storage_path, mime_type, size_bytes) VALUES ($1,'a.pdf','x','application/pdf',1)`, [ct]);
  record('anon cannot add a row', !!r.error);
  r = await as(editor, `UPDATE public.task_attachments SET file_name = 'renamed.pdf' WHERE id = $1 RETURNING id`, [row1.id]);
  record('an attachment record cannot be edited, even by its uploader', !!r.error);
  r = await as(owner, `UPDATE public.task_attachments SET storage_path = 'x' WHERE id = $1 RETURNING id`, [row1.id]);
  record('...or repointed by an owner', !!r.error);
  record('attachment activity: "attachment_added" for each recorded file', (await n(`SELECT 1 FROM public.task_activity WHERE task_id = $1 AND kind = 'attachment_added'`, [ct])) === (await n(`SELECT 1 FROM public.task_attachments WHERE task_id = $1`, [ct])));
  record('...naming the file', (await svc(`SELECT data FROM public.task_activity WHERE kind = 'attachment_added' AND data ->> 'attachment_id' = $1`, [row1.id]))[0]?.data.file_name === 'cut-notes.pdf');

  // reading
  for (const [name, who] of [['owner', owner], ['admin', admin], ['production manager', pm], ['QC specialist', qc], ['editor', editor], ['unassigned editor', editor2]]) {
    r = await as(who, `SELECT id FROM public.task_attachments WHERE id = $1`, [row1.id]);
    const o = await as(who, `SELECT id FROM storage.objects WHERE name = $1`, [mainPath.path]);
    record(`${name} can list the attachment and open the stored file`, !r.error && r.rows.length === 1 && o.rows.length === 1);
  }
  for (const [name, who] of [['client viewer', client], ['outsider', stranger]]) {
    r = await as(who, `SELECT id FROM public.task_attachments`);
    const o = await as(who, `SELECT id FROM storage.objects WHERE bucket_id = 'task-attachments'`);
    record(`${name} sees no attachment and cannot open any file`, !r.error && r.rows.length === 0 && !o.error && o.rows.length === 0);
  }
  r = await as('anon', `SELECT id FROM storage.objects`);
  record('anon cannot read any stored object', !!r.error || r.rows.length === 0);
  // an uploaded file with no record is not a leak
  p = await pathFor();
  await upload(editor, p.path);
  r = await as(editor2, `SELECT id FROM storage.objects WHERE name = $1`, [p.path]);
  record('a file that was uploaded but never recorded is invisible to other staff', !r.error && r.rows.length === 0);
  r = await as(editor, `SELECT id FROM storage.objects WHERE name = $1`, [p.path]);
  record('...but its uploader can still see it (to finish or clean up)', !r.error && r.rows.length === 1);
  r = await as(pm, `SELECT id FROM storage.objects WHERE name = $1`, [p.path]);
  record('...and so can a manager', !r.error && r.rows.length === 1);
  await as(editor, `DELETE FROM storage.objects WHERE name = $1`, [p.path]);
  record('the abandoned upload is cleaned up by its uploader', (await n(`SELECT 1 FROM storage.objects WHERE name = $1`, [p.path])) === 0);

  // an assigned editor who is un-assigned loses the right to add more
  await svc(`DELETE FROM public.task_assignees WHERE task_id = $1 AND role_type = 'EDITOR'`, [ct]);
  p = await pathFor();
  r = await upload(editor, p.path);
  record('an editor who is no longer assigned can no longer upload', !!r.error);
  record('...un-assigning wrote an "unassigned" entry', (await kinds(ct)).includes('unassigned'));
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [ct, editor]);
  record('...and re-assigning the same person is a NEW notification, not a duplicate', (await nots(editor, 'assigned')).length === 2);

  // deleting
  for (const [name, who] of [['an unassigned editor', editor2], ['the QC specialist', qc], ['a client viewer', client], ['an outsider', stranger]]) {
    r = await as(who, `DELETE FROM public.task_attachments WHERE id = $1 RETURNING id`, [row1.id]);
    const o = await as(who, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [mainPath.path]);
    record(`${name} cannot delete someone else's attachment (record or file)`, (!!r.error || r.rows.length === 0) && (!!o.error || o.rows.length === 0));
  }
  record('...both are still there', (await n(`SELECT 1 FROM public.task_attachments WHERE id = $1`, [row1.id])) === 1 && (await n(`SELECT 1 FROM storage.objects WHERE name = $1`, [mainPath.path])) === 1);
  r = await as(editor, `DELETE FROM public.task_attachments WHERE id = $1 RETURNING id`, [row1.id]);
  const o1 = await as(editor, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [mainPath.path]);
  record('the uploader deletes their own attachment (record and file)', !r.error && r.rows.length === 1 && !o1.error && o1.rows.length === 1);
  record('...deleting wrote an "attachment_removed" entry', (await n(`SELECT 1 FROM public.task_activity WHERE task_id = $1 AND kind = 'attachment_removed' AND data ->> 'file_name' = 'cut-notes.pdf'`, [ct])) === 1);
  r = await as(admin, `DELETE FROM public.task_attachments WHERE id = $1 RETURNING id`, [pmRow.id]);
  const o2 = await as(admin, `DELETE FROM storage.objects WHERE name = $1 RETURNING id`, [pmRow.storage_path]);
  record('a manager can delete anyone\'s attachment', !r.error && r.rows.length === 1 && !o2.error && o2.rows.length === 1);
  r = await as(pm, `UPDATE storage.objects SET name = 'x' WHERE name = $1 RETURNING id`, [row3.storage_path]);
  record('a stored file cannot be replaced or renamed through the API (no UPDATE policy or grant)', !!r.error || r.rows.length === 0);

  // ---- cascades: removing a task removes all of it, without error ---------------------------------
  console.log('  -- cascades');
  const ct2 = (await svc(`INSERT INTO public.tasks (list_id, title) VALUES ($1, 'P10 doomed task') RETURNING id`, [list]))[0].id;
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2), ($1,'QC_REVIEWER',$3)`, [ct2, editor, qc]);
  r = await as(pm, `INSERT INTO public.task_comments (task_id, author_id, body) VALUES ($1,$2,$3) RETURNING id`, [ct2, pm, `hi ${mention('Q', qc)}`]);
  const doomedPath = `${ws}/${ct2}/${await uuid()}/doomed.pdf`;
  await upload(pm, doomedPath);
  await as(pm, `INSERT INTO public.task_attachments (id, task_id, file_name, storage_path, mime_type, size_bytes) VALUES ($1,$2,'doomed.pdf',$3,'application/pdf',1)`, [doomedPath.split('/')[2], ct2, doomedPath]);
  const before = {
    activity: await n(`SELECT 1 FROM public.task_activity WHERE task_id = $1`, [ct2]),
    notes: await n(`SELECT 1 FROM public.notifications WHERE task_id = $1`, [ct2]),
  };
  record('(the doomed task has comments, an attachment, activity and notifications)', before.activity >= 5 && before.notes >= 3, JSON.stringify(before));
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [ct2]);
  record('deleting a task with all of that succeeds (the audit triggers do not trip on the cascade)', !r.error && r.rows.length === 1, r.error?.message);
  record('...its comments, attachment records, activity and notifications went with it',
    (await n(`SELECT 1 FROM public.task_comments WHERE task_id = $1`, [ct2])) === 0
    && (await n(`SELECT 1 FROM public.task_attachments WHERE task_id = $1`, [ct2])) === 0
    && (await n(`SELECT 1 FROM public.task_activity WHERE task_id = $1`, [ct2])) === 0
    && (await n(`SELECT 1 FROM public.notifications WHERE task_id = $1`, [ct2])) === 0);
  // a removed account: its comments stay, as a former member's
  const gone = await mkUser('gone@tbb.test');
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR')`, [ws, gone]);
  r = await as(gone, `INSERT INTO public.task_comments (task_id, author_id, body) VALUES ($1,$2,'I was here') RETURNING id`, [ct, gone]);
  const goneComment = r.rows[0].id;
  await svc(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [ws, gone]);
  await svc(`DELETE FROM auth.users WHERE id = $1`, [gone]);
  r = await svc(`SELECT author_id, body FROM public.task_comments WHERE id = $1`, [goneComment]);
  record("deleting a person's account keeps their comments (author becomes unknown) instead of erasing the conversation", r.length === 1 && r[0].author_id === null);

  // ---- exposure: nothing here is callable or writable by the wrong people --------------------------
  console.log('  -- exposure');
  r = await svc(`SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'private') AND p.proname IN ('log_activity','notify','log_task_activity','log_assignee_activity','log_comment_activity',
      'log_attachment_activity','notify_status_change','guard_notification','guard_task_comment','guard_task_attachment')
      AND (has_function_privilege('authenticated', p.oid, 'EXECUTE') OR has_function_privilege('anon', p.oid, 'EXECUTE'))`);
  record('none of the audit / notification / guard functions can be called by signed-in users or anon', r.length === 0, r.map((x) => x.proname).join());
  r = await svc(`SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('task_comments','task_attachments','task_activity','notifications') AND grantee = 'anon'`);
  record('anon has no privileges on any of the four new tables', r.length === 0);
  r = await svc(`SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND table_name IN ('task_comments','task_attachments','task_activity','notifications') AND grantee = 'authenticated'
      AND privilege_type IN ('TRUNCATE','REFERENCES','TRIGGER')`);
  record('signed-in users have no TRUNCATE / REFERENCES / TRIGGER on them', r.length === 0);
  r = await svc(`SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND relname IN ('task_comments','task_attachments','task_activity','notifications') AND NOT relrowsecurity`);
  record('row level security is on for all four', r.length === 0);
  r = await svc(`SELECT policyname FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname LIKE 'task_attachments_%' ORDER BY 1`);
  record('the bucket has exactly its read, upload and delete policies', r.map((x) => x.policyname).join() === 'task_attachments_delete,task_attachments_read,task_attachments_upload', r.map((x) => x.policyname).join());
  r = await svc(`SELECT cmd, roles FROM pg_policies WHERE tablename = 'objects' AND schemaname = 'storage' AND policyname LIKE 'task_attachments_%'`);
  record('...all of them for signed-in users only (none for anon)', r.every((x) => String(x.roles).includes('authenticated') && !String(x.roles).includes('anon')));
  r = await svc(`SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('task_comments','task_attachments','task_activity','notifications')
    AND (qual ~ 'auth\\.uid\\(\\)' OR with_check ~ 'auth\\.uid\\(\\)') AND NOT (coalesce(qual,'') ~ 'SELECT auth\\.uid\\(\\)' OR coalesce(with_check,'') ~ 'SELECT auth\\.uid\\(\\)')`);
  record('the new policies evaluate auth.uid() once per query (initplan form)', r.length === 0);
  r = await svc(`SELECT pg_get_indexdef(indexrelid) AS d FROM pg_index WHERE indrelid = 'public.notifications'::regclass`);
  record('the bell is indexed (newest first per person, and unread)', r.some((x) => /user_id, created_at DESC/.test(x.d)) && r.some((x) => /WHERE \(read_at IS NULL\)/.test(x.d)));
  r = await svc(`SELECT count(*)::int AS n FROM pg_publication`);
  record('(no realtime publication in a plain Postgres: the migration skipped it without failing)', r[0].n === 0);

  // leave one of each behind on a live task, so the workspace-deletion check at the end has something to cascade
  p = await pathFor();
  await upload(pm, p.path);
  await addRow(pm, p, { name: 'left-behind.pdf' });
}

console.log('\n== Phase 11: Home, Inbox and My Tasks ==');
{
  // fresh people, so earlier sections' assignments do not blur the personal counts
  const ed3 = await mkUser('ed3@tbb.test', {}, true);
  const qc3 = await mkUser('qc3@tbb.test', {}, true);
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'QC_SPECIALIST')`, [ws, ed3, qc3]);
  const DAY = '2030-01-10T00:00:00Z', DAY_END = '2030-01-11T00:00:00Z', WEEK_END = '2030-01-17T00:00:00Z';
  const at = (offsetDays) => new Date(Date.parse(DAY) + offsetDays * 86400000 + 3600000).toISOString();

  // fixtures written directly (triggers off), so the stages and history are exactly what the checks expect
  await svc(`SET session_replication_role = replica`);
  const mk = async (title, status, due, client) => (await svc(
    `INSERT INTO public.tasks (workspace_id, list_id, title, status, priority, due_date, client_deadline)
     VALUES ($1,$2,$3,$4,'MEDIUM',$5,$6) RETURNING id`, [ws, list, title, status, due, client]))[0].id;
  const assign = (t, role, u) => svc(`INSERT INTO public.task_assignees (task_id, workspace_id, role_type, user_id) VALUES ($1,$2,$3,$4)`, [t, ws, role, u]);
  const event = (t, from, to, note, n, when) => svc(
    `INSERT INTO public.task_status_events (task_id, workspace_id, from_status, to_status, actor_id, note, revision_number, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [t, ws, from, to, qc3, note, n, when]);
  const A = await mk('P11 overdue', 'STARTED_EDITING', at(-2), null);
  const B = await mk('P11 due today (client deadline)', 'ASSIGNED', null, at(0));
  const C = await mk('P11 in first QC, this week', 'QC_FIRST_APPROVAL', at(3), at(5));
  const D = await mk('P11 revision, no date', 'QC_REVISION_NEEDED', null, null);
  const E = await mk('P11 closed long ago', 'CLOSED', at(-30), null);
  const G = await mk('P11 final QC, nobody reviewing', 'QC_FINAL_APPROVAL', at(9), null);
  await assign(A, 'EDITOR', ed3); await assign(A, 'QC_REVIEWER', qc3);
  await assign(B, 'EDITOR', ed3);
  await assign(C, 'EDITOR', other); await assign(C, 'QC_REVIEWER', qc3);
  await assign(D, 'EDITOR', ed3); await assign(D, 'QC_REVIEWER', qc3);
  await assign(E, 'EDITOR', ed3);
  await event(C, 'STARTED_EDITING', 'QC_FIRST_APPROVAL', null, null, at(-1));
  await event(D, 'QC_FIRST_APPROVAL', 'QC_REVISION_NEEDED', 'first: tighten the intro', 1, at(-4));
  await event(D, 'QC_FINAL_APPROVAL', 'QC_REVISION_NEEDED', 'second: fix the audio pop at 00:45', 2, at(-1));
  await event(D, 'QC_REVISION_NEEDED', 'QC_FINAL_APPROVAL', null, null, at(-3));
  await event(G, 'QC_REVISION_NEEDED', 'QC_FINAL_APPROVAL', null, null, at(-2));
  const foreign = (await svc(`INSERT INTO public.tasks (workspace_id, list_id, title, status) VALUES ($1,$2,'P11 foreign','QC_REVISION_NEEDED') RETURNING id`, [wsB, listB]))[0].id;
  await svc(`INSERT INTO public.task_status_events (task_id, workspace_id, from_status, to_status, note, revision_number) VALUES ($1,$2,'QC_FIRST_APPROVAL','QC_REVISION_NEEDED','foreign note',1)`, [foreign, wsB]);
  await svc(`SET session_replication_role = origin`);

  const home = (who, a = DAY, b = DAY_END, c = WEEK_END, w = ws) =>
    as(who, `SELECT public.my_home_summary($1, $2::timestamptz, $3::timestamptz, $4::timestamptz) AS s`, [w, a, b, c]);
  const ids = (list) => (list ?? []).map((x) => x.id);

  // ---- my_home_summary ----------------------------------------------------------------------------
  console.log('  -- home summary');
  r = await home(ed3);
  let s = r.rows[0]?.s;
  record('an editor gets their own buckets: overdue, due today (client deadline counts), later (no date)',
    !r.error && s.mine.overdue === 1 && s.mine.dueToday === 1 && s.mine.dueThisWeek === 0 && s.mine.later === 1 && s.mine.total === 3,
    r.error?.message ?? JSON.stringify(s?.mine));
  record('...finished work is counted apart and never overdue', s?.mine.finished === 1);
  record('...an editor gets no QC queue, no revision list and no manager numbers',
    s?.role === 'EDITOR' && s.qcQueue.length === 0 && s.revisions.length === 0 && s.manager === null);

  r = await home(qc3);
  s = r.rows[0]?.s;
  record('a QC specialist\'s queue holds only the tasks they review that wait for QC', !r.error && ids(s.qcQueue).join() === C, JSON.stringify(ids(s?.qcQueue)));
  record('...with its waiting-since time from the stage history', s?.qcQueue[0]?.since && Date.parse(s.qcQueue[0].since) === Date.parse(at(-1)));
  record('...and revisions in progress lists the tasks they review that are back with the editor', ids(s?.revisions).join() === D);
  record('...a final-approval task nobody reviews is not in their queue', !ids(s?.qcQueue).includes(G));
  record('...their own buckets count their QC assignments too (A overdue, C this week, D later)',
    s?.mine.overdue === 1 && s.mine.dueThisWeek === 1 && s.mine.later === 1 && s.manager === null, JSON.stringify(s?.mine));

  r = await home(pm);
  s = r.rows[0]?.s;
  record('a production manager sees every task waiting for QC, oldest first', !r.error && ids(s.qcQueue).includes(C) && ids(s.qcQueue).includes(G)
    && ids(s.qcQueue).indexOf(G) < ids(s.qcQueue).indexOf(C), JSON.stringify(ids(s?.qcQueue)));
  record('...and every revision in progress', ids(s?.revisions).includes(D));
  const truth = (await svc(`
    WITH st AS (SELECT s.key, s.category FROM public.workflow_statuses s WHERE s.workflow_id = private.task_workflow_id($1)),
    t AS (SELECT t.id, LEAST(t.due_date, t.client_deadline) d FROM public.tasks t LEFT JOIN st ON st.key = t.status
          WHERE t.workspace_id = $1 AND COALESCE(st.category,'') <> 'COMPLETED')
    SELECT count(*)::int AS open, (count(*) FILTER (WHERE d < $2::timestamptz))::int AS overdue,
      (count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.role_type='EDITOR')))::int AS no_editor,
      (count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM public.task_assignees a WHERE a.task_id = t.id AND a.role_type='QC_REVIEWER')))::int AS no_qc
    FROM t`, [ws, DAY]))[0];
  record('...and workspace numbers that equal a direct count (open, overdue, no editor, no QC)',
    s?.manager?.open === truth.open && s.manager.overdue === truth.overdue && s.manager.noEditor === truth.no_editor && s.manager.noQc === truth.no_qc,
    JSON.stringify({ got: s?.manager, want: truth }));
  r = await home(owner);
  record('the owner gets the manager view too', !r.error && r.rows[0].s.manager !== null);

  r = await home(client);
  record('a client viewer is refused the summary', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await home(stranger);
  record('a non-member is refused the summary', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await home(ed3, DAY, DAY_END, WEEK_END, wsB);
  record('a member cannot ask for another workspace\'s summary', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await home(ed3, DAY_END, DAY, WEEK_END);
  record('day boundaries in the wrong order are refused', r.error?.code === '22023', r.error?.message ?? 'was allowed');
  r = await home(ed3, DAY, DAY_END, null);
  record('a missing boundary is refused', r.error?.code === '22023', r.error?.message ?? 'was allowed');
  r = await svc(`SELECT p.prosecdef FROM pg_proc p WHERE p.proname IN ('my_home_summary','latest_revision_notes')`);
  record('both new read functions run with the caller\'s rights (not SECURITY DEFINER)', r.length === 2 && r.every((x) => x.prosecdef === false));
  r = await as('anon', `SELECT public.my_home_summary($1, now(), now() + interval '1 day', now() + interval '7 days')`, [ws]);
  record('anon cannot call the summary', !!r.error);

  // ---- latest_revision_notes ---------------------------------------------------------------------
  console.log('  -- latest revision notes');
  r = await as(ed3, `SELECT * FROM public.latest_revision_notes($1::uuid[])`, [[D, A, C]]);
  record('the latest revision request per task, and only for tasks that had one',
    !r.error && r.rows.length === 1 && r.rows[0].task_id === D && r.rows[0].note === 'second: fix the audio pop at 00:45' && r.rows[0].revision_number === 2 && r.rows[0].actor_id === qc3,
    r.error?.message ?? JSON.stringify(r.rows));
  r = await as(ed3, `SELECT * FROM public.latest_revision_notes($1::uuid[])`, [[foreign]]);
  record('another workspace\'s revision note is not returned', !r.error && r.rows.length === 0);
  r = await as(client, `SELECT * FROM public.latest_revision_notes($1::uuid[])`, [[D]]);
  record('a client viewer gets nothing', !r.error && r.rows.length === 0);
  r = await as(stranger, `SELECT * FROM public.latest_revision_notes($1::uuid[])`, [[D]]);
  record('a non-member gets nothing', !r.error && r.rows.length === 0);
  r = await as(ed3, `SELECT * FROM public.latest_revision_notes($1::uuid[])`, [[]]);
  record('an empty list is fine', !r.error && r.rows.length === 0);

  // ---- Inbox "Done" (archived_at) ----------------------------------------------------------------
  console.log('  -- inbox done');
  const note = (await svc(`INSERT INTO public.notifications (user_id, workspace_id, task_id, actor_id, kind, data, dedupe_key)
    VALUES ($1,$2,$3,$4,'comment','{}'::jsonb,'p11-done-1') RETURNING id`, [ed3, ws, A, qc3]))[0].id;
  r = await as(ed3, `UPDATE public.notifications SET archived_at = '2000-01-01' WHERE id = $1 RETURNING archived_at, read_at`, [note]);
  const firstDone = r.rows[0]?.archived_at;
  record('the recipient can mark a notification Done, with the server\'s time (a supplied time is ignored)',
    !r.error && r.rows.length === 1 && new Date(firstDone).getFullYear() > 2020, r.error?.message ?? JSON.stringify(r.rows));
  record('...Done does not change the read state by itself', r.rows[0]?.read_at === null);
  r = await as(ed3, `UPDATE public.notifications SET archived_at = now() + interval '1 day' WHERE id = $1 RETURNING archived_at`, [note]);
  record('...marking it Done again keeps the first time', !r.error && +new Date(r.rows[0].archived_at) === +new Date(firstDone));
  r = await as(ed3, `UPDATE public.notifications SET archived_at = NULL WHERE id = $1 RETURNING archived_at`, [note]);
  record('...and they can move it back to the Inbox', !r.error && r.rows[0]?.archived_at === null);
  r = await as(qc3, `UPDATE public.notifications SET archived_at = now() WHERE id = $1 RETURNING id`, [note]);
  blocked('a colleague cannot mark someone else\'s notification Done', r);
  r = await as(owner, `UPDATE public.notifications SET archived_at = now() WHERE id = $1 RETURNING id`, [note]);
  blocked('not even the owner can', r);
  r = await as(ed3, `UPDATE public.notifications SET archived_at = now(), kind = 'mention' WHERE id = $1 RETURNING id`, [note]);
  record('Done cannot be used to change anything else (no grant on other columns)', !!r.error);
  r = await svc(`SELECT column_name FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='notifications' AND grantee='authenticated' AND privilege_type='UPDATE' ORDER BY column_name`);
  record('signed-in people may update exactly two columns: read_at and archived_at', r.map((x) => x.column_name).join() === 'archived_at,read_at', JSON.stringify(r));
  r = await svc(`SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_notifications_inbox'`);
  record('the Inbox index exists (not-done notifications per person, newest first)', r.length === 1 && /WHERE \(archived_at IS NULL\)/.test(r[0].indexdef), r[0]?.indexdef);
}

console.log('\n== Phase 12: custom fields ==');
{
  const cf = (who, type, name, opts = null, w = ws) =>
    as(who, `INSERT INTO public.custom_fields (workspace_id, name, field_type, options) VALUES ($1,$2,$3,$4::jsonb) RETURNING id`, [w, name, type, opts === null ? null : JSON.stringify(opts)]);
  const setv = (who, t, f, v) =>
    as(who, `INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES ($1,$2,$3,$4::jsonb) RETURNING value`, [t, f, ws, JSON.stringify(v)]);

  const mkTask = async (title, w = ws, l = list) => (await svc(`INSERT INTO public.tasks (workspace_id, list_id, title) VALUES ($1,$2,$3) RETURNING id`, [w, l, title]))[0].id;
  const T1 = await mkTask('P12 assigned to editor');
  const T2 = await mkTask('P12 not assigned');
  const TB = await mkTask('P12 foreign', wsB, listB);
  await svc(`INSERT INTO public.task_assignees (task_id, workspace_id, role_type, user_id) VALUES ($1,$2,'EDITOR',$3)`, [T1, ws, editor]);

  console.log('  -- definitions');
  const ids = {};
  for (const [who, label] of [[owner, 'owner'], [admin, 'admin'], [pm, 'production manager']]) {
    r = await cf(who, 'text', `P12 text by ${label}`);
    record(`${label} can create a field`, !r.error, r.error?.message);
  }
  for (const [who, label] of [[qc, 'QC specialist'], [editor, 'editor'], [client, 'client viewer'], [stranger, 'non-member']]) {
    r = await cf(who, 'text', `P12 nope ${label}`);
    record(`${label} cannot create a field`, !!r.error);
  }
  r = await cf(pm, 'text', 'A) Link note'); ids.text = r.rows[0]?.id;
  r = await cf(pm, 'url', 'F) Loom video'); ids.url = r.rows[0]?.id;
  r = await cf(pm, 'number', 'HOOK VARIATION'); ids.num = r.rows[0]?.id;
  r = await cf(pm, 'dropdown', 'Video Format Needed', ['16:9', '9:16', '1:1']); ids.dd = r.rows[0]?.id;
  r = await cf(pm, 'date', 'Shoot date'); ids.date = r.rows[0]?.id;
  record('all five types can be created', Object.values(ids).length === 5 && Object.values(ids).every(Boolean));
  r = await cf(pm, 'text', 'a) link NOTE');
  record('a name is unique per workspace ignoring case', r.error?.code === '23505', r.error?.message ?? 'was allowed');
  r = await cf(pm, 'text', 'A) Link note', null, wsB);
  record('a manager of workspace B can use the same name there (unique per workspace)', !r.error, r.error?.message);
  r = await cf(owner, 'text', 'P12 owner in B', null, wsB);
  record('a manager of this workspace cannot create fields in workspace B', !!r.error);
  r = await cf(pm, 'text', '');
  record('an empty name is refused', !!r.error);
  r = await cf(pm, 'text', '   ');
  record('a blank name is refused', !!r.error);
  r = await cf(pm, 'text', 'x'.repeat(61));
  record('a name over 60 characters is refused', !!r.error);
  r = await cf(pm, 'text', 'x'.repeat(60));
  record('a name of exactly 60 characters is fine', !r.error, r.error?.message);
  r = await cf(pm, 'hologram', 'P12 bad type');
  record('an unknown type is refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd none');
  record('a dropdown without choices is refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd empty', []);
  record('a dropdown with an empty list is refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd blank', ['a', ' ']);
  record('a blank choice is refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd dup', ['a', 'a']);
  record('duplicate choices are refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd long', ['x'.repeat(61)]);
  record('a choice over 60 characters is refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd many', Array.from({ length: 31 }, (_, i) => `c${i}`));
  record('more than 30 choices are refused', !!r.error);
  r = await cf(pm, 'dropdown', 'P12 dd 30', Array.from({ length: 30 }, (_, i) => `c${i}`));
  record('exactly 30 choices are fine', !r.error, r.error?.message);
  r = await as(pm, `INSERT INTO public.custom_fields (workspace_id, name, field_type, options) VALUES ($1,'P12 dd notstr','dropdown','[1,2]'::jsonb)`, [ws]);
  record('non-string choices are refused', !!r.error);
  r = await cf(pm, 'text', 'P12 text with options', ['a']);
  record('options on a non-dropdown field are refused', !!r.error);

  r = await as(editor, `SELECT id FROM public.custom_fields WHERE workspace_id = $1`, [ws]);
  record('an editor can read the definitions', !r.error && r.rows.length >= 5);
  r = await as(qc, `SELECT id FROM public.custom_fields WHERE workspace_id = $1`, [ws]);
  record('a QC specialist can read the definitions', !r.error && r.rows.length >= 5);
  r = await as(client, `SELECT id FROM public.custom_fields WHERE workspace_id = $1`, [ws]);
  record('a client viewer reads no definitions', !r.error && r.rows.length === 0);
  r = await as(stranger, `SELECT id FROM public.custom_fields`);
  record('a non-member reads no definitions', !r.error && r.rows.length === 0);
  r = await as('anon', `SELECT id FROM public.custom_fields`);
  record('anon cannot read definitions', !!r.error);

  r = await as(pm, `UPDATE public.custom_fields SET name = 'A) Link note (renamed)', position = 3 WHERE id = $1 RETURNING name, position`, [ids.text]);
  record('a manager can rename and re-order a field', !r.error && r.rows[0]?.name === 'A) Link note (renamed)' && r.rows[0].position === 3, r.error?.message);
  r = await as(pm, `UPDATE public.custom_fields SET name = 'HOOK VARIATION' WHERE id = $1 RETURNING id`, [ids.text]);
  record('renaming onto another field\'s name is refused', r.error?.code === '23505');
  r = await as(pm, `UPDATE public.custom_fields SET field_type = 'number' WHERE id = $1 RETURNING id`, [ids.text]);
  record('the type cannot be changed by a signed-in person (no column grant)', !!r.error);
  try {
    await svc(`UPDATE public.custom_fields SET field_type = 'number' WHERE id = $1`, [ids.text]);
    record('...and not even by a privileged writer (guard trigger)', false, 'was allowed');
  } catch (e) { record('...and not even by a privileged writer (guard trigger)', /cannot be changed/.test(e.message), e.message); }
  r = await as(pm, `UPDATE public.custom_fields SET workspace_id = $1 WHERE id = $2 RETURNING id`, [wsB, ids.text]);
  record('a field cannot move to another workspace', !!r.error);
  r = await as(pm, `UPDATE public.custom_fields SET options = '["a"]'::jsonb WHERE id = $1 RETURNING id`, [ids.text]);
  record('choices cannot be added to a non-dropdown', !!r.error);
  r = await as(pm, `UPDATE public.custom_fields SET options = '[]'::jsonb WHERE id = $1 RETURNING id`, [ids.dd]);
  record('a dropdown cannot be emptied of choices', !!r.error);
  for (const [who, label] of [[qc, 'QC specialist'], [editor, 'editor'], [client, 'client viewer']]) {
    r = await as(who, `UPDATE public.custom_fields SET name = 'hax' WHERE id = $1 RETURNING id`, [ids.text]);
    blocked(`${label} cannot rename a field`, r);
    r = await as(who, `DELETE FROM public.custom_fields WHERE id = $1 RETURNING id`, [ids.text]);
    blocked(`${label} cannot delete a field`, r);
  }
  r = await svc(`SELECT name FROM public.custom_fields WHERE id = $1`, [ids.text]);
  record('...and the field is unchanged', r[0]?.name === 'A) Link note (renamed)');

  console.log('  -- values: who may write');
  r = await setv(pm, T1, ids.text, 'raw footage is on the drive');
  record('a manager can set a value on any task', !r.error, r.error?.message);
  r = await setv(admin, T2, ids.text, 'admin note');
  record('an admin can set a value on any task', !r.error, r.error?.message);
  r = await setv(qc, T2, ids.num, 3);
  record('a QC specialist can set a value on any task', !r.error, r.error?.message);
  r = await setv(editor, T1, ids.num, 7);
  record('an editor can set a value on a task assigned to them', !r.error, r.error?.message);
  r = await setv(editor, T2, ids.date, '2030-01-01');
  record('an editor cannot set a value on a task that is not theirs', !!r.error);
  r = await as(editor, `UPDATE public.custom_field_values SET value = '9'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value`, [T2, ids.num]);
  blocked('an editor cannot change a value on a task that is not theirs', r);
  r = await as(editor, `DELETE FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2 RETURNING task_id`, [T2, ids.num]);
  blocked('an editor cannot delete a value on a task that is not theirs', r);
  r = await setv(client, T1, ids.text, 'client');
  record('a client viewer cannot set a value', !!r.error);
  r = await setv(stranger, T1, ids.url, 'https://example.com');
  record('a non-member cannot set a value', !!r.error);
  r = await as('anon', `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'"x"')`, [T1, ids.text]);
  record('anon cannot set a value', !!r.error);

  r = await as(editor, `SELECT value FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2`, [T2, ids.num]);
  record('every staff member can read values, even on tasks that are not theirs', !r.error && r.rows.length === 1 && r.rows[0].value === 3);
  r = await as(client, `SELECT value FROM public.custom_field_values`);
  record('a client viewer reads no values', !r.error && r.rows.length === 0);
  r = await as(stranger, `SELECT value FROM public.custom_field_values`);
  record('a non-member reads no values', !r.error && r.rows.length === 0);

  r = await as(editor, `UPDATE public.custom_field_values SET value = '8'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value, updated_by`, [T1, ids.num]);
  record('an editor can change a value on their task; the editor of the change is the signed-in person',
    !r.error && r.rows[0]?.value === 8 && r.rows[0].updated_by === editor, r.error?.message);
  r = await as(editor, `UPDATE public.custom_field_values SET updated_by = $1, updated_at = '2000-01-01' WHERE task_id = $2 AND field_id = $3 RETURNING updated_by`, [owner, T1, ids.num]);
  record('updated_by / updated_at cannot be set directly (no column grant)', !!r.error);
  r = await as(editor, `UPDATE public.custom_field_values SET task_id = $1 WHERE task_id = $2 AND field_id = $3 RETURNING task_id`, [T2, T1, ids.num]);
  record('a value cannot be moved to another task', !!r.error);
  r = await as(editor, `UPDATE public.custom_field_values SET workspace_id = $1 WHERE task_id = $2 AND field_id = $3 RETURNING task_id`, [wsB, T1, ids.num]);
  record('...or another workspace', !!r.error);
  r = await as(pm, `INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value, updated_by) VALUES ($1,$2,$3,'"http://ok.example"'::jsonb,$4) RETURNING workspace_id, updated_by`, [T1, ids.url, wsB, owner]);
  record('a forged workspace_id / updated_by on insert is overwritten from the task and the caller',
    !r.error && r.rows[0]?.workspace_id === ws && r.rows[0].updated_by === pm, r.error?.message ?? JSON.stringify(r.rows));
  r = await as(pm, `DELETE FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2 RETURNING task_id`, [T1, ids.url]);
  record('a manager can clear a value (the row is deleted)', !r.error && r.rows.length === 1);

  console.log('  -- values: validation per type');
  const bad = async (label, f, v) => {
    const x = await setv(pm, T2, f, v);
    record(label, !!x.error, 'was allowed');
    await svc(`DELETE FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2 AND $3::boolean`, [T2, f, !x.error]);
  };
  const good = async (label, f, v) => {
    const x = await setv(pm, T2, f, v);
    record(label, !x.error, x.error?.message);
    await svc(`DELETE FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2`, [T2, f]);
  };
  await svc(`DELETE FROM public.custom_field_values WHERE task_id = $1`, [T2]);
  await good('text: a string is stored', ids.text, 'hello');
  await good('text: 2000 characters is fine', ids.text, 'x'.repeat(2000));
  await bad('text: 2001 characters is refused', ids.text, 'x'.repeat(2001));
  await bad('text: an empty string is refused (clear = delete)', ids.text, '');
  await bad('text: a number is refused', ids.text, 5);
  await bad('text: an object is refused', ids.text, { a: 1 });
  await good('url: an https link is stored', ids.url, 'https://www.loom.com/share/abc?x=1#t');
  await good('url: an http link is stored', ids.url, 'http://example.com');
  await bad('url: no scheme is refused', ids.url, 'example.com');
  await bad('url: javascript: is refused', ids.url, 'javascript:alert(1)');
  await bad('url: ftp is refused', ids.url, 'ftp://example.com/x');
  await bad('url: a link with spaces is refused', ids.url, 'https://example.com/a b');
  await bad('url: over 2048 characters is refused', ids.url, 'https://example.com/' + 'a'.repeat(2040));
  await good('number: an integer is stored', ids.num, 12);
  await good('number: a decimal is stored', ids.num, -3.5);
  await bad('number: a numeric string is refused', ids.num, '12');
  await bad('number: a boolean is refused', ids.num, true);
  await good('dropdown: one of the choices is stored', ids.dd, '9:16');
  await bad('dropdown: something that is not a choice is refused', ids.dd, '4:3');
  await bad('dropdown: a choice with a trailing space is refused', ids.dd, '9:16 ');
  await bad('dropdown: an array of choices is refused', ids.dd, ['9:16']);
  await good('date: a real date is stored', ids.date, '2030-02-28');
  await good('date: a leap day is stored', ids.date, '2032-02-29');
  await bad('date: a non-leap 29 February is refused', ids.date, '2031-02-29');
  await bad('date: month 13 is refused', ids.date, '2030-13-01');
  await bad('date: a different format is refused', ids.date, '28/02/2030');
  await bad('date: a timestamp is refused', ids.date, '2030-02-28T10:00:00Z');
  await bad('date: a number is refused', ids.date, 20300228);
  r = await as(pm, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'null'::jsonb)`, [T2, ids.text]);
  record('a JSON null value is refused', !!r.error);
  r = await as(pm, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,NULL)`, [T2, ids.text]);
  record('a missing (SQL NULL) value is refused', !!r.error);
  await as(pm, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'"x"'::jsonb)`, [T2, ids.text]);
  r = await as(pm, `UPDATE public.custom_field_values SET value = 'null'::jsonb WHERE task_id = $1 AND field_id = $2`, [T2, ids.text]);
  record('an update to JSON null is refused too', !!r.error);
  r = await as(pm, `UPDATE public.custom_field_values SET value = '"y"'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value`, [T2, ids.text]);
  record('an update to a valid value works', !r.error && r.rows[0]?.value === 'y');
  r = await as(pm, `UPDATE public.custom_field_values SET value = '5'::jsonb WHERE task_id = $1 AND field_id = $2`, [T2, ids.text]);
  record('an update to a value of the wrong type is refused', !!r.error);
  await svc(`DELETE FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2`, [T2, ids.text]);

  console.log('  -- values: cross-workspace');
  const fB = (await svc(`INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'P12 B field','text') RETURNING id`, [wsB]))[0].id;
  r = await setv(pm, T1, fB, 'x');
  record('a field of another workspace cannot be attached to this workspace\'s task', !!r.error, r.error?.message);
  r = await as(pm, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'"x"'::jsonb)`, [TB, ids.text]);
  record('a field of this workspace cannot be set on another workspace\'s task', !!r.error);
  r = await as(admin, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'"x"'::jsonb)`, [TB, fB]);
  record('a manager of this workspace cannot write values in workspace B', !!r.error);
  r = await svc(`SELECT 1 FROM public.custom_field_values WHERE field_id = $1`, [fB]);
  record('...and nothing was stored there', r.length === 0);
  r = await as(admin, `SELECT id FROM public.custom_fields WHERE id = $1`, [fB]);
  record('a staff member cannot read another workspace\'s definitions', !r.error && r.rows.length === 0);
  r = await as(admin, `UPDATE public.custom_fields SET name = 'hax' WHERE id = $1 RETURNING id`, [fB]);
  blocked('...nor rename them', r);
  r = await as(admin, `DELETE FROM public.custom_fields WHERE id = $1 RETURNING id`, [fB]);
  blocked('...nor delete them', r);

  console.log('  -- choices, cascades, limits');
  await svc(`INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES ($1,$2,$3,'"1:1"'::jsonb)`, [T1, ids.dd, ws]);
  r = await as(pm, `UPDATE public.custom_fields SET options = '["16:9","9:16"]'::jsonb WHERE id = $1 RETURNING id`, [ids.dd]);
  record('a manager can remove a choice that is in use', !r.error, r.error?.message);
  r = await as(editor, `SELECT value FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2`, [T1, ids.dd]);
  record('...the stored value stays readable as it was', r.rows[0]?.value === '1:1');
  r = await as(pm, `UPDATE public.custom_field_values SET value = '"1:1"'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value`, [T1, ids.dd]);
  record('...saving the same value again does not fail', !r.error, r.error?.message);
  r = await as(pm, `UPDATE public.custom_field_values SET value = '"4:3"'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value`, [T1, ids.dd]);
  record('...but changing it to something that is not on the list is refused', !!r.error);
  r = await as(pm, `UPDATE public.custom_field_values SET value = '"16:9"'::jsonb WHERE task_id = $1 AND field_id = $2 RETURNING value`, [T1, ids.dd]);
  record('...and changing it to a current choice works', !r.error && r.rows[0]?.value === '16:9');

  const Tc = await mkTask('P12 cascade');
  const fc = (await svc(`INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'P12 cascade field','text') RETURNING id`, [ws]))[0].id;
  await svc(`INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES ($1,$2,$3,'"a"'::jsonb), ($4,$2,$3,'"b"'::jsonb)`, [Tc, fc, ws, T2]);
  r = await as(pm, `DELETE FROM public.custom_fields WHERE id = $1 RETURNING id`, [fc]);
  const left = await svc(`SELECT 1 FROM public.custom_field_values WHERE field_id = $1`, [fc]);
  record('deleting a field deletes all its values', !r.error && r.rows.length === 1 && left.length === 0);
  const fd = (await svc(`INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'P12 cascade 2','text') RETURNING id`, [ws]))[0].id;
  await svc(`INSERT INTO public.custom_field_values (task_id, field_id, workspace_id, value) VALUES ($1,$2,$3,'"a"'::jsonb)`, [Tc, fd, ws]);
  await svc(`DELETE FROM public.tasks WHERE id = $1`, [Tc]);
  const left2 = await svc(`SELECT 1 FROM public.custom_field_values WHERE task_id = $1`, [Tc]);
  record('deleting a task deletes its values (the field stays)', left2.length === 0 && (await svc(`SELECT 1 FROM public.custom_fields WHERE id = $1`, [fd])).length === 1);

  // the limit: top workspace B up to 50, the 51st is refused
  const nB = (await svc(`SELECT count(*)::int AS n FROM public.custom_fields WHERE workspace_id = $1`, [wsB]))[0].n;
  await svc(`INSERT INTO public.custom_fields (workspace_id, name, field_type) SELECT $1, 'P12 limit ' || g, 'text' FROM generate_series(1, $2::int) g`, [wsB, 50 - nB]);
  r = await as(pm, `INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'P12 one too many','text')`, [wsB]);
  record('a workspace cannot have more than 50 fields', !!r.error && /at most 50/.test(r.error.message), r.error?.message ?? 'was allowed');
  await svc(`DELETE FROM public.custom_fields WHERE workspace_id = $1 AND name LIKE 'P12 limit %'`, [wsB]);

  console.log('  -- grants');
  r = await svc(`SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN ('custom_fields','custom_field_values') AND grantee='anon'`);
  record('anon has no privilege on either table', r.length === 0, JSON.stringify(r));
  r = await svc(`SELECT table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema='public' AND table_name IN ('custom_fields','custom_field_values') AND grantee='authenticated' ORDER BY 1,2`);
  record('signed-in people get select / insert / delete only at table level (no truncate, no table-wide update)',
    r.map((x) => `${x.table_name}:${x.privilege_type}`).join() === 'custom_field_values:DELETE,custom_field_values:INSERT,custom_field_values:SELECT,custom_fields:DELETE,custom_fields:INSERT,custom_fields:SELECT', JSON.stringify(r));
  r = await svc(`SELECT table_name, column_name FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name IN ('custom_fields','custom_field_values') AND grantee='authenticated' AND privilege_type='UPDATE' ORDER BY 1,2`);
  record('...and update only on name / options / position / required / default / folders, and on value',
    r.map((x) => `${x.table_name}.${x.column_name}`).join() === 'custom_field_values.value,custom_fields.default_value,custom_fields.folder_ids,custom_fields.is_required,custom_fields.name,custom_fields.options,custom_fields.position', JSON.stringify(r));
  r = await svc(`SELECT relname FROM pg_class WHERE relname IN ('custom_fields','custom_field_values') AND relrowsecurity`);
  record('row level security is on for both tables', r.length === 2);
}

console.log('\n== Phase 12b: task batches ==');
{
  const mk = async (title, w = ws, l = list) => (await svc(`INSERT INTO public.tasks (workspace_id, list_id, title) VALUES ($1,$2,$3) RETURNING id`, [w, l, title]))[0].id;
  const video = (who, parent, title = 'Video') => as(who, `SELECT id, parent_id, list_id, title FROM public.create_batch_video($1,$2)`, [parent, title]);
  const parentOf = async (id) => (await svc(`SELECT parent_id FROM public.tasks WHERE id = $1`, [id]))[0]?.parent_id ?? null;
  const fails = (sql, params) => svc(sql, params).then(() => null, (e) => e);

  const batch = await mk('P12b batch');
  const batchB = await mk('P12b batch in B', wsB, listB);
  const spareList = (await svc(`INSERT INTO public.lists (space_id, name) SELECT space_id, 'P12b other list' FROM public.lists WHERE id = $1 RETURNING id`, [list]))[0].id;

  console.log('  -- creation through create_batch_video');
  const made = [];
  for (const [who, label] of [[owner, 'owner'], [admin, 'admin'], [pm, 'production manager']]) {
    r = await video(who, batch, `P12b by ${label}`);
    record(`${label} can add a video to a batch`, !r.error && r.rows[0]?.parent_id === batch && r.rows[0]?.list_id === list, r.error?.message);
    if (r.rows[0]) made.push(r.rows[0].id);
  }
  for (const [who, label] of [[qc, 'QC specialist'], [editor, 'editor'], [client, 'client viewer'], [stranger, 'non-member']]) {
    r = await video(who, batch, `P12b nope ${label}`);
    record(`${label} cannot add a video`, !!r.error);
  }
  r = await as('anon', `SELECT * FROM public.create_batch_video($1,'x')`, [batch]);
  record('anon cannot call create_batch_video', !!r.error);
  r = await video(owner, '00000000-0000-0000-0000-000000000000');
  record('an unknown batch is refused', !!r.error);
  r = await video(owner, batch, '   ');
  record('a blank title is refused', !!r.error);
  r = await video(pm, batchB);
  record('a manager of workspace B can add to a batch there', !r.error && r.rows[0]?.parent_id === batchB, r.error?.message);
  r = await video(owner, batchB);
  record('...and the owner of this workspace cannot add to a batch in workspace B', !!r.error);
  r = await as(pm, `SELECT id, parent_id FROM public.create_batch_video($1,'P12b with people',$2,$3)`, [batch, editor, qc]);
  const full = r.rows[0]?.id;
  const asg = full ? await svc(`SELECT role_type, user_id FROM public.task_assignees WHERE task_id = $1 ORDER BY role_type`, [full]) : [];
  record('editor and QC reviewer are assigned in the same call', asg.length === 2 && asg[0].user_id === editor && asg[1].user_id === qc, r.error?.message);
  const st = (await svc(`SELECT status FROM public.tasks WHERE id = $1`, [full]))[0]?.status;
  const first = (await svc(`SELECT s.key FROM public.workflow_statuses s JOIN public.workflows w ON w.id = s.workflow_id WHERE w.workspace_id = $1 AND w.is_default ORDER BY s.position LIMIT 1`, [ws]))[0].key;
  record('a new video starts in the workflow first stage like any task', st === first, st);

  console.log('  -- the rules');
  const kid = made[0];
  const stray = await mk('P12b stray');
  r = await video(owner, kid);
  record('a video cannot be a batch (one level)', !!r.error);
  r = await fails(`UPDATE public.tasks SET parent_id = $2 WHERE id = $1`, [batch, stray]);
  record('a batch cannot be given a parent (service role included)', !!r);
  r = await fails(`UPDATE public.tasks SET parent_id = $1 WHERE id = $1`, [stray]);
  record('a task cannot be its own parent', !!r);
  const otherListTask = await mk('P12b other list', ws, spareList);
  r = await fails(`UPDATE public.tasks SET parent_id = $2 WHERE id = $1`, [otherListTask, batch]);
  record('a video must be in the same list as its batch', !!r);
  const inB = await mk('P12b in B', wsB, listB);
  r = await fails(`UPDATE public.tasks SET parent_id = $2 WHERE id = $1`, [inB, batch]);
  record('a video cannot belong to a batch of another workspace', !!r);
  r = await fails(`UPDATE public.tasks SET parent_id = $2 WHERE id = $1`, [stray, kid]);
  record('a task cannot be put under a video', !!r);
  r = await fails(`INSERT INTO public.tasks (workspace_id, list_id, title, parent_id) VALUES ($1,$2,'P12b child of kid',$3)`, [ws, list, kid]);
  record('...nor created under a video', !!r);
  r = await fails(`UPDATE public.tasks SET list_id = $2 WHERE id = $1`, [kid, spareList]);
  record('a video cannot move to another list', !!r);
  r = await fails(`UPDATE public.tasks SET list_id = $2 WHERE id = $1`, [batch, spareList]);
  record('a batch with videos cannot move to another list', !!r);
  r = await fails(`UPDATE public.tasks SET list_id = $2 WHERE id = $1`, [stray, spareList]);
  record('an ordinary task still moves between lists', !r, r?.message);
  await svc(`UPDATE public.tasks SET list_id = $2 WHERE id = $1`, [stray, list]);

  console.log('  -- parent_id cannot be written directly');
  for (const [who, label] of [[owner, 'owner'], [admin, 'admin'], [pm, 'production manager'], [qc, 'QC specialist'], [editor, 'editor']]) {
    r = await as(who, `UPDATE public.tasks SET parent_id = $2 WHERE id = $1 RETURNING id`, [stray, batch]);
    record(`${label} cannot attach a task to a batch by UPDATE`, !!r.error || r.rows.length === 0);
    r = await as(who, `UPDATE public.tasks SET parent_id = NULL WHERE id = $1 RETURNING id`, [kid]);
    record(`${label} cannot detach a video by UPDATE`, !!r.error || r.rows.length === 0);
  }
  r = await as(owner, `UPDATE public.tasks SET parent_id = $2 WHERE id = $1 RETURNING id`, [kid, made[1]]);
  record('a video cannot be moved to another batch', !!r.error || r.rows.length === 0);
  for (const [who, label] of [[owner, 'owner'], [pm, 'production manager']]) {
    r = await as(who, `INSERT INTO public.tasks (workspace_id, list_id, title, parent_id) VALUES ($1,$2,'P12b sneaky',$3) RETURNING id`, [ws, list, batch]);
    record(`${label} cannot insert a task with a parent_id directly`, !!r.error);
  }
  record('the video is still attached after all of that', (await parentOf(kid)) === batch && (await parentOf(stray)) === null);
  r = await as(owner, `UPDATE public.tasks SET title = 'P12b renamed video' WHERE id = $1 RETURNING id`, [kid]);
  record('an ordinary edit of a video is unaffected', !r.error && r.rows.length === 1, r.error?.message);

  console.log('  -- progress');
  const doneKey = (await svc(`SELECT s.key FROM public.workflow_statuses s JOIN public.workflows w ON w.id = s.workflow_id WHERE w.workspace_id = $1 AND w.is_default AND s.category = 'COMPLETED'`, [ws]))[0].key;
  await svc(`UPDATE public.tasks SET status = $2 WHERE id = $1`, [made[0], doneKey]);
  await svc(`UPDATE public.tasks SET status = $2 WHERE id = $1`, [made[1], doneKey]);
  const prog = (who, ids) => as(who, `SELECT parent_id, total, finished FROM public.batch_progress($1::uuid[])`, [ids]);
  r = await prog(owner, [batch, batchB]);
  record('batch_progress counts videos and finished videos', r.rows.length === 1 && r.rows[0].parent_id === batch && r.rows[0].total === 4 && r.rows[0].finished === 2, JSON.stringify(r.rows) + (r.error?.message ?? ''));
  r = await prog(editor, [batch]);
  record('an editor sees the same counts (staff)', r.rows[0]?.total === 4, JSON.stringify(r.rows));
  r = await prog(client, [batch]);
  const clientSees = Number((await as(client, `SELECT count(*)::int n FROM public.tasks WHERE parent_id = $1`, [batch])).rows[0]?.n ?? 0);
  record('a client viewer gets exactly what row security lets them see', (r.rows[0]?.total ?? 0) === clientSees, JSON.stringify(r.rows));
  r = await prog(stranger, [batch]);
  record('a non-member gets nothing', !r.error && r.rows.length === 0, JSON.stringify(r.rows));
  r = await prog(owner, [batchB]);
  record('a batch in another workspace is not counted', !r.error && r.rows.length === 0);
  r = await as('anon', `SELECT * FROM public.batch_progress(ARRAY[$1]::uuid[])`, [batch]);
  record('anon cannot call batch_progress', !!r.error);
  r = await prog(pm, []);
  record('an empty list of ids gives nothing', !r.error && r.rows.length === 0);
  r = await as(pm, `SELECT * FROM public.batch_progress(NULL)`);
  record('a null list of ids is refused', !!r.error);
  r = await as(pm, `SELECT * FROM public.batch_progress(ARRAY(SELECT gen_random_uuid() FROM generate_series(1,501)))`);
  record('more than 500 ids are refused', !!r.error);
  r = await as(pm, `SELECT count(*)::int n FROM public.batch_progress(ARRAY(SELECT gen_random_uuid() FROM generate_series(1,500)))`);
  record('exactly 500 ids are fine', !r.error, r.error?.message);
  r = await svc(`SELECT proname, prosecdef FROM pg_proc WHERE proname IN ('batch_progress','create_batch_video') ORDER BY 1`);
  record('batch_progress and create_batch_video are SECURITY INVOKER', r.length === 2 && r.every((x) => x.prosecdef === false), JSON.stringify(r));
  r = await svc(`SELECT p.proname, has_function_privilege('anon', p.oid, 'EXECUTE') a, has_function_privilege('authenticated', p.oid, 'EXECUTE') u
    FROM pg_proc p WHERE p.proname IN ('batch_progress','create_batch_video') ORDER BY 1`);
  record('both are executable by signed-in people only', r.every((x) => !x.a && x.u), JSON.stringify(r));

  console.log('  -- deleting');
  await svc(`INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at) VALUES ($1,$2,$3,now())`, [made[2], ws, editor]);
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [batch]);
  record('a manager can delete a batch', !r.error && r.rows.length === 1, r.error?.message);
  const left = await svc(`SELECT id, parent_id FROM public.tasks WHERE id = ANY($1::uuid[])`, [[...made, full]]);
  record('its videos survive, as ordinary tasks', left.length === made.length + 1 && left.every((x) => x.parent_id === null), JSON.stringify(left));
  record('a credited video keeps its credit', Number((await svc(`SELECT count(*) AS n FROM public.task_production_credits WHERE task_id = $1`, [made[2]]))[0].n) === 1);
  const batch2 = await mk('P12b batch 2');
  r = await video(owner, batch2, 'P12b v1');
  const v1 = r.rows[0]?.id;
  r = await as(pm, `DELETE FROM public.tasks WHERE id = $1 RETURNING id`, [v1]);
  record('deleting a video leaves the batch', !r.error && (await svc(`SELECT 1 FROM public.tasks WHERE id = $1`, [batch2])).length === 1, r.error?.message);
  r = await prog(pm, [batch2]);
  record('...and the count drops to zero', !r.error && r.rows.length === 0);
  r = await video(owner, batch2, 'P12b v2');
  record('a video can be added after another was deleted', !r.error && r.rows[0]?.parent_id === batch2, r.error?.message);
  r = await video(owner, made[0], 'P12b v3');
  record('a former video (its batch was deleted) can be a batch again', !r.error, r.error?.message);
}

console.log('\n== Phase 12c: team availability ==');
{
  const set = (who, w, u, status, note = null, back = null) =>
    as(who, `INSERT INTO public.member_availability (workspace_id, user_id, status, note, back_on) VALUES ($1,$2,$3,$4,$5) RETURNING status, note, updated_at`, [w, u, status, note, back]);
  r = await set(editor, ws, editor, 'BUSY', '  Finishing the Medicus batch  ');
  record('a staff member sets their own status (note trimmed, server time)', !r.error && r.rows[0]?.status === 'BUSY' && r.rows[0].note === 'Finishing the Medicus batch', r.error?.message);
  r = await set(qc, ws, editor, 'AVAILABLE');
  record('nobody can set someone else\'s status', !!r.error);
  r = await set(owner, ws, editor, 'AVAILABLE');
  record('not even the owner', !!r.error);
  r = await set(client, ws, client, 'AVAILABLE');
  record('a client viewer cannot set a status', !!r.error);
  r = await set(stranger, ws, stranger, 'AVAILABLE');
  record('a non-member cannot set a status', !!r.error);
  r = await set(editor, wsB, editor, 'AVAILABLE');
  record('a status for a workspace you are not in is refused', !!r.error);
  r = await set(qc, ws, qc, 'HOLIDAY');
  record('an unknown status is refused', !!r.error);
  r = await set(qc, ws, qc, 'WORKING', null, '2030-01-01');
  record('a return date is only for leave', !!r.error);
  r = await set(qc, ws, qc, 'ON_LEAVE', 'x'.repeat(81));
  record('a note over 80 characters is refused', !!r.error);
  r = await set(qc, ws, qc, 'ON_LEAVE', 'Family trip', '2030-01-10');
  record('leave with a note and a return date is fine', !r.error, r.error?.message);
  r = await as(pm, `SELECT user_id, status FROM public.member_availability WHERE workspace_id = $1 ORDER BY status`, [ws]);
  record('staff see everyone\'s status', !r.error && r.rows.length === 2);
  r = await as(client, `SELECT user_id FROM public.member_availability`);
  record('a client viewer sees no statuses', !r.error && r.rows.length === 0);
  r = await as(stranger, `SELECT user_id FROM public.member_availability`);
  record('a non-member sees no statuses', !r.error && r.rows.length === 0);
  r = await as(editor, `UPDATE public.member_availability SET status = 'AVAILABLE', note = NULL WHERE workspace_id = $1 AND user_id = $2 RETURNING status`, [ws, editor]);
  record('a person updates their own status', !r.error && r.rows[0]?.status === 'AVAILABLE', r.error?.message);
  r = await as(pm, `UPDATE public.member_availability SET status = 'BUSY' WHERE workspace_id = $1 AND user_id = $2 RETURNING status`, [ws, editor]);
  blocked('a manager cannot change someone else\'s status', r);
  r = await as(editor, `UPDATE public.member_availability SET user_id = $3 WHERE workspace_id = $1 AND user_id = $2 RETURNING user_id`, [ws, editor, qc]);
  record('a status cannot be moved to another person (no column grant)', !!r.error);
  r = await as(pm, `DELETE FROM public.member_availability WHERE user_id = $1 RETURNING user_id`, [qc]);
  blocked('a manager cannot clear someone else\'s status', r);
  r = await as(qc, `DELETE FROM public.member_availability WHERE user_id = $1 RETURNING user_id`, [qc]);
  record('a person clears their own status', !r.error && r.rows.length === 1, r.error?.message);
  r = await as('anon', `SELECT user_id FROM public.member_availability`);
  record('anon cannot read statuses', !!r.error);
}

console.log('\n== Phase 12d: QC auto-assignment ==');
{
  const oQ = await mkUser('q-owner@tbb.test', {}, true);
  const edQ = await mkUser('q-editor@tbb.test', {}, true);
  const qcFree = await mkUser('q-free@tbb.test', {}, true);
  const qcBusy = await mkUser('q-busy@tbb.test', {}, true);
  const qcAway = await mkUser('q-away@tbb.test', {}, true);
  const wsQ = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('Q','q-auto',$1) RETURNING id`, [oQ]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'QC_SPECIALIST'), ($1,$4,'QC_SPECIALIST'), ($1,$5,'QC_SPECIALIST')
             ON CONFLICT DO NOTHING`, [wsQ, edQ, qcFree, qcBusy, qcAway]);
  await svc(`INSERT INTO public.member_availability (workspace_id, user_id, status) VALUES ($1,$2,'AVAILABLE'), ($1,$3,'BUSY'), ($1,$4,'ON_LEAVE')`, [wsQ, qcFree, qcBusy, qcAway]);
  const spQ = (await as(oQ, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsQ])).rows[0]?.id;
  const lQ = (await as(oQ, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spQ])).rows[0]?.id;
  const mk = async (title) => {
    const t = (await as(oQ, `INSERT INTO public.tasks (list_id, title) VALUES ($1,$2) RETURNING id`, [lQ, title])).rows[0]?.id;
    await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [t, edQ]);
    return t;
  };
  const toQc = async (t) => {
    for (const step of ['IN_EDIT', 'ASSIGNED', 'STARTED_EDITING']) await as(oQ, `SELECT public.transition_task($1, $2)`, [t, step]);
    return as(oQ, `SELECT (public.transition_task($1, 'QC_FIRST_APPROVAL', NULL, 'https://frame.io/r/x')).status AS status`, [t]);
  };
  const qcOf = async (t) => (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'QC_REVIEWER'`, [t]))[0]?.user_id ?? null;

  const t1 = await mk('Q1');
  r = await toQc(t1);
  record('a cut reaching first QC without a reviewer gets one automatically', !r.error && r.rows[0]?.status === 'QC_FIRST_APPROVAL' && (await qcOf(t1)) === qcFree, r.error?.message ?? String(await qcOf(t1)));
  r = await svc(`SELECT kind FROM public.notifications WHERE task_id = $1 AND user_id = $2 AND kind = 'assigned'`, [t1, qcFree]);
  record('...and the chosen QC specialist is notified', r.length === 1);
  record('...the one on leave is never picked', (await qcOf(t1)) !== qcAway);

  const t2 = await mk('Q2');
  await toQc(t2);
  record('the free QC stays first while the busy one is at capacity (free beats busy even with more work)', (await qcOf(t2)) === qcFree, String(await qcOf(t2)));

  await svc(`UPDATE public.member_availability SET status = 'ON_LEAVE' WHERE workspace_id = $1 AND user_id = $2`, [wsQ, qcFree]);
  const t3 = await mk('Q3');
  await toQc(t3);
  record('with the free one on leave, the busy one is chosen rather than nobody', (await qcOf(t3)) === qcBusy, String(await qcOf(t3)));

  // final approval keeps the reviewer already on the task
  await as(oQ, `SELECT public.transition_task($1, 'QC_REVISION_NEEDED', 'fix the intro')`, [t1]);
  await as(oQ, `SELECT public.transition_task($1, 'QC_FINAL_APPROVAL', NULL, 'https://frame.io/r/x2')`, [t1]);
  record('final approval keeps the reviewer from first approval', (await qcOf(t1)) === qcFree);

  // a task that already has a reviewer is never changed
  const t4 = await mk('Q4');
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'QC_REVIEWER',$2)`, [t4, qcAway]);
  await toQc(t4);
  record('a reviewer chosen by hand is kept', (await qcOf(t4)) === qcAway);

  // nobody available: the task waits unassigned as before
  await svc(`UPDATE public.member_availability SET status = 'ON_LEAVE' WHERE workspace_id = $1`, [wsQ]);
  const t5 = await mk('Q5');
  r = await toQc(t5);
  record('with every QC on leave the move still succeeds and the task waits unassigned', !r.error && (await qcOf(t5)) === null, r.error?.message);

  r = await svc(`SELECT prosecdef FROM pg_proc WHERE proname = 'pick_qc_reviewer'`);
  record('the picker cannot be called by signed-in users', (await as(edQ, `SELECT private.pick_qc_reviewer($1, NULL)`, [wsQ])).error !== null);
}

console.log('\n== Phase 12f: default QC reviewer per folder / list ==');
{
  const oD = await mkUser('d-owner@tbb.test', {}, true);
  const edD = await mkUser('d-editor@tbb.test', {}, true);
  const zim = await mkUser('d-zim@tbb.test', {}, true);
  const myla = await mkUser('d-myla@tbb.test', {}, true);
  const other = await mkUser('d-other@tbb.test', {}, true);
  const wsD = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('D','d-defqc',$1) RETURNING id`, [oD]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'QC_SPECIALIST'), ($1,$4,'QC_SPECIALIST'), ($1,$5,'QC_SPECIALIST') ON CONFLICT DO NOTHING`, [wsD, edD, zim, myla, other]);
  // "other" is the least loaded and available: without defaults the picker would choose them
  await svc(`INSERT INTO public.member_availability (workspace_id, user_id, status) VALUES ($1,$2,'AVAILABLE'), ($1,$3,'BUSY'), ($1,$4,'BUSY')`, [wsD, other, zim, myla]);
  const spD = (await as(oD, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsD])).rows[0]?.id;
  const fZim = (await as(oD, `INSERT INTO public.folders (space_id, name) VALUES ($1,'CONTENT PIPELINE - ZIM') RETURNING id`, [spD])).rows[0]?.id;
  const fMyla = (await as(oD, `INSERT INTO public.folders (space_id, name) VALUES ($1,'CONTENT PIPELINE - MYLA') RETURNING id`, [spD])).rows[0]?.id;
  r = await as(oD, `UPDATE public.folders SET default_qc_id = $2 WHERE id = $1`, [fZim, zim]);
  record('a manager sets a folder\'s default QC reviewer', !r.error, r.error?.message);
  await as(oD, `UPDATE public.folders SET default_qc_id = $2 WHERE id = $1`, [fMyla, myla]);
  r = await as(oD, `UPDATE public.folders SET default_qc_id = $2 WHERE id = $1`, [fZim, edD]);
  record('an editor cannot be a default QC reviewer', r.error?.code === '23514', r.error?.message ?? 'was allowed');
  r = await as(edD, `UPDATE public.folders SET default_qc_id = $2 WHERE id = $1 RETURNING id`, [fZim, other]);
  record('an editor cannot change it', !!r.error || r.rows.length === 0);
  const lConn = (await as(oD, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'1. THE CONNECTORS') RETURNING id`, [spD, fZim])).rows[0]?.id;
  const mk = async (list) => {
    const t = (await as(oD, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'v') RETURNING id`, [list])).rows[0]?.id;
    await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [t, edD]);
    for (const step of ['IN_EDIT', 'ASSIGNED', 'STARTED_EDITING']) await as(oD, `SELECT public.transition_task($1, $2)`, [t, step]);
    await as(oD, `SELECT public.transition_task($1, 'QC_FIRST_APPROVAL', NULL, 'https://frame.io/r/d')`, [t]);
    return t;
  };
  const qcOf = async (t) => (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'QC_REVIEWER'`, [t]))[0]?.user_id ?? null;
  const t1 = await mk(lConn);
  record('a cut in Zim\'s folder goes to Zim even though another QC is freer', (await qcOf(t1)) === zim, String(await qcOf(t1)));
  await as(oD, `UPDATE public.lists SET folder_id = $2 WHERE id = $1`, [lConn, fMyla]);
  const t2 = await mk(lConn);
  record('after the list moves to Myla\'s folder, its next cut goes to Myla', (await qcOf(t2)) === myla, String(await qcOf(t2)));
  await as(oD, `UPDATE public.lists SET default_qc_id = $2 WHERE id = $1`, [lConn, zim]);
  const t3 = await mk(lConn);
  record('a list\'s own default beats its folder\'s', (await qcOf(t3)) === zim, String(await qcOf(t3)));
  await svc(`UPDATE public.member_availability SET status = 'ON_LEAVE' WHERE workspace_id = $1 AND user_id = $2`, [wsD, zim]);
  const t4 = await mk(lConn);
  record('with the list\'s reviewer on leave, the folder\'s reviewer is used', (await qcOf(t4)) === myla, String(await qcOf(t4)));
  r = await as(edD, `SELECT private.default_qc_for_task($1)`, [t4]);
  record('the default lookup cannot be called by signed-in users', !!r.error);
}

console.log('\n== Customize: more field types ==');
{
  const oF = await mkUser('ft-owner@tbb.test', {}, true);
  const edF = await mkUser('ft-editor@tbb.test', {}, true);
  const outsider = await mkUser('ft-outsider@tbb.test', {}, true);
  const wsF = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('FT','ft-fields',$1) RETURNING id`, [oF]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR') ON CONFLICT DO NOTHING`, [wsF, edF]);
  const spF = (await as(oF, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsF])).rows[0]?.id;
  const fz = (await as(oF, `INSERT INTO public.folders (space_id, name) VALUES ($1,'ZIM') RETURNING id`, [spF])).rows[0]?.id;
  const lF = (await as(oF, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'L') RETURNING id`, [spF, fz])).rows[0]?.id;
  const mkField = async (name, type, options = null) =>
    (await as(oF, `INSERT INTO public.custom_fields (workspace_id, name, field_type, options) VALUES ($1,$2,$3,$4) RETURNING id`, [wsF, name, type, options === null ? null : JSON.stringify(options)])).rows[0]?.id;
  const ids = {
    checkbox: await mkField('Approved by client', 'checkbox'),
    labels: await mkField('Platforms', 'labels', ['TikTok', 'Reels', 'Shorts']),
    people: await mkField('Account manager', 'people'),
    rating: await mkField('Quality', 'rating'),
    money: await mkField('Budget (USD)', 'money'),
    email: await mkField('Client e-mail', 'email'),
    phone: await mkField('Client phone', 'phone'),
    long_text: await mkField('Script', 'long_text'),
  };
  record('the owner creates fields of all eight new types', Object.values(ids).every(Boolean), JSON.stringify(ids));
  const tF = (await as(oF, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'v') RETURNING id`, [lF])).rows[0]?.id;
  const setv = (field, value) => as(oF, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,$3) ON CONFLICT (task_id, field_id) DO UPDATE SET value = EXCLUDED.value`, [tF, field, JSON.stringify(value)]);
  const good = [['checkbox', true], ['labels', ['TikTok', 'Shorts']], ['people', edF], ['rating', 4], ['money', 250.5], ['email', 'client@brand.com'], ['phone', '+880 1711-000000'], ['long_text', 'Hook, then three beats.']];
  for (const [k, val] of good) {
    r = await setv(ids[k], val);
    record(`a valid ${k} value is stored`, !r.error, r.error?.message);
  }
  const bad = [['checkbox', false], ['labels', ['Facebook']], ['labels', []], ['people', outsider], ['rating', 6], ['rating', 2.5], ['money', 'lots'], ['email', 'not-an-email'], ['phone', 'call me'], ['long_text', '']];
  for (const [k, val] of bad) {
    r = await setv(ids[k], val);
    record(`an invalid ${k} value (${JSON.stringify(val)}) is refused`, r.error?.code === '23514', r.error?.message ?? 'was stored');
  }
  r = await as(oF, `INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'No choices','labels')`, [wsF]);
  record('labels need choices', !!r.error);
  r = await as(oF, `UPDATE public.custom_fields SET is_required = true, default_value = '"Reels"', folder_ids = ARRAY[$2]::uuid[] WHERE id = $1 RETURNING is_required`, [ids.labels, fz]);
  record('a manager sets required, default and folders on a field', !r.error && r.rows[0]?.is_required === true, r.error?.message);
  r = await as(edF, `UPDATE public.custom_fields SET is_required = false WHERE id = $1 RETURNING id`, [ids.labels]);
  record('an editor cannot change field settings', !!r.error || r.rows.length === 0);
  // a default that fits the field is filled in on new tasks; one that does not is skipped without blocking
  await svc(`UPDATE public.custom_fields SET default_value = '["Reels"]' WHERE id = $1`, [ids.labels]);
  await svc(`UPDATE public.custom_fields SET default_value = '9' WHERE id = $1`, [ids.rating]);
  r = await as(oF, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'new one') RETURNING id`, [lF]);
  const tNew = r.rows[0]?.id;
  const vals = await svc(`SELECT field_id, value FROM public.custom_field_values WHERE task_id = $1`, [tNew]);
  record('a new task gets the valid defaults', !r.error && vals.some((x) => x.field_id === ids.labels && JSON.stringify(x.value) === '["Reels"]'), JSON.stringify(vals));
  record('...and an invalid default is skipped, not blocking the task', !vals.some((x) => x.field_id === ids.rating));
  const lOut = (await as(oF, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Outside') RETURNING id`, [spF])).rows[0]?.id;
  const tOut = (await as(oF, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'elsewhere') RETURNING id`, [lOut])).rows[0]?.id;
  r = await svc(`SELECT count(*)::int n FROM public.custom_field_values WHERE task_id = $1 AND field_id = $2`, [tOut, ids.labels]);
  record('a field limited to some folders gives no default elsewhere', r[0].n === 0);
}

console.log('\n== Customize: feature switches ==');
{
  const oW = await mkUser('fs-owner@tbb.test', {}, true);
  const adW = await mkUser('fs-admin@tbb.test', {}, true);
  const pmW = await mkUser('fs-pm@tbb.test', {}, true);
  const wsW = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('FS','fs-switch',$1) RETURNING id`, [oW]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'ADMIN'), ($1,$3,'PRODUCTION_MANAGER') ON CONFLICT DO NOTHING`, [wsW, adW, pmW]);
  const sw = (who, f, on, ws = wsW) => as(who, `SELECT public.set_workspace_feature($1, $2, $3) AS f`, [ws, f, on]);
  r = await sw(adW, 'reports', false);
  record('an admin switches a feature off', !r.error && r.rows[0]?.f?.reports === false, r.error?.message);
  r = await sw(oW, 'priorities', false);
  record('...the owner too, and both switches are kept', !r.error && r.rows[0]?.f?.reports === false && r.rows[0]?.f?.priorities === false, JSON.stringify(r.rows[0]?.f));
  r = await sw(adW, 'reports', true);
  record('switching back on removes the entry (missing = on)', !r.error && !('reports' in (r.rows[0]?.f ?? {})), JSON.stringify(r.rows[0]?.f));
  r = await sw(pmW, 'reports', false);
  record('a production manager cannot switch features', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await sw(oW, 'make_coffee', false);
  record('an unknown feature is refused', r.error?.code === '22023', r.error?.message ?? 'was allowed');
  r = await sw(oW, 'reports', false, wsB);
  record('a feature of another workspace cannot be switched', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await as('anon', `SELECT public.set_workspace_feature($1, 'reports', false)`, [wsW]);
  record('anon cannot switch features', !!r.error);
}

console.log('\n== Customize: tags ==');
{
  const oT = await mkUser('tg-owner@tbb.test', {}, true);
  const pmT = await mkUser('tg-pm@tbb.test', {}, true);
  const edT = await mkUser('tg-editor@tbb.test', {}, true);
  const ed2 = await mkUser('tg-editor2@tbb.test', {}, true);
  const clT = await mkUser('tg-client@tbb.test', {}, true);
  const wsT = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('TG','tg-tags',$1) RETURNING id`, [oT]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR'), ($1,$4,'EDITOR'), ($1,$5,'CLIENT_VIEWER') ON CONFLICT DO NOTHING`, [wsT, pmT, edT, ed2, clT]);
  r = await as(pmT, `INSERT INTO public.tags (workspace_id, name, color) VALUES ($1,'  Reshoot ','#EF4444') RETURNING id, name`, [wsT]);
  const tReshoot = r.rows[0]?.id;
  record('a production manager creates a tag (name trimmed)', !r.error && r.rows[0]?.name === 'Reshoot', r.error?.message);
  r = await as(pmT, `INSERT INTO public.tags (workspace_id, name) VALUES ($1,'reshoot')`, [wsT]);
  record('tag names are unique per workspace, ignoring case', !!r.error);
  r = await as(edT, `INSERT INTO public.tags (workspace_id, name) VALUES ($1,'Mine')`, [wsT]);
  record('an editor cannot create tags', !!r.error);
  const otherTag = (await svc(`INSERT INTO public.tags (workspace_id, name) VALUES ($1,'Elsewhere') RETURNING id`, [wsB]))[0].id;
  const spT = (await as(oT, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsT])).rows[0]?.id;
  const lT = (await as(oT, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spT])).rows[0]?.id;
  const task = (await as(oT, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'v') RETURNING id`, [lT])).rows[0]?.id;
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [task, edT]);
  r = await as(edT, `INSERT INTO public.task_tags (task_id, tag_id) VALUES ($1,$2)`, [task, tReshoot]);
  record('the assigned editor tags their video', !r.error, r.error?.message);
  r = await as(ed2, `DELETE FROM public.task_tags WHERE task_id = $1 RETURNING tag_id`, [task]);
  record('another editor cannot untag it', !!r.error || r.rows.length === 0);
  r = await as(oT, `INSERT INTO public.task_tags (task_id, tag_id) VALUES ($1,$2)`, [task, otherTag]);
  record('a tag of another workspace is refused', r.error?.code === '23514', r.error?.message ?? 'was allowed');
  r = await as(clT, `SELECT * FROM public.tags WHERE workspace_id = $1`, [wsT]);
  record('a client viewer sees no tags', !r.error && r.rows.length === 0);
  r = await as(pmT, `UPDATE public.tags SET name = 'Re-shoot', color = '#F97316' WHERE id = $1 RETURNING name`, [tReshoot]);
  record('a manager renames and recolours a tag', !r.error && r.rows[0]?.name === 'Re-shoot', r.error?.message);
  r = await as(pmT, `DELETE FROM public.tags WHERE id = $1 RETURNING id`, [tReshoot]);
  record('deleting a tag removes it from every video', !r.error && (await svc(`SELECT count(*)::int n FROM public.task_tags WHERE tag_id = $1`, [tReshoot]))[0].n === 0, r.error?.message);
  r = await as(oT, `SELECT public.set_workspace_feature($1, 'tags', false) AS f`, [wsT]);
  record('tags can be switched off as a feature', !r.error && r.rows[0]?.f?.tags === false, r.error?.message);
}

console.log('\n== Customize: automations ==');
{
  const oA = await mkUser('au-owner@tbb.test', {}, true);
  const pmA = await mkUser('au-pm@tbb.test', {}, true);
  const edA = await mkUser('au-editor@tbb.test', {}, true);
  const qcA = await mkUser('au-qc@tbb.test', {}, true);
  const wsA = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('AU','au-auto',$1) RETURNING id`, [oA]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR'), ($1,$4,'QC_SPECIALIST') ON CONFLICT DO NOTHING`, [wsA, pmA, edA, qcA]);
  const spA = (await as(oA, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsA])).rows[0]?.id;
  const fA = (await as(oA, `INSERT INTO public.folders (space_id, name) VALUES ($1,'ZIM') RETURNING id`, [spA])).rows[0]?.id;
  const lA = (await as(oA, `INSERT INTO public.lists (space_id, folder_id, name) VALUES ($1,$2,'1. CLIENT') RETURNING id`, [spA, fA])).rows[0]?.id;
  const lOut = (await as(oA, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Elsewhere') RETURNING id`, [spA])).rows[0]?.id;
  const tagRush = (await as(oA, `INSERT INTO public.tags (workspace_id, name) VALUES ($1,'Rush') RETURNING id`, [wsA])).rows[0]?.id;
  const mkAuto = (who, name, trig, actions, extra = {}) =>
    as(who, `INSERT INTO public.automations (workspace_id, name, trigger_type, trigger_status, trigger_tag_id, folder_id, actions) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [wsA, name, trig, extra.status ?? null, extra.tag ?? null, extra.folder ?? null, JSON.stringify(actions)]);

  r = await mkAuto(pmA, 'x', 'task_created', [{ type: 'set_priority', priority: 'HIGH' }]);
  record('a production manager cannot create automations', !!r.error);
  r = await mkAuto(oA, 'bad', 'task_created', [{ type: 'launch_rocket' }]);
  record('an unknown action is refused', r.error?.code === '23514', r.error?.message ?? 'was allowed');
  r = await mkAuto(oA, 'bad', 'task_created', [{ type: 'assign_editor', user_id: oA === edA ? oA : '00000000-0000-0000-0000-000000000000' }]);
  record('assigning someone outside the workspace is refused', r.error?.code === '23514', r.error?.message ?? 'was allowed');

  r = await mkAuto(oA, 'New ZIM video', 'task_created', [{ type: 'assign_editor', user_id: edA }, { type: 'add_tag', tag_id: tagRush }, { type: 'set_due_in_days', days: 2 }], { folder: fA });
  record('the owner creates an automation for new videos in a folder', !r.error, r.error?.message);
  r = await mkAuto(oA, 'Client wants changes', 'status_changed', [{ type: 'set_priority', priority: 'URGENT' }, { type: 'notify', to: 'editor', message: 'Client asked for changes' }], { status: 'IN_EDIT' });
  record('...and one for a status move', !r.error, r.error?.message);
  const autoStatus = r.rows[0]?.id;
  r = await mkAuto(oA, 'Rush means QC', 'tag_added', [{ type: 'assign_qc', user_id: qcA }], { tag: tagRush });
  record('...and one for a tag', !r.error, r.error?.message);

  const t1 = (await as(pmA, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'video 1') RETURNING id`, [lA])).rows[0]?.id;
  const people = await svc(`SELECT role_type, user_id FROM public.task_assignees WHERE task_id = $1 ORDER BY role_type`, [t1]);
  record('a new video in the folder gets its editor', people.some((p) => p.role_type === 'EDITOR' && p.user_id === edA), JSON.stringify(people));
  record('...its tag', (await svc(`SELECT count(*)::int n FROM public.task_tags WHERE task_id = $1 AND tag_id = $2`, [t1, tagRush]))[0].n === 1);
  record('...a due date two days out', (await svc(`SELECT (due_date::date - now()::date) AS d FROM public.tasks WHERE id = $1`, [t1]))[0].d === 2);
  record('...but adding the tag BY an automation starts no further automation (no loops)', !people.some((p) => p.role_type === 'QC_REVIEWER'));

  const t2 = (await as(pmA, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'video 2') RETURNING id`, [lOut])).rows[0]?.id;
  record('a video outside the folder is untouched', (await svc(`SELECT count(*)::int n FROM public.task_assignees WHERE task_id = $1`, [t2]))[0].n === 0);

  r = await as(pmA, `INSERT INTO public.task_tags (task_id, tag_id) VALUES ($1,$2)`, [t2, tagRush]);
  record('a person adding the tag starts the tag automation', !r.error && (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'QC_REVIEWER'`, [t2]))[0]?.user_id === qcA, r.error?.message);

  // an EDITOR's own move triggers a priority change the editor could not make by hand
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2) ON CONFLICT DO NOTHING`, [t2, edA]);
  r = await as(pmA, `SELECT public.transition_task($1, 'IN_EDIT')`, [t2]);
  const pr = (await svc(`SELECT priority FROM public.tasks WHERE id = $1`, [t2]))[0].priority;
  record('a status move runs its automation (priority set to URGENT)', !r.error && pr === 'URGENT', r.error?.message ?? pr);
  r = await svc(`SELECT data FROM public.notifications WHERE task_id = $1 AND user_id = $2 AND data->>'automation' = 'Client wants changes'`, [t2, edA]);
  record('...and notifies the editor with its message', r.length === 1 && r[0].data.message === 'Client asked for changes', JSON.stringify(r));
  record('...and counts the run', (await svc(`SELECT run_count FROM public.automations WHERE id = $1`, [autoStatus]))[0].run_count === 1);
  r = await as(edA, `UPDATE public.tasks SET priority = 'LOW' WHERE id = $1`, [t2]);
  record('the editor still cannot change priority by hand', !!r.error);

  await as(oA, `UPDATE public.automations SET enabled = false WHERE id = $1`, [autoStatus]);
  await as(pmA, `SELECT public.transition_task($1, 'TO_BE_EDITED')`, [t2]);
  await svc(`UPDATE public.tasks SET priority = 'LOW' WHERE id = $1`, [t2]);
  await as(pmA, `SELECT public.transition_task($1, 'IN_EDIT')`, [t2]);
  record('a switched-off automation does nothing', (await svc(`SELECT priority FROM public.tasks WHERE id = $1`, [t2]))[0].priority === 'LOW');

  // an action that cannot apply is skipped without blocking the change
  await svc(`DELETE FROM public.workspace_members WHERE workspace_id = $1 AND user_id = $2`, [wsA, edA]);
  r = await as(pmA, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'video 3') RETURNING id`, [lA]);
  record('an action that no longer fits (editor left) is skipped, the video is still created', !r.error && !!r.rows[0]?.id, r.error?.message);
  r = await as(pmA, `SELECT * FROM public.automations WHERE workspace_id = $1`, [wsA]);
  record('a production manager can read automations', !r.error && r.rows.length === 3);
  r = await as(qcA, `SELECT * FROM public.automations WHERE workspace_id = $1`, [wsA]);
  record('QC cannot read automations', !r.error && r.rows.length === 0);
}

console.log('\n== Saved views ==');
{
  const oV = await mkUser('sv-owner@tbb.test', {}, true);
  const pmV = await mkUser('sv-pm@tbb.test', {}, true);
  const edV = await mkUser('sv-editor@tbb.test', {}, true);
  const ed2V = await mkUser('sv-editor2@tbb.test', {}, true);
  const clV = await mkUser('sv-client@tbb.test', {}, true);
  const wsV = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('SV','sv-views',$1) RETURNING id`, [oV]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR'), ($1,$4,'EDITOR'), ($1,$5,'CLIENT_VIEWER') ON CONFLICT DO NOTHING`, [wsV, pmV, edV, ed2V, clV]);
  const spV = (await as(oV, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsV])).rows[0]?.id;
  const lV = (await as(oV, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spV])).rows[0]?.id;
  const view = (who, name, extra = {}) =>
    as(who, `INSERT INTO public.saved_views (workspace_id, scope, name, query, mode, is_shared, is_default) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, owner_id`,
      [wsV, extra.scope ?? lV, name, extra.query ?? 'status=QC_FIRST_APPROVAL', extra.mode ?? 'board', extra.shared ?? false, extra.def ?? false]);
  r = await view(edV, 'My QC queue', { def: true });
  const mine = r.rows[0]?.id;
  record('an editor saves a private view (owner set by the database)', !r.error && r.rows[0]?.owner_id === edV, r.error?.message);
  r = await as(ed2V, `SELECT id FROM public.saved_views WHERE workspace_id = $1`, [wsV]);
  record('another editor does not see it', !r.error && r.rows.length === 0);
  r = await view(edV, 'Team view', { shared: true });
  record('an editor cannot share a view with the team', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await view(pmV, 'Overdue', { shared: true, def: true, query: 'overdue=1' });
  const shared = r.rows[0]?.id;
  record('a production manager shares a default view', !r.error, r.error?.message);
  r = await as(ed2V, `SELECT name FROM public.saved_views WHERE workspace_id = $1`, [wsV]);
  record('...which the whole team sees', !r.error && r.rows.length === 1 && r.rows[0].name === 'Overdue');
  r = await as(edV, `UPDATE public.saved_views SET name = 'Mine now' WHERE id = $1 RETURNING id`, [shared]);
  record('an editor cannot change a shared view', !!r.error || r.rows.length === 0);
  r = await view(pmV, 'Overdue 2', { shared: true, def: true });
  record('a new shared default replaces the old one', !r.error && (await svc(`SELECT is_default FROM public.saved_views WHERE id = $1`, [shared]))[0].is_default === false, r.error?.message);
  record('...without touching anyone\'s private default', (await svc(`SELECT is_default FROM public.saved_views WHERE id = $1`, [mine]))[0].is_default === true);
  r = await view(clV, 'Client', {});
  record('a client viewer cannot save views', !!r.error);
  const lOther = (await svc(`SELECT id FROM public.lists WHERE workspace_id = $1 LIMIT 1`, [wsB]))[0]?.id;
  r = await view(oV, 'Elsewhere', { scope: lOther });
  record('a view cannot point at another workspace\'s list', !!r.error);
  r = await view(oV, 'Everything', { scope: 'everything', mode: 'table' });
  record('views can belong to Everything', !r.error, r.error?.message);
  r = await as(edV, `DELETE FROM public.saved_views WHERE id = $1 RETURNING id`, [mine]);
  record('the owner deletes their own view', !r.error && r.rows.length === 1, r.error?.message);
}

console.log('\n== Client brief forms ==');
{
  const oB = await mkUser('bf-owner@tbb.test', {}, true);
  const pmB = await mkUser('bf-pm@tbb.test', {}, true);
  const edB = await mkUser('bf-editor@tbb.test', {}, true);
  const wsBF = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('BF','bf-brief',$1) RETURNING id`, [oB]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR') ON CONFLICT DO NOTHING`, [wsBF, pmB, edB]);
  const spBF = (await as(oB, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsBF])).rows[0]?.id;
  const lBF = (await as(oB, `INSERT INTO public.lists (space_id, name) VALUES ($1,'3. THE CONNECTORS') RETURNING id`, [spBF])).rows[0]?.id;
  const fFormat = (await as(oB, `INSERT INTO public.custom_fields (workspace_id, name, field_type, options) VALUES ($1,'Format','dropdown','["9:16","16:9"]') RETURNING id`, [wsBF])).rows[0]?.id;
  await svc(`UPDATE public.custom_fields SET is_required = true WHERE id = $1`, [fFormat]);
  const fOther = (await svc(`INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'Theirs','text') RETURNING id`, [wsB]))[0].id;

  r = await as(edB, `INSERT INTO public.brief_forms (workspace_id, list_id, title) VALUES ($1,$2,'x')`, [wsBF, lBF]);
  record('an editor cannot create brief forms', !!r.error);
  r = await as(pmB, `INSERT INTO public.brief_forms (workspace_id, list_id, title, intro, fields) VALUES ($1,$2,'Connectors brief','Tell us about the video',$3) RETURNING id, token, fields`,
    [wsBF, lBF, JSON.stringify([fFormat, fOther])]);
  const form = r.rows[0];
  record('a production manager creates a form with a long random token', !r.error && /^[0-9a-f]{64}$/.test(form?.token ?? ''), r.error?.message);
  record('...and only this workspace\'s fields are kept in it', form?.fields?.length === 1 && form.fields[0].name === 'Format' && form.fields[0].required === true, JSON.stringify(form?.fields));

  // the public page: anon, with or without the right token header
  const anon = async (token, sql, params = []) => {
    await db.exec(`RESET ROLE; SELECT set_config('request.jwt.claim.sub', '', false); SELECT set_config('request.headers', '${JSON.stringify(token ? { 'x-brief-token': token } : {})}', false);`);
    await db.exec('SET ROLE anon');
    try { return { rows: (await db.query(sql, params)).rows, error: null }; }
    catch (e) { return { rows: [], error: e }; }
    finally { await db.exec(`RESET ROLE; SELECT set_config('request.headers', '{}', false);`); }
  };
  r = await anon(form.token, `SELECT id, title, intro, fields FROM public.brief_forms`);
  record('with its token, anyone reads exactly that one form', !r.error && r.rows.length === 1 && r.rows[0].title === 'Connectors brief', r.error?.message);
  r = await anon(null, `SELECT id FROM public.brief_forms`);
  record('without a token nobody can list forms', !r.error && r.rows.length === 0, r.error?.message);
  r = await anon('f'.repeat(64), `SELECT id FROM public.brief_forms`);
  record('a guessed token reads nothing', !r.error && r.rows.length === 0);
  r = await anon(form.token, `SELECT workspace_id, list_id, created_by FROM public.brief_forms`);
  record('the public page cannot read the workspace, list or author', !!r.error);
  r = await anon(form.token, `SELECT id FROM public.tasks`);
  record('the public page cannot read tasks', !!r.error || r.rows.length === 0);

  const submit = (token, title, answers, extra = {}) =>
    anon(token, `INSERT INTO public.brief_submissions (form_id, title, brief, contact_name, contact_email, answers) VALUES ($1,$2,$3,$4,$5,$6)`,
      [extra.formId ?? form.id, title, extra.brief ?? 'Hook, then 3 beats', extra.name ?? 'Jane Client', extra.email ?? 'jane@brand.com', JSON.stringify(answers)]);
  r = await submit(form.token, 'Midtown promo', {});
  record('a required field left empty is refused', r.error?.code === '23514', r.error?.message ?? 'was accepted');
  r = await submit(form.token, 'Midtown promo', { [fFormat]: '4:3' });
  record('an answer that does not fit the field is refused', !!r.error, r.error?.message ?? 'was accepted');
  r = await submit(form.token, 'Midtown promo', { [fFormat]: '9:16' });
  record('a valid brief is accepted', !r.error, r.error?.message);
  const made = await svc(`SELECT t.id, t.title, t.status, t.description, (SELECT value FROM public.custom_field_values v WHERE v.task_id = t.id AND v.field_id = $2) AS fmt
    FROM public.tasks t WHERE t.list_id = $1`, [lBF, fFormat]);
  record('...and becomes a video in the form\'s list, at the starting status, with its field and the client\'s contact', made.length === 1 && made[0].title === 'Midtown promo' && made[0].status === 'TO_BE_EDITED' && made[0].fmt === '9:16' && /jane@brand.com/.test(made[0].description), JSON.stringify(made));
  r = await submit(null, 'No token', { [fFormat]: '9:16' });
  record('a brief without the token is refused', !!r.error);
  r = await anon(form.token, `SELECT * FROM public.brief_submissions`);
  record('the public page cannot read submissions back', !!r.error || r.rows.length === 0);
  record('the form counts its submissions', (await svc(`SELECT submission_count FROM public.brief_forms WHERE id = $1`, [form.id]))[0].submission_count === 1);
  r = await as(pmB, `UPDATE public.brief_forms SET submission_count = 999, token = 'x' WHERE id = $1`, [form.id]);
  record('a manager cannot forge the counter or the token', !!r.error);
  await as(pmB, `UPDATE public.brief_forms SET enabled = false WHERE id = $1`, [form.id]);
  r = await submit(form.token, 'After closing', { [fFormat]: '9:16' });
  record('a disabled form takes no more briefs', !!r.error);
  r = await as(pmB, `SELECT title, contact_email FROM public.brief_submissions WHERE form_id = $1`, [form.id]);
  record('managers read the submissions', !r.error && r.rows.length === 1 && r.rows[0].contact_email === 'jane@brand.com', r.error?.message);
  r = await as(edB, `SELECT * FROM public.brief_submissions`);
  record('editors do not see submissions', !r.error && r.rows.length === 0);
}

console.log('\n== Notification settings ==');
{
  const oN = await mkUser('np-owner@tbb.test', {}, true);
  const edN = await mkUser('np-editor@tbb.test', {}, true);
  const ed2N = await mkUser('np-editor2@tbb.test', {}, true);
  const wsN = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('NP','np-prefs',$1) RETURNING id`, [oN]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'EDITOR') ON CONFLICT DO NOTHING`, [wsN, edN, ed2N]);
  const spN = (await as(oN, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsN])).rows[0]?.id;
  const lQuiet = (await as(oN, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Quiet client') RETURNING id`, [spN])).rows[0]?.id;
  const lLoud = (await as(oN, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Loud client') RETURNING id`, [spN])).rows[0]?.id;
  const assign = async (list, who) => {
    const t = (await as(oN, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'v') RETURNING id`, [list])).rows[0]?.id;
    await as(oN, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t, who]);
    return (await svc(`SELECT count(*)::int n FROM public.notifications WHERE task_id = $1 AND user_id = $2 AND kind = 'assigned'`, [t, who]))[0].n;
  };
  record('with no settings every assignment notifies', (await assign(lLoud, edN)) === 1);
  r = await as(edN, `INSERT INTO public.notification_prefs (user_id, workspace_id, muted_list_ids) VALUES ($1,$2,ARRAY[$3]::uuid[])`, [edN, wsN, lQuiet]);
  record('a person mutes one client', !r.error, r.error?.message);
  record('...and hears nothing about it', (await assign(lQuiet, edN)) === 0);
  record('...but still hears about other clients', (await assign(lLoud, edN)) === 1);
  r = await as(edN, `UPDATE public.notification_prefs SET muted_kinds = ARRAY['assigned'] WHERE user_id = $1 RETURNING user_id`, [edN]);
  record('they mute assignments', !r.error && r.rows.length === 1, r.error?.message);
  record('...and get no assignment notices', (await assign(lLoud, edN)) === 0);
  record('someone else\'s settings do not affect a teammate', (await assign(lLoud, ed2N)) === 1);
  r = await as(ed2N, `UPDATE public.notification_prefs SET muted_kinds = '{}' WHERE user_id = $1 RETURNING user_id`, [edN]);
  record('nobody can change another person\'s settings', !!r.error || r.rows.length === 0);
  r = await as(ed2N, `SELECT * FROM public.notification_prefs`);
  record('...or read them', !r.error && r.rows.length === 0);
  r = await as(ed2N, `INSERT INTO public.notification_prefs (user_id, workspace_id) VALUES ($1,$2)`, [edN, wsN]);
  record('...or create them for someone else', !!r.error);
  r = await as(edN, `UPDATE public.notification_prefs SET muted_kinds = ARRAY['spam'] WHERE user_id = $1`, [edN]);
  record('only known kinds can be muted', !!r.error);
}

console.log('\n== Personal layout ==');
{
  const oL = await mkUser('ul-owner@tbb.test', {}, true);
  const edL = await mkUser('ul-editor@tbb.test', {}, true);
  const wsL = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('UL','ul-layout',$1) RETURNING id`, [oL]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR') ON CONFLICT DO NOTHING`, [wsL, edL]);
  r = await as(edL, `INSERT INTO public.user_layouts (user_id, workspace_id, layout) VALUES ($1,$2,'{"favorites":["a"],"home":{"hidden":["insights"]}}')`, [edL, wsL]);
  record('a person saves their own layout', !r.error, r.error?.message);
  r = await as(oL, `SELECT * FROM public.user_layouts`);
  record('even the owner cannot read someone else\'s layout', !r.error && r.rows.length === 0);
  r = await as(oL, `UPDATE public.user_layouts SET layout = '{}' WHERE user_id = $1 RETURNING user_id`, [edL]);
  record('...or change it', !!r.error || r.rows.length === 0);
  r = await as(edL, `INSERT INTO public.user_layouts (user_id, workspace_id) VALUES ($1,$2)`, [edL, wsB]);
  record('a layout cannot be saved for a workspace one is not in', !!r.error);
  r = await as(edL, `UPDATE public.user_layouts SET layout = jsonb_build_object('junk', repeat(md5(random()::text), 1000)) WHERE user_id = $1`, [edL]);
  record('a layout is capped at 16 KB', !!r.error);
  r = await as(edL, `UPDATE public.user_layouts SET layout = '[]' WHERE user_id = $1`, [edL]);
  record('a layout must be an object', !!r.error);
}

console.log('\n== Recurring videos, dependencies, time tracking ==');
{
  const oR = await mkUser('rc-owner@tbb.test', {}, true);
  const pmR = await mkUser('rc-pm@tbb.test', {}, true);
  const edR = await mkUser('rc-editor@tbb.test', {}, true);
  const ed2R = await mkUser('rc-editor2@tbb.test', {}, true);
  const qcR = await mkUser('rc-qc@tbb.test', {}, true);
  const clR = await mkUser('rc-client@tbb.test', {}, true);
  const wsR = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('RC','rc-rec',$1) RETURNING id`, [oR]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR'), ($1,$4,'EDITOR'), ($1,$5,'QC_SPECIALIST'), ($1,$6,'CLIENT_VIEWER') ON CONFLICT DO NOTHING`, [wsR, pmR, edR, ed2R, qcR, clR]);
  const spR = (await as(oR, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsR])).rows[0]?.id;
  const lR = (await as(oR, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Weekly client') RETURNING id`, [spR])).rows[0]?.id;
  const tagR = (await as(oR, `INSERT INTO public.tags (workspace_id, name) VALUES ($1,'Weekly') RETURNING id`, [wsR])).rows[0]?.id;
  const t1 = (await as(pmR, `INSERT INTO public.tasks (list_id, title, priority, due_date) VALUES ($1,'Weekly recap','HIGH', '2026-11-02T12:00:00Z') RETURNING id`, [lR])).rows[0]?.id;
  await as(pmR, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t1, edR]);
  await as(pmR, `INSERT INTO public.task_tags (task_id, tag_id) VALUES ($1,$2)`, [t1, tagR]);

  // --- recurring
  r = await as(edR, `INSERT INTO public.task_recurrence (task_id, every, unit) VALUES ($1, 1, 'week')`, [t1]);
  record('an editor cannot make a video repeat', !!r.error);
  r = await as(pmR, `INSERT INTO public.task_recurrence (task_id, every, unit) VALUES ($1, 1, 'week')`, [t1]);
  record('a manager makes a video repeat every week', !r.error, r.error?.message);
  await svc(`UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1`, [t1]);
  const next = await svc(`SELECT t.id, t.title, t.status, t.priority, t.due_date FROM public.tasks t WHERE t.list_id = $1 AND t.id <> $2`, [lR, t1]);
  record('closing it creates the next one, a week later, at the starting status', next.length === 1 && next[0].title === 'Weekly recap' && next[0].status === 'TO_BE_EDITED' && next[0].priority === 'HIGH' && new Date(next[0].due_date).toISOString().startsWith('2026-11-09'), JSON.stringify(next));
  const t2 = next[0]?.id;
  record('...with the same editor and tag', (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'EDITOR'`, [t2]))[0]?.user_id === edR && (await svc(`SELECT count(*)::int n FROM public.task_tags WHERE task_id = $1`, [t2]))[0].n === 1);
  record('...and the repeat rule moves to the new video', (await svc(`SELECT count(*)::int n FROM public.task_recurrence WHERE task_id = $1`, [t2]))[0].n === 1);
  await svc(`UPDATE public.tasks SET status = 'TO_BE_EDITED' WHERE id = $1`, [t1]);
  await svc(`UPDATE public.tasks SET status = 'CLOSED' WHERE id = $1`, [t1]);
  record('re-closing the old video does not create a second copy', (await svc(`SELECT count(*)::int n FROM public.tasks WHERE list_id = $1`, [lR]))[0].n === 2);
  r = await as(pmR, `UPDATE public.task_recurrence SET spawned_task_id = NULL WHERE task_id = $1`, [t1]);
  record('nobody can reset which video a rule created', !!r.error);
  r = await as(pmR, `DELETE FROM public.task_recurrence WHERE task_id = $1 RETURNING task_id`, [t2]);
  record('a manager stops the repeat', !r.error && r.rows.length === 1, r.error?.message);

  // --- dependencies
  const a = (await as(pmR, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Selects') RETURNING id`, [lR])).rows[0]?.id;
  const b = (await as(pmR, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Long cut') RETURNING id`, [lR])).rows[0]?.id;
  const c = (await as(pmR, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Shorts') RETURNING id`, [lR])).rows[0]?.id;
  r = await as(edR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [b, a]);
  record('an editor cannot add dependencies', !!r.error);
  r = await as(pmR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [b, a]);
  record('a manager makes the long cut wait on the selects', !r.error, r.error?.message);
  await as(pmR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [c, b]);
  r = await as(pmR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [a, c]);
  record('a circle of waiting is refused', r.error?.code === '23514', r.error?.message ?? 'was allowed');
  r = await as(pmR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$1)`, [a]);
  record('a video cannot wait on itself', !!r.error);
  const otherTask = (await svc(`SELECT id FROM public.tasks WHERE workspace_id = $1 LIMIT 1`, [wsB]))[0]?.id;
  if (otherTask) {
    r = await as(pmR, `INSERT INTO public.task_dependencies (task_id, depends_on_id) VALUES ($1,$2)`, [a, otherTask]);
    record('a video cannot wait on another workspace\'s video', !!r.error);
  }
  r = await as(edR, `SELECT * FROM public.task_dependencies WHERE task_id = $1`, [b]);
  record('the staff see dependencies', !r.error && r.rows.length === 1);
  r = await as(clR, `SELECT * FROM public.task_dependencies`);
  record('clients do not', !r.error && r.rows.length === 0);

  // --- time tracking
  r = await as(edR, `INSERT INTO public.time_entries (task_id, started_at) VALUES ($1, now() - interval '10 minutes') RETURNING user_id`, [a]);
  record('an editor starts a timer (owner set by the database)', !r.error && r.rows[0]?.user_id === edR, r.error?.message);
  r = await as(edR, `INSERT INTO public.time_entries (task_id, started_at) VALUES ($1, now())`, [b]);
  record('only one timer runs at a time per person', !!r.error);
  r = await as(edR, `UPDATE public.time_entries SET ended_at = now() WHERE user_id = $1 AND ended_at IS NULL RETURNING id`, [edR]);
  record('...and stops it', !r.error && r.rows.length === 1, r.error?.message);
  r = await as(edR, `INSERT INTO public.time_entries (task_id, started_at, ended_at, note) VALUES ($1, now() - interval '30 hours', now(), 'too long')`, [a]);
  record('an entry longer than 24 hours is refused', !!r.error);
  r = await as(edR, `INSERT INTO public.time_entries (task_id, started_at) VALUES ($1, now() + interval '1 day')`, [a]);
  record('time cannot start in the future', !!r.error);
  const entry = (await as(edR, `INSERT INTO public.time_entries (task_id, started_at, ended_at) VALUES ($1, now() - interval '2 hours', now() - interval '1 hour') RETURNING id`, [a])).rows[0]?.id;
  r = await as(ed2R, `UPDATE public.time_entries SET note = 'mine' WHERE id = $1 RETURNING id`, [entry]);
  record('another editor cannot change someone\'s time', !!r.error || r.rows.length === 0);
  r = await as(ed2R, `DELETE FROM public.time_entries WHERE id = $1 RETURNING id`, [entry]);
  record('...or delete it', !!r.error || r.rows.length === 0);
  r = await as(qcR, `SELECT count(*)::int n FROM public.time_entries WHERE task_id = $1`, [a]);
  record('the staff see the time on a video', !r.error && r.rows[0].n === 2);
  r = await as(clR, `SELECT * FROM public.time_entries`);
  record('clients see no time entries', !r.error && r.rows.length === 0);
  r = await as(pmR, `DELETE FROM public.time_entries WHERE id = $1 RETURNING id`, [entry]);
  record('a manager deletes a wrong entry', !r.error && r.rows.length === 1, r.error?.message);
  r = await as(pmR, `UPDATE public.tasks SET time_estimate_minutes = 90 WHERE id = $1 RETURNING time_estimate_minutes`, [a]);
  record('a manager sets a time estimate', !r.error && r.rows[0]?.time_estimate_minutes === 90, r.error?.message);
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2) ON CONFLICT DO NOTHING`, [a, edR]);
  r = await as(edR, `UPDATE public.tasks SET time_estimate_minutes = 5 WHERE id = $1`, [a]);
  record('an editor cannot change the estimate', !!r.error);
}

console.log('\n== Trash: trace and restore deletes ==');
{
  const oT = await mkUser('tr-owner@tbb.test', {}, true);
  const pmT = await mkUser('tr-pm@tbb.test', {}, true);
  const edT = await mkUser('tr-editor@tbb.test', {}, true);
  const wsT = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('TR','tr-trash',$1) RETURNING id`, [oT]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR') ON CONFLICT DO NOTHING`, [wsT, pmT, edT]);
  const spT = (await as(oT, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsT])).rows[0]?.id;
  const lT = (await as(oT, `INSERT INTO public.lists (space_id, name) VALUES ($1,'7. CLIENT') RETURNING id`, [spT])).rows[0]?.id;
  const fT = (await as(oT, `INSERT INTO public.custom_fields (workspace_id, name, field_type) VALUES ($1,'Hook','text') RETURNING id`, [wsT])).rows[0]?.id;
  const tagT = (await as(oT, `INSERT INTO public.tags (workspace_id, name) VALUES ($1,'Rush') RETURNING id`, [wsT])).rows[0]?.id;
  const t = (await as(pmT, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Promo cut') RETURNING id`, [lT])).rows[0]?.id;
  await as(pmT, `SELECT public.set_task_assignee($1, 'EDITOR', $2)`, [t, edT]);
  await as(pmT, `INSERT INTO public.custom_field_values (task_id, field_id, value) VALUES ($1,$2,'"Open on the product"')`, [t, fT]);
  await as(pmT, `INSERT INTO public.task_tags (task_id, tag_id) VALUES ($1,$2)`, [t, tagT]);
  await as(edT, `INSERT INTO public.task_comments (task_id, workspace_id, author_id, body) VALUES ($1,$2,$3,'first pass done')`, [t, wsT, edT]);
  await svc(`UPDATE public.tasks SET status = 'QC_REVISION_NEEDED', revision_count = 2 WHERE id = $1`, [t]);
  const before = (await svc(`SELECT status, revision_count, created_at FROM public.tasks WHERE id = $1`, [t]))[0];
  await as(edT, `INSERT INTO public.time_entries (task_id, started_at, ended_at) VALUES ($1, now() - interval '2 hours', now() - interval '1 hour')`, [t]);

  r = await as(oT, `DELETE FROM public.lists WHERE id = $1 RETURNING id`, [lT]);
  record('the owner deletes a client list (with its video)', !r.error && r.rows.length === 1, r.error?.message);
  record('...and the video is gone', (await svc(`SELECT count(*)::int n FROM public.tasks WHERE id = $1`, [t]))[0].n === 0);
  const trash = await svc(`SELECT batch, table_name, deleted_by, label FROM public.trash_items WHERE workspace_id = $1`, [wsT]);
  const kinds = new Set(trash.map((x) => x.table_name));
  record('the trash holds the list, the video and its parts, all in one batch, with who deleted it',
    ['lists', 'tasks', 'task_assignees', 'custom_field_values', 'task_tags', 'task_comments', 'time_entries'].every((k) => kinds.has(k)) && new Set(trash.map((x) => String(x.batch))).size === 1 && trash.every((x) => x.deleted_by === oT),
    JSON.stringify([...kinds]));
  const batch = trash[0]?.batch;
  r = await as(edT, `SELECT * FROM public.trash_items WHERE workspace_id = $1`, [wsT]);
  record('editors cannot see the trash', !r.error && r.rows.length === 0);
  r = await as(edT, `SELECT public.restore_trash_batch($1, $2)`, [batch, wsT]);
  record('editors cannot restore', !!r.error);
  r = await as(edT, `DELETE FROM public.trash_items WHERE workspace_id = $1`, [wsT]);
  record('nobody can delete from the trash through the API', !!r.error || (await svc(`SELECT count(*)::int n FROM public.trash_items WHERE workspace_id = $1`, [wsT]))[0].n === trash.length);

  const notesBefore = (await svc(`SELECT count(*)::int n FROM public.notifications WHERE workspace_id = $1`, [wsT]))[0].n;
  r = await as(pmT, `SELECT public.restore_trash_batch($1, $2) AS res`, [batch, wsT]);
  record('a manager restores the batch', !r.error && r.rows[0]?.res?.skipped === 0 && r.rows[0]?.res?.restored === trash.length, r.error?.message ?? JSON.stringify(r.rows[0]?.res));
  const after = (await svc(`SELECT status, revision_count, created_at, list_id FROM public.tasks WHERE id = $1`, [t]))[0];
  record('...the video is back as it was (status, revisions, dates, list)', after && after.status === before.status && after.revision_count === before.revision_count && before.revision_count > 0 && +new Date(after.created_at) === +new Date(before.created_at) && after.list_id === lT, JSON.stringify(after));
  record('...with its editor, field, tag, comment and time',
    (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1`, [t]))[0]?.user_id === edT &&
    (await svc(`SELECT value FROM public.custom_field_values WHERE task_id = $1`, [t]))[0]?.value === 'Open on the product' &&
    (await svc(`SELECT count(*)::int n FROM public.task_tags WHERE task_id = $1`, [t]))[0].n === 1 &&
    (await svc(`SELECT author_id FROM public.task_comments WHERE task_id = $1`, [t]))[0]?.author_id === edT &&
    (await svc(`SELECT user_id FROM public.time_entries WHERE task_id = $1`, [t]))[0]?.user_id === edT);
  record('...without sending notifications again', (await svc(`SELECT count(*)::int n FROM public.notifications WHERE workspace_id = $1`, [wsT]))[0].n === notesBefore);
  record('the trash marks the batch restored, by whom', (await svc(`SELECT count(*)::int n FROM public.trash_items WHERE batch = $1 AND restored_by = $2`, [batch, pmT]))[0].n === trash.length);
  r = await as(pmT, `SELECT public.restore_trash_batch($1, $2)`, [batch, wsT]);
  record('a batch cannot be restored twice', !!r.error);

  // a video deleted on its own, whose list was then deleted too: restoring only the video skips it
  const t2 = (await as(pmT, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'Alone') RETURNING id`, [lT])).rows[0]?.id;
  await as(oT, `DELETE FROM public.tasks WHERE id = $1`, [t2]);
  const b2 = (await svc(`SELECT batch FROM public.trash_items WHERE item_id = $1`, [t2]))[0].batch;
  await as(oT, `DELETE FROM public.lists WHERE id = $1`, [lT]);
  r = await as(pmT, `SELECT public.restore_trash_batch($1, $2) AS res`, [b2, wsT]);
  record('a video whose list is gone is skipped and counted, not half-restored', !r.error && r.rows[0]?.res?.skipped >= 1 && r.rows[0]?.res?.restored === 0, r.error?.message ?? JSON.stringify(r.rows[0]?.res));
  r = await svc(`SELECT prosecdef FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND proname = 'restore_trash_batch'`);
  record('the public restore function runs with the caller\'s rights', r[0]?.prosecdef === false);
}

console.log('\n== Smooth moves: no link or note asked ==');
{
  const oM = await mkUser('sm-owner@tbb.test', {}, true);
  const edM = await mkUser('sm-editor@tbb.test', {}, true);
  const qcM = await mkUser('sm-qc@tbb.test', {}, true);
  const wsM = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('SM','sm-smooth',$1) RETURNING id`, [oM]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'EDITOR'), ($1,$3,'QC_SPECIALIST') ON CONFLICT DO NOTHING`, [wsM, edM, qcM]);
  // what migration 40 did to the existing workspace, applied to this new one
  await svc(`UPDATE public.workflow_statuses s SET requires_review_link = false, requires_final_export = false, requires_note = false FROM public.workflows w WHERE w.id = s.workflow_id AND w.workspace_id = $1`, [wsM]);
  const spM = (await as(oM, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsM])).rows[0]?.id;
  const lM = (await as(oM, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spM])).rows[0]?.id;
  const tM = (await as(oM, `INSERT INTO public.tasks (list_id, title) VALUES ($1,'v') RETURNING id`, [lM])).rows[0]?.id;
  await svc(`INSERT INTO public.task_assignees (task_id, role_type, user_id) VALUES ($1,'EDITOR',$2)`, [tM, edM]);
  for (const step of ['IN_EDIT', 'ASSIGNED']) await as(oM, `SELECT public.transition_task($1, $2)`, [tM, step]);
  await as(edM, `SELECT public.transition_task($1, 'STARTED_EDITING')`, [tM]);
  r = await as(edM, `SELECT public.transition_task($1, 'QC_FIRST_APPROVAL')`, [tM]);
  record('the editor sends a cut to QC without any link', !r.error, r.error?.message);
  record('...and QC is still assigned automatically', (await svc(`SELECT user_id FROM public.task_assignees WHERE task_id = $1 AND role_type = 'QC_REVIEWER'`, [tM]))[0]?.user_id === qcM);
  r = await as(qcM, `SELECT public.transition_task($1, 'QC_REVISION_NEEDED')`, [tM]);
  record('QC requests a revision without writing a note', !r.error, r.error?.message);
  record('...which still counts as a revision', (await svc(`SELECT revision_count FROM public.tasks WHERE id = $1`, [tM]))[0].revision_count === 1);
  r = await as(edM, `SELECT public.transition_task($1, 'QC_FINAL_APPROVAL')`, [tM]);
  record('the editor resubmits without a link', !r.error, r.error?.message);
  await as(qcM, `SELECT public.transition_task($1, 'QC_APPROVED_RTD')`, [tM]);
  r = await as(qcM, `SELECT public.transition_task($1, 'SENT_TO_CLIENT')`, [tM]);
  record('QC delivers without a final export link', !r.error, r.error?.message);
}

console.log('\n== Customize: status editor ==');
{
  const oS = await mkUser('se-owner@tbb.test', {}, true);
  const adS = await mkUser('se-admin@tbb.test', {}, true);
  const pmS = await mkUser('se-pm@tbb.test', {}, true);
  const edS = await mkUser('se-editor@tbb.test', {}, true);
  const wsS = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('SE','se-status',$1) RETURNING id`, [oS]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'ADMIN'), ($1,$3,'PRODUCTION_MANAGER'), ($1,$4,'EDITOR') ON CONFLICT DO NOTHING`, [wsS, adS, pmS, edS]);
  const wfS = (await svc(`SELECT id FROM public.workflows WHERE workspace_id = $1 AND is_default`, [wsS]))[0].id;
  r = await as(adS, `UPDATE public.workflow_statuses SET name = 'EDITING', color = '#123456', position = 30 WHERE workflow_id = $1 AND key = 'STARTED_EDITING' RETURNING name`, [wfS]);
  record('an admin renames, recolours and re-orders a status', !r.error && r.rows[0]?.name === 'EDITING', r.error?.message);
  r = await as(pmS, `UPDATE public.workflow_statuses SET name = 'X' WHERE workflow_id = $1 AND key = 'IN_EDIT' RETURNING key`, [wfS]);
  record('a production manager cannot edit statuses', !!r.error || r.rows.length === 0);
  r = await as(edS, `UPDATE public.workflow_statuses SET name = 'X' WHERE workflow_id = $1 AND key = 'IN_EDIT' RETURNING key`, [wfS]);
  record('an editor cannot edit statuses', !!r.error || r.rows.length === 0);
  r = await as(adS, `UPDATE public.workflow_statuses SET key = 'RENAMED' WHERE workflow_id = $1 AND key = 'IN_EDIT'`, [wfS]);
  record('a status key can never change', !!r.error);
  r = await as(adS, `UPDATE public.workflow_statuses SET requires_note = true WHERE workflow_id = $1 AND key = 'IN_EDIT'`, [wfS]);
  record('the rule flags stay system-owned', !!r.error);
  r = await as(oS, `INSERT INTO public.workflow_statuses (workflow_id, key, name, category, color, position) VALUES ($1,'COLOR_GRADING','COLOR GRADING','IN_PROGRESS','#8B5CF6',35)`, [wfS]);
  record('the owner adds a new status', !r.error, r.error?.message);
  r = await as(oS, `INSERT INTO public.workflow_transitions (workflow_id, from_key, to_key, label, kind, roles) VALUES ($1,'STARTED_EDITING','COLOR_GRADING','Send to grading','forward',ARRAY['OWNER','ADMIN','EDITOR'])`, [wfS]);
  record('...and a move into it, with the roles that may make it', !r.error, r.error?.message);
  r = await as(edS, `INSERT INTO public.workflow_transitions (workflow_id, from_key, to_key, label, kind, roles) VALUES ($1,'COLOR_GRADING','CLOSED','Skip','forward',ARRAY['EDITOR'])`, [wfS]);
  record('an editor cannot add moves', !!r.error);
  const spS = (await as(oS, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsS])).rows[0]?.id;
  const lS = (await as(oS, `INSERT INTO public.lists (space_id, name) VALUES ($1,'L') RETURNING id`, [spS])).rows[0]?.id;
  await svc(`INSERT INTO public.tasks (workspace_id, list_id, title, status) VALUES ($1,$2,'in grading','COLOR_GRADING')`, [wsS, lS]);
  r = await as(adS, `DELETE FROM public.workflow_statuses WHERE workflow_id = $1 AND key = 'COLOR_GRADING'`, [wfS]);
  record('a status that holds tasks cannot be deleted', r.error?.code === '23503', r.error?.message ?? 'was deleted');
  await svc(`UPDATE public.tasks SET status = 'STARTED_EDITING' WHERE workspace_id = $1`, [wsS]);
  r = await as(adS, `DELETE FROM public.workflow_statuses WHERE workflow_id = $1 AND key = 'COLOR_GRADING' RETURNING key`, [wfS]);
  record('...once empty it can, and its moves go with it', !r.error && r.rows.length === 1 && (await svc(`SELECT count(*)::int n FROM public.workflow_transitions WHERE workflow_id = $1 AND (to_key = 'COLOR_GRADING' OR from_key = 'COLOR_GRADING')`, [wfS]))[0].n === 0, r.error?.message);
  r = await as(adS, `DELETE FROM public.workflow_statuses WHERE workflow_id = $1 AND key = 'TO_BE_EDITED'`, [wfS]);
  record('the starting status cannot be deleted', !!r.error);
  r = await as(adS, `DELETE FROM public.workflow_statuses WHERE workflow_id = $1 AND key = 'QC_FIRST_APPROVAL'`, [wfS]);
  record('the production-credit stage cannot be deleted', !!r.error);
  r = await as(adS, `UPDATE public.workflow_statuses SET name = 'X' WHERE workflow_id = $1 RETURNING key`, [(await svc(`SELECT id FROM public.workflows WHERE workspace_id <> $1 LIMIT 1`, [wsS]))[0].id]);
  record('an admin cannot touch another workspace\'s statuses', !!r.error || r.rows.length === 0);
}

console.log('\n== Phase 12e: list templates ==');
{
  const oT = await mkUser('t-owner@tbb.test', {}, true);
  const pmT = await mkUser('t-pm@tbb.test', {}, true);
  const edT = await mkUser('t-editor@tbb.test', {}, true);
  const clT = await mkUser('t-client@tbb.test', {}, true);
  const wsT = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('T','t-tpl',$1) RETURNING id`, [oT]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'PRODUCTION_MANAGER'), ($1,$3,'EDITOR'), ($1,$4,'CLIENT_VIEWER') ON CONFLICT DO NOTHING`, [wsT, pmT, edT, clT]);
  const spT = (await as(oT, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsT])).rows[0]?.id;
  const src = (await as(oT, `INSERT INTO public.lists (space_id, name) VALUES ($1,'25. EDAPTX') RETURNING id`, [spT])).rows[0]?.id;
  const v1 = (await as(pmT, `SELECT (public.create_task($1, 'Hook video', 'Fast cuts, captions', 'HIGH', '9:16')).id AS id`, [src])).rows[0]?.id;
  await as(pmT, `SELECT (public.create_task($1, 'Long form', NULL, 'MEDIUM', '16:9')).id`, [src]);
  await svc(`INSERT INTO public.subtasks (task_id, title, position) VALUES ($1,'Rough cut',0), ($1,'Captions',1)`, [v1]);

  r = await as(edT, `SELECT public.save_list_as_template($1, 'Std', NULL)`, [src]);
  record('an editor cannot save a template', !!r.error);
  r = await as(clT, `SELECT public.save_list_as_template($1, 'Std', NULL)`, [src]);
  record('a client viewer cannot save a template', !!r.error);
  r = await as(pmT, `SELECT (public.save_list_as_template($1, 'Client starter', 'Two standard videos')).id AS id`, [src]);
  const tpl = r.rows[0]?.id;
  record('a manager saves a list as a template', !r.error && !!tpl, r.error?.message);
  r = await svc(`SELECT jsonb_array_length(items) AS n, items -> 0 ->> 'title' AS t0, items -> 0 -> 'subtasks' AS subs FROM public.list_templates WHERE id = $1`, [tpl]);
  record('...with both videos, their order and the first video\'s subtasks', r[0].n === 2 && r[0].t0 === 'Hook video' && JSON.stringify(r[0].subs) === '["Rough cut","Captions"]', JSON.stringify(r[0]));
  r = await as(pmT, `SELECT public.save_list_as_template($1, ' client STARTER ', NULL)`, [src]);
  record('a duplicate name is refused (case-insensitive)', !!r.error);
  r = await as(edT, `SELECT id FROM public.list_templates`);
  record('staff can read templates', !r.error && r.rows.length === 1);
  r = await as(clT, `SELECT id FROM public.list_templates`);
  record('a client viewer sees no templates', !r.error && r.rows.length === 0);

  const dest = (who, name = 'New client') => as(who, `SELECT (public.create_list_from_template($1, $2, NULL, $3)).id AS id`, [tpl, spT, name]);
  r = await dest(edT);
  record('an editor cannot create a list from a template', !!r.error);
  r = await dest(pmT);
  const newList = r.rows[0]?.id;
  record('a manager creates a list from the template', !r.error && !!newList, r.error?.message);
  r = await svc(`SELECT title, priority, aspect_ratio, status FROM public.tasks WHERE list_id = $1 ORDER BY position, created_at`, [newList]);
  record('...with the standard videos, priorities and aspect ratios, all at the first stage',
    r.length === 2 && r[0].title === 'Hook video' && r[0].priority === 'HIGH' && r[0].aspect_ratio === '9:16' && r.every((x) => x.status === 'TO_BE_EDITED'), JSON.stringify(r));
  r = await svc(`SELECT count(*)::int AS n FROM public.subtasks st JOIN public.tasks t ON t.id = st.task_id WHERE t.list_id = $1`, [newList]);
  record('...and the subtasks', r[0].n === 2);
  r = await svc(`SELECT count(*)::int AS n FROM public.task_assignees a JOIN public.tasks t ON t.id = a.task_id WHERE t.list_id = $1`, [newList]);
  record('...but no people, dates or links are copied', r[0].n === 0);

  // another workspace's template cannot be used
  const wsU = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('U','u-tpl',$1) RETURNING id`, [oT]))[0].id;
  const spU = (await as(oT, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsU])).rows[0]?.id;
  r = await as(oT, `SELECT public.create_list_from_template($1, $2, NULL, 'Cross')`, [tpl, spU]);
  record('a template cannot be used in another workspace', !!r.error);

  r = await as(pmT, `DELETE FROM public.list_templates WHERE id = $1 RETURNING id`, [tpl]);
  record('a manager deletes a template', !r.error && r.rows.length === 1);
  r = await svc(`SELECT count(*)::int AS n FROM public.tasks WHERE list_id = $1`, [newList]);
  record('...lists already created from it are untouched', r[0].n === 2);
  r = await as('anon', `SELECT id FROM public.list_templates`);
  record('anon cannot read templates', !!r.error);
}

console.log('\n== Phase 14: KPI report ==');
{
  const oK = await mkUser('k-owner@tbb.test', {}, true);
  const adK = await mkUser('k-admin@tbb.test', {}, true);
  const pmK = await mkUser('k-pm@tbb.test', {}, true);
  const edK = await mkUser('k-editor@tbb.test', {}, true);
  const wsK = (await svc(`INSERT INTO public.workspaces (name, slug, owner_id) VALUES ('K','k-kpi',$1) RETURNING id`, [oK]))[0].id;
  await svc(`INSERT INTO public.workspace_members (workspace_id, user_id, role) VALUES ($1,$2,'ADMIN'), ($1,$3,'PRODUCTION_MANAGER'), ($1,$4,'EDITOR') ON CONFLICT DO NOTHING`, [wsK, adK, pmK, edK]);
  const spK = (await as(oK, `INSERT INTO public.spaces (workspace_id, name, slug) VALUES ($1,'S','s') RETURNING id`, [wsK])).rows[0]?.id;
  const lA = (await as(oK, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Client A') RETURNING id`, [spK])).rows[0]?.id;
  const lB = (await as(oK, `INSERT INTO public.lists (space_id, name) VALUES ($1,'Client B') RETURNING id`, [spK])).rows[0]?.id;
  // three credited videos: A twice (2 and 0 revisions, 10 h and 30 h turnaround), B once (1 revision, 20 h), all this week
  await svc(`SET session_replication_role = replica`);
  const mk = async (list, rev, hours) => {
    const t = (await svc(`INSERT INTO public.tasks (workspace_id, list_id, title, revision_count, created_at) VALUES ($1,$2,'k',$3, now() - make_interval(hours => $4::int)) RETURNING id`, [wsK, list, rev, hours]))[0].id;
    await svc(`INSERT INTO public.task_production_credits (task_id, workspace_id, editor_id, first_qc_submitted_at) VALUES ($1,$2,$3, now())`, [t, wsK, edK]);
    return t;
  };
  await mk(lA, 2, 10); await mk(lA, 0, 30); await mk(lB, 1, 20);
  await svc(`SET session_replication_role = origin`);
  const kpi = (who, w = wsK, weeks = 4, tz = 'UTC') => as(who, `SELECT public.kpi_report($1, $2, $3) AS k`, [w, weeks, tz]);

  r = await kpi(oK);
  const k = r.rows[0]?.k;
  record('the owner gets the report', !r.error && !!k, r.error?.message);
  record('...totals: 3 videos, 1 revision on average', k?.totals.videos === 3 && Number(k.totals.avgRevisions) === 1, JSON.stringify(k?.totals));
  record('...turnaround: average 20 h, median 20 h', Number(k?.turnaround.avgHours) === 20 && Number(k.turnaround.medianHours) === 20, JSON.stringify(k?.turnaround));
  record('...weekly: four zero-filled weeks, the three videos in the last one', k?.weekly.length === 4 && k.weekly.reduce((n, w) => n + w.videos, 0) === 3 && k.weekly[3].videos === 3, JSON.stringify(k?.weekly));
  record('...clients: A first with 2 videos (1 revision on average), then B', k?.clients[0]?.name === 'Client A' && k.clients[0].videos === 2 && Number(k.clients[0].avgRevisions) === 1 && k.clients[1]?.name === 'Client B', JSON.stringify(k?.clients));
  r = await kpi(adK);
  record('an admin gets the same numbers', !r.error && r.rows[0].k.totals.videos === 3);
  r = await kpi(pmK);
  record('a production manager gets an empty report (credits are owner / admin only)', !r.error && r.rows[0].k.totals.videos === 0 && r.rows[0].k.clients.length === 0, JSON.stringify(r.rows[0]?.k?.totals));
  r = await kpi(edK);
  record('an editor gets an empty report', !r.error && r.rows[0].k.totals.videos === 0);
  r = await kpi(stranger, wsK);
  record('a non-member is refused', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await kpi(oK, wsB);
  record('another workspace is refused', r.error?.code === '42501', r.error?.message ?? 'was allowed');
  r = await kpi(oK, wsK, 4, 'Mars/Phobos');
  record('an unknown time zone is refused', r.error?.code === '22023', r.error?.message ?? 'was allowed');
  r = await kpi(oK, wsK, 9999);
  record('the window is capped at 52 weeks', !r.error && r.rows[0].k.weekly.length === 52);
  r = await as('anon', `SELECT public.kpi_report($1, 4, 'UTC')`, [wsK]);
  record('anon cannot call it', !!r.error);
  r = await svc(`SELECT prosecdef FROM pg_proc WHERE proname = 'kpi_report'`);
  record('it runs with the caller\'s rights', r[0]?.prosecdef === false);
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
{
  const rest = await svc(`SELECT (SELECT count(*) FROM public.task_comments WHERE workspace_id = $1) c, (SELECT count(*) FROM public.task_attachments WHERE workspace_id = $1) a,
    (SELECT count(*) FROM public.task_activity WHERE workspace_id = $1) h, (SELECT count(*) FROM public.notifications WHERE workspace_id = $1) n`, [ws]);
  record('deleting the whole workspace cascades through comments, attachments, activity and notifications without error',
    r.rows.length === 1 && ['c', 'a', 'h', 'n'].every((k) => Number(rest[0][k]) === 0), JSON.stringify(rest[0]));
}

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
