# Weekly schedules

On web and native mobile, open **Schedule → Weekly schedules → Set weekly schedule**.
Choose **Everyone**, leave **Monday–Friday**, set **09:00–18:00**, choose a start date and **Save & activate**.
Leave the optional end date blank to continue indefinitely. No weekly copy, generation or publication step is required.

Department, assigned location and individual employee scopes are also supported. New active employees matching a group are included on the next automatic refresh (within one hour while the API is running). Use Calendar for a one-off shift or a change to an existing shift. An unpaid break is optional: 09:00–18:00 is nine hours without a break, or eight paid hours with a 60-minute unpaid break.

## Rules and exceptions

- An individual schedule overrides a group schedule, including its days off. Department/location rules override Everyone. The most recently updated rule wins between department and location rules.
- Overlapping active rules for the same scope are rejected; edit the existing rule or give the new rule a nonoverlapping effective period.
- Saving, editing or pausing reconciles future untouched generated shifts. Started work, recorded punches, manual shifts and edited/cancelled days are preserved. Pausing a personal rule allows a matching group rule to apply again.
- Creation never backfills work that has already started. Historical attendance and salary calculations are not rewritten.
- Automatic shifts are published immediately. Legacy/manual drafts remain drafts and still need explicit publication from Calendar.
- If an existing shift conflicts, it is preserved and automatic generation skips it. Saving reports the number of shifts created and existing shifts/exceptions retained.

## Implementation and upgrade

Apply migration **020_unified_weekly_schedules.sql** before running this version. Both clients use authenticated manager-only `/api/work-schedules` (GET, POST, PUT `/:id`, DELETE `/:id` to pause).

`recurring_schedules` is the canonical store. The former native `schedule_templates` table is archived and imported; a compatibility view and legacy routes keep older clients usable. Imported rules start with automatic publication disabled: review and activate them in Weekly schedules. Existing shifts are preserved.

The API starts the scheduler after migrations and refreshes it hourly. It fills through the end of the current month plus the next two months, then extends that horizon automatically. The API must remain running; after downtime it resumes at startup without backfilling past shifts. Database row locks serialize workers and rule edits per company. Overlap checks, exclusions and the shift exclusion constraint prevent duplicates. Generation uses the company's timezone.

Generated shifts record their rule/date. A database trigger records manual edits/cancellations as persistent exceptions; worker transactions bypass that trigger. Automatic batch writes suppress per-shift pushes, while a rule save queues a summary notification for affected employees. No production deployment is part of this change.

## Verification

- `npm run check`, `npm run test:all`, `npm run build`.
- With an isolated migrated database: `node server/scripts/test-weekly-schedules.mjs` and `node server/scripts/test-workforce.mjs`.
- Web UI: `npx playwright test e2e/weekly-schedules.spec.ts --output tmp/weekly-ui-results` against a running Vite instance. Mocked UI contracts cover setup/edit/pause at desktop and phone sizes; the database script verifies actual generation and authorization.
- Native: `flutter analyze`, `flutter test`; `weekly_schedule_test.dart` covers save payloads and localized narrow-screen navigation. Android debug compilation verifies packaging; physical-device and iOS validation remain separate.
