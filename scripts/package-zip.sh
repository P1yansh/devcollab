#!/usr/bin/env bash
# ==============================================================================
# DevCollab - POSIX packaging script (Bash)
# 1. Runs full verification (npm run build, npm test).
# 2. Ensures .env exists (copied from .env.example).
# 3. Stages the repo (excluding node_modules, build outputs, caches, volumes)
#    and compresses it into devcollab-release.zip. A pre-populated .env with
#    local-only demo credentials (localhost Postgres/Redis) ships inside the
#    zip so the recipient needs no manual configuration step.
# Run:  bash scripts/package-zip.sh [--skip-verify]
# ==============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_ROOT}"

SKIP_VERIFY=0
for arg in "$@"; do
    if [ "$arg" == "--skip-verify" ] || [ "$arg" == "-SkipVerify" ]; then
        SKIP_VERIFY=1
    fi
done

write_step() { echo -e "\n\033[0;36m==> $1\033[0m"; }
fail() { echo -e "\033[0;31mERROR: $1\033[0m" >&2; exit 1; }

ZIP_PATH="${REPO_ROOT}/devcollab-release.zip"
STAGE_DIR="$(mktemp -d /tmp/devcollab-stage-XXXXXX)"

cleanup() {
    if [ -d "${STAGE_DIR}" ]; then
        rm -rf "${STAGE_DIR}"
        echo "Cleaned up staging directory"
    fi
}
trap cleanup EXIT

[ -f "${REPO_ROOT}/package-lock.json" ] || fail "package-lock.json is missing. The release zip must ship a lockfile - run npm install first."

if [ "$SKIP_VERIFY" -eq 0 ]; then
    write_step "Running full build"
    npm run build || fail "npm run build failed - fix build errors before packaging."

    write_step "Running test suite"
    npm test || fail "npm test failed - fix failing tests before packaging."
else
    echo -e "\033[0;33mSkipping verification gate (--skip-verify).\033[0m"
fi

write_step "Ensuring .env exists locally"
if [ ! -f "${REPO_ROOT}/.env" ]; then
    cp "${REPO_ROOT}/.env.example" "${REPO_ROOT}/.env"
    echo "Created .env from .env.example"
fi

write_step "Staging repo -> ${STAGE_DIR}"
# Copy everything respecting exclusions
rsync -a --delete \
    --exclude='node_modules' \
    --exclude='dist' \
    --exclude='build' \
    --exclude='.turbo' \
    --exclude='.vite' \
    --exclude='coverage' \
    --exclude='playwright-report' \
    --exclude='test-results' \
    --exclude='artifacts' \
    --exclude='volumes' \
    --exclude='pgdata' \
    --exclude='redisdata' \
    --exclude='.env.local' \
    --exclude='*.log' \
    --exclude='.git' \
    --exclude='.opencode' \
    --exclude='AGENTS.md' \
    --exclude='devcollab-release.zip' \
    "${REPO_ROOT}/" "${STAGE_DIR}/" || fail "Failed to stage repository"

# Retain packages/shared/dist so recipient has compiled contracts ready out-of-the-box
if [ -d "${REPO_ROOT}/packages/shared/dist" ]; then
    mkdir -p "${STAGE_DIR}/packages/shared/dist"
    cp -r "${REPO_ROOT}/packages/shared/dist/"* "${STAGE_DIR}/packages/shared/dist/"
fi

write_step "Creating ${ZIP_PATH}"
rm -f "${ZIP_PATH}"

python3 -c "
import shutil, sys
stage_dir = sys.argv[1]
zip_base = sys.argv[2].replace('.zip', '')
shutil.make_archive(zip_base, 'zip', stage_dir)
" "${STAGE_DIR}" "${ZIP_PATH}" || fail "Failed to create release zip archive"

SIZE_BYTES=$(wc -c < "${ZIP_PATH}")
SIZE_MB=$(python3 -c "print(f'{${SIZE_BYTES} / (1024 * 1024):.2f}')")
echo -e "\n\033[0;32mPackage created: devcollab-release.zip (${SIZE_MB} MB)\033[0m"
echo "Recipient needs: Node 20+ and Docker Desktop for Windows (Linux containers mode)."
