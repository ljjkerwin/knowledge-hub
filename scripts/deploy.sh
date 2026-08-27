#!/usr/bin/env bash

# Build locally, then publish the production artifacts to a remote PM2 host.
#
# Deployment settings are read from .env.deploy.local at the project root.
# Required in that file:
#   DEPLOY_TARGET=deploy@example.com
#
# Optional:
#   BACKEND_PM2_NAME=knowledge-hub-backend
#   FRONTEND_PM2_NAME=knowledge-hub-frontend
#   FRONTEND_PORT=5001
#   APP_NAME=knowledge-hub

set -euo pipefail

readonly PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly DEPLOY_CONFIG_FILE="${DEPLOY_CONFIG_FILE:-${PROJECT_ROOT}/scripts/.env.deploy.local}"

if [[ ! -f "${DEPLOY_CONFIG_FILE}" ]]; then
  echo "Deployment configuration not found: ${DEPLOY_CONFIG_FILE}" >&2
  exit 1
fi

set -a
# shellcheck source=/dev/null
source "${DEPLOY_CONFIG_FILE}"
set +a

readonly DEPLOY_TARGET="${DEPLOY_TARGET:?Set DEPLOY_TARGET in ${DEPLOY_CONFIG_FILE}}"
readonly DEPLOY_PATH="${DEPLOY_PATH:-/data/deploy}"
readonly APP_NAME="${APP_NAME:-$(basename "${PROJECT_ROOT}")}"
readonly BACKEND_PM2_NAME="${BACKEND_PM2_NAME:-knowledge-hub-backend}"
readonly FRONTEND_PM2_NAME="${FRONTEND_PM2_NAME:-knowledge-hub-frontend}"
readonly FRONTEND_PORT="${FRONTEND_PORT:-5001}"

if [[ "${APP_NAME}" == *"/"* || "${APP_NAME}" == "." || "${APP_NAME}" == ".." ]]; then
  echo "APP_NAME must be a single directory name: ${APP_NAME}" >&2
  exit 1
fi

require_command() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing required local command: $1" >&2
    exit 1
  }
}

copy_if_exists() {
  local source_path="$1"
  local destination_dir="$2"

  if [[ -e "${source_path}" ]]; then
    cp -R "${source_path}" "${destination_dir}/"
  fi
}

require_command pnpm
require_command ssh
require_command scp
require_command tar

echo "==> Preparing application environment files"
if [[ ! -f "${PROJECT_ROOT}/scripts/.env.backend.local" ]]; then
  echo "Backend environment file not found: ${PROJECT_ROOT}/scripts/.env.backend.local" >&2
  exit 1
fi

if [[ ! -f "${PROJECT_ROOT}/scripts/.env.frontend.local" ]]; then
  echo "Frontend environment file not found: ${PROJECT_ROOT}/scripts/.env.frontend.local" >&2
  exit 1
fi

cp "${PROJECT_ROOT}/scripts/.env.backend.local" "${PROJECT_ROOT}/backend/.env"
cp "${PROJECT_ROOT}/scripts/.env.frontend.local" "${PROJECT_ROOT}/frontend/.env"

echo "==> Building backend"
(
  cd "${PROJECT_ROOT}/backend"
  pnpm run build
)

echo "==> Building frontend"
(
  cd "${PROJECT_ROOT}/frontend"
  pnpm run build
)

mkdir -p "${PROJECT_ROOT}/.tmp"
STAGING_DIR="$(mktemp -d "${PROJECT_ROOT}/.tmp/${APP_NAME}-deploy.XXXXXX")"
ARCHIVE_PATH="${STAGING_DIR}/release.tar.gz"

cleanup() {
  rm -rf "${STAGING_DIR}"
}
# trap cleanup EXIT

echo "==> Packaging production artifacts in ${STAGING_DIR}"
mkdir -p "${STAGING_DIR}/release/backend" "${STAGING_DIR}/release/frontend"

