// Sends the invitation e-mail for a person an Owner / Admin has just invited (or invites again).
//
// The invitation itself is a normal row in workspace_invitations created by the app with the caller's own rights
// (RLS decides who may invite). This function only sends the e-mail: it checks that the caller is an Owner / Admin
// of the workspace and that a PENDING invitation exists for that address, then asks Supabase Auth to e-mail the
// person a link ("Accept the invitation") that lets them set a password and sign in. Their invitation is claimed
// automatically once the address is confirmed, exactly as for people who register by themselves.
//
// It needs no extra secret: SUPABASE_URL, SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY are provided by the
// platform. The e-mail goes out through the project's mail settings (Authentication > SMTP in Supabase).
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);
  const auth = req.headers.get('Authorization');
  if (!auth) return json({ error: 'Sign in first.' }, 401);

  let body: { workspaceId?: string; email?: string; redirectTo?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Bad request.' }, 400);
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!body.workspaceId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'A workspace and a valid e-mail are required.' }, 400);

  const url = Deno.env.get('SUPABASE_URL')!;
  const caller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } });
  const { data: who, error: whoError } = await caller.auth.getUser();
  if (whoError || !who.user) return json({ error: 'Your session has expired. Sign in again.' }, 401);

  const me = await caller.from('workspace_members').select('role').eq('workspace_id', body.workspaceId).eq('user_id', who.user.id).maybeSingle();
  if (!me.data || !['OWNER', 'ADMIN'].includes(me.data.role)) return json({ error: 'Only owners and admins can send invitations.' }, 403);

  // only for a pending invitation that exists for this workspace (readable by the caller through RLS)
  const inv = await caller.from('workspace_invitations').select('id, role, accepted_at').eq('workspace_id', body.workspaceId).eq('email', email).is('accepted_at', null).maybeSingle();
  if (!inv.data) return json({ error: 'There is no pending invitation for that address.' }, 404);

  const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } });
  const { error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: body.redirectTo });
  if (error) {
    // an address that already has an account is simply told to sign in: its invitation is claimed at sign-in
    if (/already|registered|exists/i.test(error.message)) return json({ sent: false, reason: 'already-registered' });
    return json({ sent: false, reason: 'mail-failed', detail: error.message }, 200);
  }
  return json({ sent: true });
});
