#!/bin/sh
# Fix ownership of mounted data folders, then drop privileges to the app user.
#
# Bind mounts / named volumes hide the image's /app/data, so they show up owned by
# root on first start. When the container starts as root we create the folders the
# app writes to, hand them to PUID:PGID, and re-exec as that user via su-exec.
# Set RUN_AS_ROOT=true to skip the drop (e.g. for CIFS mounts, which need root).
set -e

PUID="${PUID:-1001}"
PGID="${PGID:-1001}"
DATA_FOLDER="${DATA_FOLDER:-/app/data}"
MOUNTS_FOLDER="${MOUNTS_FOLDER:-$DATA_FOLDER/mounts}"
DB_BACKUP_DIR="${DB_BACKUP_DIR:-$DATA_FOLDER/backups}"

# Next's server.js binds to $HOSTNAME, but Docker/Kubernetes set HOSTNAME to the
# container/pod name at runtime (overriding the image ENV). Bind all interfaces so
# loopback (AUTH_INTERNAL_URL=http://127.0.0.1:3000) works; BIND_HOST overrides.
export HOSTNAME="${BIND_HOST:-0.0.0.0}"

if [ "$(id -u)" = "0" ]; then
  mkdir -p "$DATA_FOLDER" "$MOUNTS_FOLDER" "$DB_BACKUP_DIR" /app/.next

  # chown the folder itself only (never recurse into user data / mount points)
  fix_dir() {
    owner="$(stat -c '%u:%g' "$1")"
    if [ "$owner" != "$PUID:$PGID" ]; then
      echo "entrypoint: chown $PUID:$PGID $1 (was $owner)"
      chown "$PUID:$PGID" "$1" || echo "entrypoint: warning: could not chown $1"
    fi
  }
  fix_dir "$DATA_FOLDER"
  fix_dir "$MOUNTS_FOLDER"
  # app-owned folders: safe to fix recursively
  chown -R "$PUID:$PGID" /app/.next "$DB_BACKUP_DIR" 2>/dev/null || true

  if [ "$RUN_AS_ROOT" != "true" ]; then
    export HOME=/home/nextjs
    exec su-exec "$PUID:$PGID" "$@"
  fi
fi

exec "$@"
