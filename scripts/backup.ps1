param([string]$ComposeFile="compose.yml",[string]$OutputDirectory="backups")
$ErrorActionPreference="Stop"
$target=[System.IO.Path]::GetFullPath((Join-Path (Get-Location) $OutputDirectory))
$workspace=[System.IO.Path]::GetFullPath((Get-Location).Path)
if(-not $target.StartsWith($workspace,[System.StringComparison]::OrdinalIgnoreCase)){throw "Backup directory must be inside the project workspace."}
New-Item -ItemType Directory -Force -Path $target | Out-Null
$stamp=Get-Date -Format "yyyyMMdd-HHmmss"
$output=Join-Path $target "atlas-$stamp.sql"
docker compose -f $ComposeFile exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" --clean --if-exists "$POSTGRES_DB"' | Set-Content -Encoding utf8 -LiteralPath $output
if($LASTEXITCODE -ne 0){throw "Database backup failed."}
Write-Output $output
