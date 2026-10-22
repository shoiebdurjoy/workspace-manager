// One-time setup of the Supabase Auth settings TBB needs: Google sign-in, the site address and redirect URLs, and the
// e-mail service that sends invitations and confirmation mails. It talks to the Supabase Management API with YOUR
// personal access token. Nothing is printed except what will change (secrets are shown as ****).
//
//   1. Create an access token: Supabase dashboard > your avatar > Account > Access Tokens > Generate new token.
//   2. Set values in your own terminal (they stay on your computer; never paste them into a chat):
//
//      PowerShell:
//        $env:SUPABASE_ACCESS_TOKEN = "sbp_..."
//        $env:SITE_URL = "https://workspace-manager-five.vercel.app"
//        $env:GOOGLE_CLIENT_ID = "....apps.googleusercontent.com"     # optional, from Google Cloud > Credentials
//        $env:GOOGLE_CLIENT_SECRET = "GOCSPX-..."                       # optional
//        $env:SMTP_HOST = "smtp.resend.com"; $env:SMTP_PORT = "465"      # optional (Resend example)
//        $env:SMTP_USER = "resend"; $env:SMTP_PASS = "re_..."
//        $env:SMTP_FROM = "noreply@your-domain.com"; $env:SMTP_FROM_NAME = "TBB Workspace"
//
//   3. node scripts/supabase-auth-setup.mjs            (shows what would change)
//      node scripts/supabase-auth-setup.mjs --apply    (changes it)
//
// Only the settings you provide are touched; everything else stays as it is.
const REF = 'twiqrozhzglpqkuilmdb';
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const apply = process.argv.includes('--apply');
if (!TOKEN) {
  console.error('Set SUPABASE_ACCESS_TOKEN first (see the comment at the top of this file).');
  process.exit(2);
}
const env = (k) => (process.env[k] ?? '').trim();
const base = `https://api.supabase.com/v1/projects/${REF}/config/auth`;
const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

const current = await fetch(base, { headers });
if (!current.ok) {
  console.error(`Could not read the auth settings (${current.status}). Check the access token.`);
  process.exit(1);
}
const now = await current.json();

const patch = {};
const site = env('SITE_URL').replace(/\/+$/, '');
if (site) {
  patch.site_url = site;
  const allow = new Set(String(now.uri_allow_list ?? '').split(',').map((x) => x.trim()).filter(Boolean));
  for (const u of [`${site}/**`, 'http://localhost:8080/**']) allow.add(u);
  patch.uri_allow_list = [...allow].join(',');
}
if (env('GOOGLE_CLIENT_ID') && env('GOOGLE_CLIENT_SECRET')) {
  patch.external_google_enabled = true;
  patch.external_google_client_id = env('GOOGLE_CLIENT_ID');
  patch.external_google_secret = env('GOOGLE_CLIENT_SECRET');
}
if (env('SMTP_HOST') && env('SMTP_USER') && env('SMTP_PASS') && env('SMTP_FROM')) {
  patch.smtp_host = env('SMTP_HOST');
  patch.smtp_port = env('SMTP_PORT') || '465';
  patch.smtp_user = env('SMTP_USER');
  patch.smtp_pass = env('SMTP_PASS');
  patch.smtp_admin_email = env('SMTP_FROM');
  patch.smtp_sender_name = env('SMTP_FROM_NAME') || 'TBB Workspace';
  patch.smtp_max_frequency = 5;
}
if (Object.keys(patch).length === 0) {
  console.log('Nothing to change: set at least SITE_URL, or the Google or SMTP values (see the top of this file).');
  console.log(`Right now: Google ${now.external_google_enabled ? 'ON' : 'OFF'}, site ${now.site_url}, own SMTP ${now.smtp_host ? 'set (' + now.smtp_host + ')' : 'NOT set'}.`);
  process.exit(0);
}
const shown = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, /secret|pass/.test(k) ? '****' : v]));
console.log(apply ? 'Applying:' : 'Would change (add --apply to do it):', JSON.stringify(shown, null, 2));
if (!apply) process.exit(0);

const res = await fetch(base, { method: 'PATCH', headers, body: JSON.stringify(patch) });
if (!res.ok) {
  console.error(`The change was refused (${res.status}): ${(await res.text()).slice(0, 300)}`);
  process.exit(1);
}
const after = await (await fetch(base, { headers })).json();
console.log(`Done. Google ${after.external_google_enabled ? 'ON' : 'OFF'}, site ${after.site_url}, own SMTP ${after.smtp_host ? 'set (' + after.smtp_host + ')' : 'NOT set'}.`);
