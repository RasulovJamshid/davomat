param([Parameter(Mandatory=$true)][string]$BackupFile,[string]$ComposeFile="compose.yml",[switch]$ConfirmRestore)
$ErrorActionPreference="Stop"
if(-not $ConfirmRestore){throw "Restore replaces database contents. Re-run with -ConfirmRestore."}
$resolved=(Resolve-Path -LiteralPath $BackupFile).Path
Get-Content -Raw -LiteralPath $resolved | docker compose -f $ComposeFile exec -T db sh -c 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
if($LASTEXITCODE -ne 0){throw "Database restore failed."}
Write-Output "Restore completed from $resolved"
