# Phase 12 (first slice): custom fields

Migration `20260930000017_custom_fields.sql`. Purely additive: `tasks`, `search_tasks` and `create_task` are unchanged.

## What it is

Per-workspace extra fields on tasks, for what TBB's ClickUp tasks carry and the task table does not
("A) Link to the Raw Video", "HOOK VARIATION", "Video Format Needed", ...). Types: `text`, `url`, `number`,
`dropdown`, `date`.

- `custom_fields`: the definitions (name, type, dropdown choices, position). Name is 1-60 characters and unique per
  workspace ignoring case. At most 50 per workspace (trigger, serialised per workspace). A dropdown has 1-30
  distinct, non-empty choices of at most 60 characters; any other type has no choices.
- `custom_field_values`: one row per (task, field) that has a value. An empty field has no row: clients delete
  instead of storing null; a null / empty value is refused by the database.

## Value rules (enforced by `guard_custom_field_value`, mirrored in `src/lib/custom-fields.ts`)

| Type | Valid value |
|---|---|
| text | string, 1-2000 characters |
| url | http(s) link, at most 2048 characters (same pattern as the task link checks) |
| number | a finite JSON number |
| dropdown | a string that is one of the field's current choices |
| date | a real calendar day written `YYYY-MM-DD` |

The workspace is taken from the task, the field must belong to the same workspace, `updated_by` is the signed-in
person and `updated_at` the server's time. `task_id`, `field_id` and `workspace_id` cannot change.

## Permissions

| | Owner / Admin / Prod. Manager | QC specialist | Editor | Client viewer |
|---|---|---|---|---|
| Read definitions and values | yes | yes | yes | no |
| Create / rename / re-order / delete fields | yes | no | no | no |
| Set / change / clear a value | any task | any task | only tasks assigned to them as editor | no |

Values reuse `private.can_attach_to_task` (the same rule as attaching files). The interface capability is
`fields:manage` (managers) for the Settings section; `canEditFieldValue` mirrors the value rule. RLS is the real
enforcement. Grants: nothing for `anon`, no TRUNCATE; signed-in people get select / insert / delete, plus UPDATE
only on `name, options, position` (definitions) and `value` (values).

## Behaviour worth knowing

- The field **type cannot be changed** after creation (guard trigger; a column grant also withholds it).
- Removing a dropdown choice that is in use is allowed. Stored values are not rewritten and stay readable; they are
  re-checked only when someone changes that value (the sheet shows such a value until it is changed).
- Deleting a field deletes its values on every task (cascade); the Settings dialog says how many. Deleting a task
  deletes its values.
- Saving a value from the app updates the existing row, else inserts (no upsert, because the update grant is
  limited to `value`).

## Interface

- Task detail sheet: a "Fields" section (hidden when the workspace has no fields), inline editors by type, saves
  on blur / Enter / pick with rollback and a message on refusal, read-only text for people who cannot edit, and a
  "Hide empty fields" toggle.
- Settings: "Custom fields" for Owner / Admin / Production Manager: add, rename, edit choices, move up / down, delete.

## Known limitations

- No search, filter, sort or board/table column on custom fields yet; no activity entry when a value changes.
- Re-ordering writes one update per field (up to 50), not atomically.
- The 50-field limit and name uniqueness are checked on the client from the loaded list as well as in the database.
- No field-level permissions, required fields, default values, multi-select or per-list fields.
