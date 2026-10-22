import { createClient } from '@supabase/supabase-js';
import { getSupabaseClient } from './client';
import { getDatabaseConfig } from './config';
import { ValidationError, toDatabaseError } from './errors';
import type { CustomFieldType } from '@/types/database';

/**
 * Client brief forms (migration 33). Managers keep forms here; the public page reads one form and sends one brief
 * with its own anonymous client that carries the form's token as the x-brief-token header (the database lets that
 * header read exactly one form and insert briefs for it, nothing else).
 */
export interface BriefField {
  id: string;
  name: string;
  type: CustomFieldType;
  options: string[] | null;
  required: boolean;
}

export interface BriefForm {
  id: string;
  listId: string;
  token: string;
  title: string;
  intro: string | null;
  fields: BriefField[];
  enabled: boolean;
  submissionCount: number;
}

export interface PublicBriefForm {
  id: string;
  title: string;
  intro: string | null;
  fields: BriefField[];
}

export interface BriefSubmission {
  id: string;
  taskId: string | null;
  title: string;
  contactName: string | null;
  contactEmail: string | null;
  createdAt: string;
}

// the generated types predate migration 33
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = () => getSupabaseClient() as unknown as { from: (table: string) => any };

type FormRow = { id: string; list_id: string; token: string; title: string; intro: string | null; fields: BriefField[]; enabled: boolean; submission_count: number };
const mapForm = (r: FormRow): BriefForm => ({
  id: r.id, listId: r.list_id, token: r.token, title: r.title, intro: r.intro, fields: Array.isArray(r.fields) ? r.fields : [], enabled: r.enabled, submissionCount: r.submission_count,
});

export async function listBriefForms(workspaceId: string): Promise<BriefForm[]> {
  const { data, error } = await db().from('brief_forms').select('*').eq('workspace_id', workspaceId).order('created_at');
  if (error) throw toDatabaseError('load the brief forms', error);
  return ((data ?? []) as FormRow[]).map(mapForm);
}

export async function createBriefForm(workspaceId: string, input: { listId: string; title: string; intro: string; fieldIds: string[] }): Promise<void> {
  if (!input.title.trim()) throw new ValidationError('Give the form a title.');
  if (!input.listId) throw new ValidationError('Pick the client list the briefs go to.');
  const { error } = await db()
    .from('brief_forms')
    .insert({ workspace_id: workspaceId, list_id: input.listId, title: input.title.trim(), intro: input.intro.trim() || null, fields: input.fieldIds });
  if (error) throw toDatabaseError('create the form', error);
}

export async function updateBriefForm(id: string, patch: { enabled?: boolean; title?: string; intro?: string | null; fieldIds?: string[] }): Promise<void> {
  const row: Record<string, unknown> = {};
  if (patch.enabled !== undefined) row.enabled = patch.enabled;
  if (patch.title !== undefined) row.title = patch.title.trim();
  if (patch.intro !== undefined) row.intro = patch.intro;
  if (patch.fieldIds !== undefined) row.fields = patch.fieldIds;
  const { error } = await db().from('brief_forms').update(row).eq('id', id);
  if (error) throw toDatabaseError('change the form', error);
}

export async function deleteBriefForm(id: string): Promise<void> {
  const { error } = await db().from('brief_forms').delete().eq('id', id);
  if (error) throw toDatabaseError('delete the form', error);
}

export async function listBriefSubmissions(formId: string): Promise<BriefSubmission[]> {
  const { data, error } = await db().from('brief_submissions').select('id,task_id,title,contact_name,contact_email,created_at').eq('form_id', formId).order('created_at', { ascending: false }).limit(50);
  if (error) throw toDatabaseError('load the briefs', error);
  return ((data ?? []) as { id: string; task_id: string | null; title: string; contact_name: string | null; contact_email: string | null; created_at: string }[]).map((r) => ({
    id: r.id, taskId: r.task_id, title: r.title, contactName: r.contact_name, contactEmail: r.contact_email, createdAt: r.created_at,
  }));
}

/** The public page's own client: anonymous, no stored session, the token as a header. */
function publicClient(token: string) {
  const config = getDatabaseConfig();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { headers: { 'x-brief-token': token } },
  }) as unknown as { from: (table: string) => any }; // eslint-disable-line @typescript-eslint/no-explicit-any
}

export async function getPublicBriefForm(token: string): Promise<PublicBriefForm | null> {
  if (!/^[0-9a-f]{64}$/.test(token)) return null;
  const { data, error } = await publicClient(token).from('brief_forms').select('id,title,intro,fields').maybeSingle();
  if (error) throw toDatabaseError('open the form', error);
  return data ? { id: data.id, title: data.title, intro: data.intro, fields: Array.isArray(data.fields) ? data.fields : [] } : null;
}

export async function submitBrief(
  token: string,
  input: { formId: string; title: string; brief: string; contactName: string; contactEmail: string; answers: Record<string, unknown> }
): Promise<void> {
  const { error } = await publicClient(token)
    .from('brief_submissions')
    .insert({
      form_id: input.formId,
      title: input.title.trim(),
      brief: input.brief.trim() || null,
      contact_name: input.contactName.trim() || null,
      contact_email: input.contactEmail.trim() || null,
      answers: input.answers,
    });
  if (error) throw toDatabaseError('send the brief', error);
}

export const briefLink = (token: string) => `${window.location.origin}/brief/${token}`;
