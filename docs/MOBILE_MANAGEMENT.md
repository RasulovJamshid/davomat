# Native management completion

The Flutter project is in `D:/Projects/clockmanagement-mobile`. API migration `019_mobile_management.sql` adds recurring schedules, collaboration records, file storage, responses, comments, notification devices and a durable push outbox. Apply migrations before using the updated app. Production deployment is deliberately deferred at the user's request.

## Workflows

- **Manage → Recurring schedules**, also available from Schedule: select an employee/location, weekdays, local start/end times, unpaid break and grace period. Generate drafts for a selected range (maximum one year), then publish them in Schedule. Overnight shifts use the company time zone. Repeating generation skips identical shifts; any other overlap rolls back the entire operation. Deleting a template preserves existing shifts.
- **Team → employee → Employee overview**: salary basis, completed work hours, planned hours, overtime, lateness, absences and estimated salary for today/week/month, today's punches, upcoming shifts and assigned tasks. Open reports for arbitrary periods.
- **Overview**: current attendance and total employees, active/completed tasks, monthly worked hours and salary estimate. Estimates use the full month's published schedule and are distinct from approved payroll, taxes and premiums.
- **Reports → Excel / PDF**: generate actual `.xlsx` / `.pdf` files and use the device's save/share sheet. Exports cover the selected period and employee scope, including scheduled/actual days, hours, lateness, absence, overtime, completed tasks and estimated pay. Numeric spreadsheet cells remain numeric; employee names are text even when they start with `=`. PDF fonts are bundled for offline Cyrillic rendering.
- **Manage / employee More → Workplace**: announcements with read acknowledgments; company discussions with comments; assigned or company-wide checklists with per-user completion; surveys with one replaceable answer per user and aggregate counts; documents with authenticated download/share and read acknowledgments; employee trip requests with destination/date validation and manager decisions. Managers can close/reopen responses and review participation. Employees can create discussions and their own trip requests. Files are limited to 2 MB (PDF, PNG/JPEG, TXT, DOCX, XLSX).
- **Workplace → Notifications**: persisted updates from assigned tasks, published shift changes, request decisions and newly created workplace items. Reading notification history works without Firebase.

## Push configuration (deferred)

Push delivery is disabled by default. Code is integrated, but real delivery requires a Firebase project and device configuration. No credentials or production account settings have been invented.

Server: set `PUSH_ENABLED=true` and `GOOGLE_APPLICATION_CREDENTIALS` to an external Firebase service-account JSON file (or use an environment with Application Default Credentials). Do not commit private keys. The API starts an outbox worker every 15 seconds; it retries transient failures with backoff, drops invalid tokens, and retains notification history. Delivery is at least once: a retry after a partial send can repeat a notification. Pending delivery is limited to seven days; failed events remain available in the inbox.

Flutter build configuration (via an untracked `--dart-define-from-file` JSON):

```json
{
  "API_URL": "https://YOUR-API/api",
  "PUSH_ENABLED": true,
  "FIREBASE_API_KEY": "YOUR-FIREBASE-WEB-API-KEY",
  "FIREBASE_PROJECT_ID": "YOUR-PROJECT",
  "FIREBASE_SENDER_ID": "YOUR-SENDER-ID",
  "FIREBASE_ANDROID_APP_ID": "YOUR-ANDROID-FIREBASE-APP-ID",
  "FIREBASE_IOS_APP_ID": "YOUR-IOS-FIREBASE-APP-ID",
  "FIREBASE_IOS_BUNDLE_ID": "YOUR-IOS-BUNDLE-ID"
}
```

Users opt in from Workplace. Token rotation and logout unregistering are handled. Background notifications use FCM notification payloads; tapping opens the app's notification history. Apple delivery also requires the Push Notifications capability, APNs credentials and a matching provisioning profile; iOS builds/device validation require macOS. See the official [Flutter Firebase setup](https://firebase.google.com/docs/flutter/setup) and [FCM client setup](https://firebase.google.com/docs/cloud-messaging/flutter/get-started).

## Verification

- `npm run check` and `npm run test:all`.
- `node server/scripts/test-workforce.mjs` after building the API, against an isolated migrated test database. Covers employee/company isolation, role enforcement, recurring generation and collisions, employee summaries, checklist responses, survey vote replacement, protected document downloads, trip approvals and the notification inbox in addition to attendance/task/payroll regression cases.
- Flutter `analyze`, `test` and Android debug compilation. `test/workplace_test.dart` covers narrow-screen localized layouts, persisted response calls, permission visibility, shared-company form validation, profiles, error recovery and export contents.
- Real Firebase delivery, Apple signing, store submission and production deployment are deferred, not represented as tested.
