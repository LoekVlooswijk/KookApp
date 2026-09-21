# Release checklist (Kookapp)

Run **`npm run verify`** before tagging or shipping a store build. CI runs the same command on push/PR.

## Always

- [ ] `npm run verify` passes locally (typecheck, lint, Prettier check, tests).
- [ ] Smoke the app on a device or emulator: open recepten, planner, import (if touched), kennisbank (if touched).

## Database / `lib/dbMigrations.ts` or `lib/db.ts`

- [ ] Fresh install: app starts and reaches the latest `schema_version` without crash.
- [ ] Upgrade: install previous build, add data, install new build — no crash; critical lists still load.
- [ ] New migration number is registered and runs inside a transaction (see `MIGRATIONS` in `lib/dbMigrations.ts`).

## Import / AI (if those flows changed)

- [ ] With API key: representative import or AI action succeeds.
- [ ] Offline: AI-dependent actions are disabled or show a short Dutch explanation; local-only flows still work.
- [ ] Invalid model JSON does not corrupt stored recipes; user sees a clear Dutch error.

## Patches / native

- [ ] If `patches/` changed: note it in your release notes; reinstall deps (`npm ci`) on CI matched locally.

## Store / EAS

- [ ] Version/build numbers follow your usual EAS flow (`eas.json` / `app.json`).
