#!/usr/bin/env bash
# Manually mount a remote folder over SSH (sshfs) with the same options the app uses.
# Usage: ./mount-remote.sh <[user@]host> <remote-path> <local-mount-point> [port]
# Key login by default; set SSH_PASSWORD=... (or USE_PASSWORD=1 to be prompted) for password login.
set -euo pipefail
TARGET="${1:?host}"; REMOTE="${2:?remote path}"; LOCAL="${3:?mount point}"; PORT="${4:-22}"

if mountpoint -q "$LOCAL"; then
  echo "already mounted: $LOCAL"; exit 0
fi
mkdir -p "$LOCAL"
COMMON="ConnectTimeout=10,ServerAliveInterval=15,ServerAliveCountMax=3,StrictHostKeyChecking=accept-new,reconnect,idmap=user,follow_symlinks"
if [[ -n "${SSH_PASSWORD:-}" || -n "${USE_PASSWORD:-}" ]]; then
  if [[ -z "${SSH_PASSWORD:-}" ]]; then read -rsp "Password for $TARGET: " SSH_PASSWORD; echo; fi
  printf '%s\n' "$SSH_PASSWORD" | sshfs "$TARGET:$REMOTE" "$LOCAL" -p "$PORT" \
    -o "$COMMON,PreferredAuthentications=password,keyboard-interactive,PubkeyAuthentication=no,password_stdin"
else
  sshfs "$TARGET:$REMOTE" "$LOCAL" -p "$PORT" -o "$COMMON,BatchMode=yes"
fi
echo "mounted $TARGET:$REMOTE -> $LOCAL"
