# ==============================================================================
# DevCollab - Windows setup script (PowerShell)
# Verifies prerequisites, starts PostgreSQL + Redis via docker compose,
# and builds the hardened sandbox runner images.
# Run:  powershell -NoProfile -ExecutionPolicy Bypass -File scripts/setup-sandboxes.ps1
# ==============================================================================

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Always operate from the repo root, regardless of where the script is invoked.
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot  = Split-Path -Parent $scriptDir
Set-Location $repoRoot

function Write-Step { param([string]$Message) Write-Host "`n==> $Message" -ForegroundColor Cyan }
function Fail       { param([string]$Message) Write-Host "ERROR: $Message" -ForegroundColor Red; exit 1 }

if ($null -eq (Get-Command docker -ErrorAction SilentlyContinue)) {
    Fail 'Docker is not installed or not on PATH. Install Docker Desktop for Windows (Linux containers mode) and retry.'
}

# Docker Desktop must actually be running before any command will succeed.
Write-Step 'Checking Docker engine'
docker info *> $null
if ($LASTEXITCODE -ne 0) {
    Fail 'Docker engine is not reachable. Start Docker Desktop and wait for it to report running, then re-run this script.'
}

if ($null -eq (Get-Command docker-compose -ErrorAction SilentlyContinue) -and
    (docker compose version *> $null; $LASTEXITCODE -ne 0)) {
    Fail 'Docker Compose is not available. Update Docker Desktop (Compose V2 is bundled) and retry.'
}

Write-Step 'Preparing local environment file'
if (-not (Test-Path (Join-Path $repoRoot '.env'))) {
    Copy-Item (Join-Path $repoRoot '.env.example') (Join-Path $repoRoot '.env')
    Write-Host 'Created .env from .env.example'
} else {
    Write-Host '.env already exists - left untouched'
}

Write-Step 'Starting PostgreSQL 16 and Redis 7 (docker compose up -d --wait)'
docker compose up -d --wait
if ($LASTEXITCODE -ne 0) { Fail 'docker compose failed to start backing services. Check docker compose logs.' }

Write-Step 'Building hardened sandbox runner images'
# These images are the only execution environments for user-submitted code:
# non-root UID 10001, read-only rootfs, no network, capped memory/CPU/PIDs.
docker build -f docker/sandboxes/Dockerfile.node   -t devcollab-runner-node:latest   .
if ($LASTEXITCODE -ne 0) { Fail 'Failed to build devcollab-runner-node:latest' }

docker build -f docker/sandboxes/Dockerfile.python -t devcollab-runner-python:latest .
if ($LASTEXITCODE -ne 0) { Fail 'Failed to build devcollab-runner-python:latest' }

Write-Step 'Installing workspace dependencies'
npm install
if ($LASTEXITCODE -ne 0) { Fail 'npm install failed.' }

Write-Step 'Generating Prisma client'
npm run db:generate --workspace=@devcollab/server
if ($LASTEXITCODE -ne 0) { Fail 'Prisma client generation failed.' }

Write-Step 'Deploying database schema'
npm run db:deploy --workspace=@devcollab/server
if ($LASTEXITCODE -ne 0) { Fail 'Database migration failed.' }

Write-Step 'Seeding database with demo project & starter files'
npm run db:seed --workspace=@devcollab/server
if ($LASTEXITCODE -ne 0) { Fail 'Database seeding failed.' }

Write-Step 'Building all workspace packages'
npm run build
if ($LASTEXITCODE -ne 0) { Fail 'Workspace build failed.' }

Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host 'Backing services:'
docker compose ps
Write-Host "`nDevCollab is ready! Run:  npm run dev   ->   open http://localhost:5173"
