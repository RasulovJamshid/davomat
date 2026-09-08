# Deployment runbook

## Environment

The production web application is published at `https://brandfaces.uz` and the
REST API at `https://api.brandfaces.uz/api`. Create `.env` beside `compose.yml`.
Use long, unique values for
`POSTGRES_PASSWORD`, `JWT_SECRET`, and `SEED_ADMIN_PASSWORD`. `JWT_SECRET` must be
at least 32 characters. Set `CORS_ORIGINS` to the exact HTTPS origin users will
open. Keep both `PUBLIC_PORT` and `API_PUBLIC_PORT` bound to loopback as defined
in Compose; only ports 80 and 443 on the TLS proxy should be public.

Set `APP_PUBLIC_URL` to that same public HTTPS origin. Configure `SMTP_URL` and
`EMAIL_FROM` for employee invitations and password-reset links. Without SMTP,
development writes mail contents to the API log; production deliberately reports
delivery as unavailable and never exposes reset tokens in an HTTP response.

The included `deploy/Caddyfile` terminates TLS and forwards the two domains to
the loopback-only Docker ports. Create DNS `A`/`AAAA` records for
`brandfaces.uz`, `www.brandfaces.uz`, and `api.brandfaces.uz` pointing to the
deployment server, install Caddy, and place the file at `/etc/caddy/Caddyfile`.
The production Compose file exposes the web service on `127.0.0.1:8080` and the
API on `127.0.0.1:4000`; neither service should be opened directly in the public
firewall.

Do not enable `RUN_SEED` in production. It loads representative demo employees,
shifts, punches, exceptions, and payroll. Use the one-time bootstrap command from
the README to create a clean company and administrator.

After signing in as the initial administrator, create employee profiles in People.
Open a profile and use **Employee login** to assign a unique email and temporary
password. Share temporary credentials through an approved secure channel and ask
employees to change the password after first sign-in.

Managers should review the default 21-day annual-leave allowance and local holiday
policy before rollout. Atlas currently counts approved annual leave on weekdays;
organization-specific accrual and public-holiday policies should be configured as
a separate policy extension when required.

## Health checks

```bash
docker compose ps
curl --fail http://127.0.0.1:8080/healthz
curl --fail http://127.0.0.1:4000/health
curl --fail https://brandfaces.uz/healthz
curl --fail https://api.brandfaces.uz/health
```

The API container separately checks `/health`, including database connectivity.
Compose waits for PostgreSQL and the API before considering dependent services
ready.

Use `/live` for process liveness and `/health` for database-backed readiness.
Alert when readiness fails repeatedly and forward structured API logs to durable
storage without recording credentials or reset tokens.

## Backup

Create the backup directory first. The following produces a portable SQL dump:

```bash
docker compose exec -T db pg_dump -U atlas --clean --if-exists atlas > backups/atlas-$(date +%F-%H%M).sql
```

Use the configured `POSTGRES_USER` and `POSTGRES_DB` when they differ. Encrypt
backups at rest, copy them off the application host, and test restores regularly.

PowerShell example:

```powershell
$stamp = Get-Date -Format 'yyyyMMdd-HHmm'
docker compose exec -T db pg_dump -U atlas --clean --if-exists atlas | Set-Content -Encoding utf8 "backups/atlas-$stamp.sql"
```

The repository script performs the same operation with a timestamped filename:

```powershell
.\scripts\backup.ps1
```

## Restore

Restores replace data. Verify the target stack and backup filename before running:

```bash
cat backups/atlas.sql | docker compose exec -T db psql -U atlas -d atlas
```

Stop API traffic during a full restore to prevent concurrent writes.
On PowerShell, use `.\scripts\restore.ps1 -BackupFile <path> -ConfirmRestore`;
the explicit switch prevents accidental restores.

## Upgrade

```bash
docker compose build --pull
docker compose up -d
docker compose ps
docker compose logs --tail=100 api web
```

The API applies versioned migrations before accepting traffic. Back up the
database before upgrading and keep the previous image tags available for rollback.

## Production hardening checklist

- Terminate TLS with a managed load balancer, Caddy, Traefik, or host Nginx.
- Store `.env` outside source control and restrict its file permissions.
- Replace the bootstrap password after first login.
- Pin reviewed image/dependency versions during release management.
- Forward container logs to durable storage and alert on unhealthy services.
- Schedule encrypted PostgreSQL backups with retention and restore drills.
- Add transactional email/SMS credentials before enabling real invitations.
- Review local privacy and employment requirements before using biometrics.
