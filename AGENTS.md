# Kookapp — agent & developer runbook

Personal Dutch cooking app: **Expo + SQLite + Claude**. Full product and technical spec: **`kookapp_plan_v2.html`** (open it in a browser or `@`-mention it in Cursor).

## Quick orientation

| Topic | Where |
|--------|--------|
| Feature order, prompts, schema | `kookapp_plan_v2.html` |
| Cursor always-on rules | `.cursor/rules/kookapp-product.mdc` |
| DB / Claude details when editing `lib/` etc. | `.cursor/rules/kookapp-data-ai.mdc` |
| Suggested app layout | Plan section “Projectstructuur” |
| Geplande follow-ups (o.a. versies terugzetten) | `kookapp_plan_v2.html` → «Functies — bouwvolgorde» → items met badge **later** |

## Commands

From the project root:

- Dev: `npm start` (or `npx expo start`)
- Typecheck: `npm run typecheck`

## How to run an agent task (good habits)

1. **One milestone** — e.g. “Alleen feature 1 uit het plan: …” with 3–6 acceptance bullets copied from the plan.
2. **Discovery first** — “Zoek wat er al bestaat; hergebruik; geen dubbele DB-laag.”
3. **Attach context** — `@kookapp_plan_v2.html` and only the files you expect to touch.
4. **Verify** — Ask for typecheck/lint and a short manual test list (device or emulator).

## Git

Use small commits per feature (e.g. `feat: handmatig recept + kookweergave`). Makes agent follow-up and rollback safe.

## Backwards compatibility (V1 → V1.x) — conscious, not accidental

This app currently has a single user (you), so **breaking changes are allowed**. The goal is simply:

- **No accidental breakage** of stored data/exports.
- If something might break old data or exports, **make it a conscious choice** and **mention it in the change/release note** (e.g. “Data reset required” or “Old exports not supported”).

### DB contract (SQLite)

- Keep `DB_NAME` stable: `kook.db` (`lib/db.ts`).
- Keep incremental migrations via `schema_version` in `app_meta` (`lib/db.ts`).
- Do **not** wipe user data silently. If a reset is required, ship an explicit “reset data” action + note it.
- Avoid dropping/renaming columns without a migration/backfill path.

### Persisted keys contract

These values/keys are part of the persisted surface area:

- **SQLite file**: `kook.db`
- **DB meta table**: `app_meta`
- **Current `app_meta` key space**:
  - `schema_version`
  - `ai_active_key_id`
  - `ai_model_preset_<provider>`
  - `ai_model_custom_<provider>`
  - (and similar prefixes for other prefs; treat renames as migrations)

Rule of thumb: if you want to rename/remove a persisted key, do it in 2 steps:

- First release: migrate old → new (keep reading old if needed).
- Later release: delete old key / cleanup once you’re sure it’s safe.

### Export/import contract (if/when exporting)

If you export data for backup/share, include an explicit version:

- `export_version: 1`

and keep this guarantee:

- V1.x can import V1 exports, unless you explicitly decide otherwise and document it.
