# Atlas Workforce

Atlas is a workforce operations app for employee records, attendance, exception
review, scheduling, and explainable payroll. It combines a React web app with a
secured Node API and PostgreSQL database.

## Included

- JWT login with rate limiting, session invalidation after password changes, and role-aware manager endpoints
- Expiring, single-use password-reset links with enumeration-safe recovery responses
- Company-scoped employees, locations, departments, shifts, punches, exceptions,
  payroll periods, payslips, adjustments, and manager audit logs
- Persistent People directory, employee onboarding, full profile editing, status control,
  search, and CSV export
- Live Overview and Attendance workspaces with daily/weekly totals, manual clock events,
  exception resolution, and CSV export
- Audited attendance-exception approvals and rejections with required manager notes
- Geofence-aware attendance status calculation
- Weekly scheduling with filters, editable draft/published shifts, overlap protection,
  copy-week, cancellation, coverage warnings, and publishing
- Payroll-period generation, attendance basis, auditable adjustments, individual/batch
  approvals, paid-period closing, CSV export, and printable payslips
- Company, editable department/work-location, geofence, currency, timezone, leave,
  correction-window, payroll-tax-policy, and password setup
- Persistent or browser-session login selected by the user
- Responsive employee self-service for mobile clocking, breaks, published schedules,
  approved payslips, and correction requests
- Manager-controlled employee login provisioning, credential resets, and SMTP invitation delivery
- Approved employee corrections atomically create the requested timesheet event
- Employee leave requests with configurable annual balance, date-overlap protection,
  pending-request cancellation, request history, manager review, coverage warnings,
  and attendance integration
- Persistent role-aware notifications with per-user read state and workspace deep links
- Active SMTP email delivery plus truthful Telegram/device readiness based on server-side secrets
- Persistent English, Uzbek, and Russian language selection across login, manager
  navigation, notifications, attendance, leave, employee-directory and payroll
  workspaces, plus employee navigation
- Database migrations, safe development seed, and production admin bootstrap
- Docker development and production stacks with health checks
- Nginx SPA hosting and same-origin API proxy in production
- Unit tests, dependency update automation, and a GitHub Actions verification workflow
- Vendor-neutral biometric, face-terminal, kiosk, and turnstile event ingestion with hashed device keys, liveness enforcement, identity mapping, and idempotency
- Availability, employee shift swaps with acceptance and manager approval, and recurring schedule materialization
- Advanced payroll rules for overtime, night and holiday premiums, dated rates, benefits, pension deductions, employer contributions, and calculation breakdowns
- Scheduled CSV/JSON reports plus server-generated attendance, payroll, accounting, and audit exports
- Locale-aware API errors in English, Uzbek, and Russian

Terminal setup and webhook contract: [docs/DEVICE_INTEGRATION.md](docs/DEVICE_INTEGRATION.md).

## Fastest development setup

Requirements: Docker Desktop with Compose v2.

```bash
docker compose -f compose.dev.yml up --build
```

Open `http://localhost:5173` and sign in with:

```text
admin@atlas.local
ChangeMe123!
```

Employee self-service demo:

```text
employee@atlas.local
ChangeMe123!
```

The dev stack exposes the web app on `5173`, API on `4000`, and PostgreSQL on
`5433` (`DEV_DB_PORT` can override it). Source folders are mounted for hot reload.
Stop it with:

```bash
docker compose -f compose.dev.yml down
```

Add `-v` only when you intentionally want to delete the development database.

## Run without Docker

Start PostgreSQL, create an `atlas` database, then:

```bash
npm install
npm --prefix server install
copy server\.env.example server\.env
npm --prefix server run migrate
npm --prefix server run seed
npm run dev
```

On macOS/Linux, use `cp` instead of `copy`. The web app runs on
`http://localhost:5173`; the API runs on `http://localhost:4000`.

## Production deployment

1. Copy `.env.example` to `.env`.
2. Replace every placeholder password/secret and set the public origin.
   Set `APP_PUBLIC_URL`, `EMAIL_FROM`, and `SMTP_URL` to enable invitations and password recovery.
3. Build and start the private database, API, and public web container.
4. Create the initial company administrator once.

```bash
docker compose up -d --build
docker compose run --rm api npm run bootstrap:prod
docker compose ps
```

Open `https://brandfaces.uz`. The browser calls the production API at
`https://api.brandfaces.uz/api`; see `docs/DEPLOYMENT.md` for DNS and TLS proxy
setup. Sign in using
`SEED_ADMIN_EMAIL` and `SEED_ADMIN_PASSWORD`, then rotate that initial password
before onboarding the team. Keep `RUN_SEED=false` in production; the seed is demo
data, while `bootstrap:prod` creates only the company and first administrator.

Put the service behind an HTTPS reverse proxy or load balancer in any internet-
accessible deployment. PostgreSQL and the API are intentionally not published by
the production Compose file.

See [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) for backups, restores, upgrades,
health checks, and production hardening.

## Commands

```bash
npm run dev          # web + API, requires a configured local PostgreSQL
npm run test:all     # frontend and API unit tests
npm run test:e2e     # Chromium desktop/mobile workflows; dev stack must be running
npm run build:all    # production TypeScript and Vite builds
npm run check        # type-check both applications
npm run docker:dev   # Docker development stack
npm run docker:prod  # Docker production stack
./scripts/backup.ps1 # timestamped PostgreSQL backup (PowerShell)
```

## API surface

All application routes live below `/api` and require a bearer token except login
and the rate-limited password-recovery endpoints.

- `POST /api/auth/login`, `POST /api/auth/forgot-password`,
  `POST /api/auth/reset-password`, `GET /api/auth/me`, `PATCH /api/auth/password`
- `GET /api/dashboard`, `GET /api/meta`
- `GET|POST /api/employees`, `PATCH /api/employees/:id`
- `GET /api/attendance`, `POST /api/attendance/reconcile`
- `GET /api/exceptions`, `PATCH /api/exceptions/:id`
- `POST /api/punches`, `GET /api/employees/:id/punches`,
  `PATCH|DELETE /api/punches/:id`
- `GET /api/me/workspace`, `POST /api/me/punches`, `POST /api/me/corrections`
- `POST /api/employees/:id/account`
- `GET|POST /api/shifts`, `PATCH /api/shifts/:id`, `PATCH /api/shifts/:id/cancel`
- `POST /api/shifts/copy-week`, `POST /api/shifts/publish`
- `GET /api/payroll`
- `POST /api/payroll/periods`, `POST /api/payroll/periods/:id/approve-ready`,
  `POST /api/payroll/periods/:id/mark-paid`
- `POST /api/payroll/periods/:id/recalculate`
- `POST /api/payroll/:id/adjustments`
- `PATCH /api/payroll/:id/approve`
- `PATCH /api/company`, `POST /api/departments`, `PATCH /api/departments/:id`,
  `POST /api/locations`, `PATCH /api/locations/:id`
- `GET /api/audit`
- `GET /api/leaves`, `PATCH /api/leaves/:id`, `POST /api/me/leaves`,
  `PATCH /api/me/leaves/:id/cancel`
- `GET /api/notifications`, `POST /api/notifications/read`
- `GET /live`, `GET /health`

Errors use `{ "error": { "message": "...", "fields": { ... } }`. Mutating
manager operations validate input and scope referenced records to the logged-in
company.
