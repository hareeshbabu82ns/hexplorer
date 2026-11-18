#!/usr/bin/env bash
# Manually mount an SMB/Windows share with user + password (same options the app uses).
# Usage: sudo ./mount-smb.sh <host-ip> <share[/sub/dir]> <local-mount-point> <user> [domain] [vers=3.0]
# The password is read from $SMB_PASSWORD or prompted; it is passed via a temp 0600 credentials file.
set -euo pipefail
HOST="${1:?host}"; SHARE="${2:?share}"; LOCAL="${3:?mount point}"; USER_ID="${4:?user}"
DOMAIN="${5:-}"; VERS="${6:-3.0}"

if mountpoint -q "$LOCAL"; then echo "already mounted: $LOCAL"; exit 0; fi
if [[ -z "${SMB_PASSWORD:-}" ]]; then read -rsp "Password for $USER_ID@$HOST: " SMB_PASSWORD; echo; fi

CRED="$(mktemp)"; chmod 600 "$CRED"; trap 'rm -f "$CRED"' EXIT
{ echo "username=$USER_ID"; echo "password=$SMB_PASSWORD"; if [[ -n "$DOMAIN" ]]; then echo "domain=$DOMAIN"; fi; } > "$CRED"

mkdir -p "$LOCAL"
mount -t cifs "//$HOST/$SHARE" "$LOCAL" \
  -o "credentials=$CRED,vers=$VERS,uid=${SUDO_UID:-$(id -u)},gid=${SUDO_GID:-$(id -g)},iocharset=utf8,file_mode=0664,dir_mode=0775,noperm"
echo "mounted //$HOST/$SHARE -> $LOCAL"