copy_if_exists "${PROJECT_ROOT}/backend/dist" "${STAGING_DIR}/release/backend"
copy_if_exists "${PROJECT_ROOT}/backend/package.json" "${STAGING_DIR}/release/backend"
copy_if_exists "${PROJECT_ROOT}/backend/pnpm-lock.yaml" "${STAGING_DIR}/release/backend"
copy_if_exists "${PROJECT_ROOT}/backend/pnpm-workspace.yaml" "${STAGING_DIR}/release/backend"
copy_if_exists "${PROJECT_ROOT}/backend/.env" "${STAGING_DIR}/release/backend"

copy_if_exists "${PROJECT_ROOT}/frontend/.next" "${STAGING_DIR}/release/frontend"
# Development and build caches are not required by `next start`; excluding them
# keeps the deployment artifact small without changing the local build output.
rm -rf \
  "${STAGING_DIR}/release/frontend/.next/cache" \
  "${STAGING_DIR}/release/frontend/.next/dev"
copy_if_exists "${PROJECT_ROOT}/frontend/public" "${STAGING_DIR}/release/frontend"
copy_if_exists "${PROJECT_ROOT}/frontend/package.json" "${STAGING_DIR}/release/frontend"
copy_if_exists "${PROJECT_ROOT}/frontend/pnpm-lock.yaml" "${STAGING_DIR}/release/frontend"
copy_if_exists "${PROJECT_ROOT}/frontend/.env" "${STAGING_DIR}/release/frontend"

COPYFILE_DISABLE=1 tar --no-xattrs --no-mac-metadata \
  -C "${STAGING_DIR}/release" -czf "${ARCHIVE_PATH}" .

echo "==> Preparing remote deployment directory"
ssh "${DEPLOY_TARGET}" "mkdir -p '${DEPLOY_PATH}'"
echo "==> Uploading production artifacts"
scp "${ARCHIVE_PATH}" "${DEPLOY_TARGET}:${DEPLOY_PATH}/${APP_NAME}.tar.gz"

echo "==> Installing production dependencies and restarting PM2"
ssh "${DEPLOY_TARGET}" \
  "DEPLOY_PATH='${DEPLOY_PATH}' APP_NAME='${APP_NAME}' BACKEND_PM2_NAME='${BACKEND_PM2_NAME}' FRONTEND_PM2_NAME='${FRONTEND_PM2_NAME}' FRONTEND_PORT='${FRONTEND_PORT}' bash -s" <<'REMOTE_SCRIPT'
set -euo pipefail

command -v pnpm >/dev/null 2>&1 || {
  echo 'pnpm must be installed on the deployment server.' >&2
  exit 1
}
command -v pm2 >/dev/null 2>&1 || {
  echo 'pm2 must be installed on the deployment server.' >&2
  exit 1
}

app_path="${DEPLOY_PATH}/${APP_NAME}"
archive_path="${DEPLOY_PATH}/${APP_NAME}.tar.gz"

# Direct deployments intentionally replace the existing project directory.
pm2 delete "${BACKEND_PM2_NAME}" >/dev/null 2>&1 || true
pm2 delete "${FRONTEND_PM2_NAME}" >/dev/null 2>&1 || true
rm -rf "${app_path}"
mkdir -p "${app_path}"
tar -xzf "${archive_path}" -C "${app_path}"
rm "${archive_path}"

(
  cd "${app_path}/backend"
  pnpm install --prod --frozen-lockfile --ignore-scripts
)

(
  cd "${app_path}/frontend"
  pnpm install --prod --frozen-lockfile --ignore-scripts
)

pm2 start "${app_path}/backend/dist/src/main.js" \
  --name "${BACKEND_PM2_NAME}" \
  --cwd "${app_path}/backend"
pm2 start "${app_path}/frontend/node_modules/next/dist/bin/next" \
  --name "${FRONTEND_PM2_NAME}" \
  --cwd "${app_path}/frontend" \
  -- start -p "${FRONTEND_PORT}"
pm2 save
REMOTE_SCRIPT

echo "==> Deployment complete: ${DEPLOY_TARGET}:${DEPLOY_PATH}/${APP_NAME}"
