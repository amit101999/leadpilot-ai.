<#
.SYNOPSIS
  Runs the /upwork-sync agent headless (for Windows Task Scheduler or by hand).

.DESCRIPTION
  Starts `claude -p "/upwork-sync"` from the repository root with only the tools the agent needs,
  prevents overlapping runs with a lock file, and appends the output to logs\upwork-sync.log.
  LeadPilot itself decides which profiles are due; with -Scheduled it returns none while
  UPWORK_SYNC_SCHEDULED_ALLOWED is not "true" in LeadPilot's .env.

.EXAMPLE
  powershell -NoProfile -ExecutionPolicy Bypass -File scripts\upwork-sync.ps1 -Scheduled
#>
param([switch]$Scheduled)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

New-Item -ItemType Directory -Force -Path "logs", ".upwork-sync" | Out-Null
$log = Join-Path $root "logs\upwork-sync.log"
$lock = Join-Path $root ".upwork-sync\sync.lock"

function Write-Log([string]$message) {
  "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $message" | Out-File -FilePath $log -Append -Encoding utf8
}

# A previous sync still running (or a crashed one less than 2 hours old) blocks this one.
if (Test-Path $lock) {
  if ((Get-Item $lock).LastWriteTime -gt (Get-Date).AddHours(-2)) {
    Write-Log "Skipped: another sync is running (lock file present)."
    exit 0
  }
  Remove-Item $lock -Force
}
Set-Content -Path $lock -Value $PID -Encoding ascii

$allowedTools = @(
  "mcp__claude_ai_Upwork__upwork__list_accounts",
  "mcp__claude_ai_Upwork__upwork__find_jobs",
  "Bash(node scripts/leadpilot-import.mjs:*)",
  "Read(./.upwork-sync/**)",
  # Edit rules cover every file-writing tool (Write included).
  "Edit(./.upwork-sync/**)"
) -join ","

$prompt = if ($Scheduled) { "/upwork-sync --scheduled" } else { "/upwork-sync" }
try {
  Write-Log "Sync started ($prompt)."
  # Native stderr (warnings) must not become terminating errors; the exit code decides success.
  $ErrorActionPreference = "Continue"
  $output = & claude -p $prompt --allowedTools $allowedTools 2>&1
  $code = $LASTEXITCODE
  $output | Out-File -FilePath $log -Append -Encoding utf8
  Write-Log "Sync finished with exit code $code."
  exit $code
} catch {
  Write-Log "Sync failed: $($_.Exception.Message)"
  exit 1
} finally {
  Remove-Item $lock -Force -ErrorAction SilentlyContinue
}
