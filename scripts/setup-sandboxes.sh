#!/usr/bin/env bash
# ==============================================================================
# DevCollab - POSIX setup script (Bash)
# Verifies prerequisites, starts PostgreSQL + Redis via docker compose,
# and builds the hardened sandbox runner images.
# Run:  bash scripts/setup-sandboxes.sh
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

write_step() { echo -e "\n\033[0;36m==> $1\033[0m"; }
fail() { echo -e "\033[0;31mERROR: $1\033[0m" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || fail "Docker is not installed or not on PATH. Please install Docker and retry."

write_step "Checking Docker engine"
docker info >/dev/null 2>&1 || fail "Docker engine is not reachable. Start Docker daemon and retry."

write_step "Preparing local environment file"
if [ ! -f "${REPO_ROOT}/.env" ]; then
    cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
    echo "Created .env from .env.example"
else
    echo ".env already exists - left untouched"
fi

write_step "Starting PostgreSQL 16 and Redis 7 (docker compose up -d --wait)"
docker compose up -d --wait || fail "docker compose failed to start backing services. Check docker compose logs."

write_step "Building hardened sandbox runner images"
docker build -f docker/sandboxes/Dockerfile.node -t devcollab-runner-node:latest . || fail "Failed to build devcollab-runner-node:latest"
docker build -f docker/sandboxes/Dockerfile.python -t devcollab-runner-python:latest . || fail "Failed to build devcollab-runner-python:latest"

write_step "Installing workspace dependencies"
npm install || fail "npm install failed."

write_step "Generating Prisma client"
npm run db:generate --workspace=@devcollab/server || fail "Prisma client generation failed."

write_step "Deploying database schema"
npm run db:deploy --workspace=@devcollab/server || fail "Database migration failed."

write_step "Seeding database with demo project & starter files"
npm run db:seed --workspace=@devcollab/server || fail "Database seeding failed."

write_step "Building all workspace packages"
npm run build || fail "Workspace build failed."

echo -e "\n\033[0;32mSetup complete.\033[0m"
echo "Backing services:"
docker compose ps
echo -e "\nDevCollab is ready! Run:  npm run dev   ->   open http://localhost:5173"
