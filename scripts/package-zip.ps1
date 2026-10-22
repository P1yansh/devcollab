# ==============================================================================
# DevCollab - Windows packaging script (PowerShell)
# 1. Runs full verification (npm run build, npm test).
# 2. Ensures .env exists (copied from .env.example).
# 3. Stages the repo (excluding node_modules, build outputs, caches, volumes)
#    and compresses it into devcollab-release.zip. A pre-populated .env with
#    local-only demo credentials (localhost Postgres/Redis) ships inside the
#    zip so the recipient needs no manual configuration step.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/package-zip.ps1
#      Add -SkipVerify to skip the build/test gates (not recommended).
# ==============================================================================

[CmdletBinding()]
param(
    [switch]$SkipVerify
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
Set-Location $repoRoot

$zipPath  = Join-Path $repoRoot 'devcollab-release.zip'
$stageDir = Join-Path ([System.IO.Path]::GetTempPath()) ('devcollab-stage-' + [Guid]::NewGuid().ToString('N'))

# Directory names excluded from the archive. robocopy /XD matches by name.
$excludeDirs = @(
    'node_modules', 'dist', 'build', '.turbo', '.vite',
    'coverage', 'playwright-report', 'test-results', 'artifacts',
    'volumes', 'pgdata', 'redisdata', '.git', '.opencode'
)
# .env is intentionally INCLUDED in the zip (local demo credentials only);
# .env.local, AGENTS.md and machine-local secrets stay excluded.
$excludeFiles = @('.env.local', '*.log', 'devcollab-release.zip', 'AGENTS.md')

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Fail       { param([string]$Message) Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

try {
    if (-not (Test-Path (Join-Path $repoRoot 'package-lock.json'))) {
        Fail 'package-lock.json is missing. The release zip must ship a lockfile - run npm install first.'
    }

    if (-not $SkipVerify) {
        Write-Step 'Running full build'
        npm run build
        if ($LASTEXITCODE -ne 0) { Fail 'npm run build failed - fix build errors before packaging.' }

        Write-Step 'Running test suite'
        npm test
        if ($LASTEXITCODE -ne 0) { Fail 'npm test failed - fix failing tests before packaging.' }
    } else {
        Write-Host 'Skipping verification gate (-SkipVerify).' -ForegroundColor Yellow
    }

    Write-Step 'Ensuring .env exists locally'
    if (-not (Test-Path (Join-Path $repoRoot '.env'))) {
        Copy-Item (Join-Path $repoRoot '.env.example') (Join-Path $repoRoot '.env')
        Write-Host 'Created .env from .env.example'
    }

    Write-Step "Staging repo -> $stageDir"
    # robocopy exits 0-7 on success (1 = files copied) and >=8 on failure,
    # so do not treat every non-zero code as an error here.
    robocopy $repoRoot $stageDir /E /XD @excludeDirs /XF @excludeFiles | Out-Null
    if ($LASTEXITCODE -ge 8) { Fail "robocopy failed with exit code $LASTEXITCODE" }
    $LASTEXITCODE = 0

    # Retain packages/shared/dist so recipient has compiled contracts ready out-of-the-box
    $sharedDistSrc = Join-Path $repoRoot (Join-Path 'packages' (Join-Path 'shared' 'dist'))
    $sharedDistDest = Join-Path $stageDir (Join-Path 'packages' (Join-Path 'shared' 'dist'))
    if (Test-Path $sharedDistSrc) {
        New-Item -ItemType Directory -Path $sharedDistDest -Force | Out-Null
        Copy-Item (Join-Path $sharedDistSrc '*') -Destination $sharedDistDest -Recurse -Force
    }

    Write-Step "Creating $zipPath"
    if (Test-Path $zipPath) {
        Remove-Item $zipPath -Force
        Write-Host 'Removed pre-existing devcollab-release.zip'
    }
    Compress-Archive -Path (Join-Path $stageDir '*') -DestinationPath $zipPath -CompressionLevel Optimal
    if ($LASTEXITCODE -ne 0) { Fail 'Compress-Archive failed.' }

    $sizeMb = [math]::Round((Get-Item $zipPath).Length / 1MB, 2)
    Write-Host "`nPackage created: devcollab-release.zip ($sizeMb MB)" -ForegroundColor Green
    Write-Host 'Recipient needs: Node 20+ and Docker Desktop for Windows (Linux containers mode).'
} finally {
    if (Test-Path $stageDir) {
        Remove-Item $stageDir -Recurse -Force
        Write-Host 'Cleaned up staging directory'
    }
}
