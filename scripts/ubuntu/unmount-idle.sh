#!/usr/bin/env bash
# Unmount sshfs / cifs mounts under a folder that have not been accessed for N minutes.
# The app already does this itself for the mounts it manages; use this for mounts
# made with mount-remote.sh, e.g. from cron:
#   */5 * * * * /path/to/hexplorer/scripts/ubuntu/unmount-idle.sh /path/to/data/mounts 15
# Usage: ./unmount-idle.sh <mounts-root> [idle-minutes=15]
set -euo pipefail
ROOT="$(realpath "${1:?mounts root}")"; IDLE_MIN="${2:-15}"
STATE_DIR="${XDG_RUNTIME_DIR:-/tmp}/hexplorer-idle"; mkdir -p "$STATE_DIR"

# list fuse.sshfs mounts below ROOT (field 2 = mount point, octal-escaped)
awk -v root="$ROOT" '($3=="fuse.sshfs" || $3=="cifs" || $3=="smb3") && index($2, root"/")==1 {print $2}' /proc/mounts |
while read -r mp_esc; do
  mp="$(printf '%b' "$mp_esc")"
  key="$STATE_DIR/$(echo "$mp" | md5sum | cut -c1-16)"
  # any process with files open below the mount point counts as "in use"
  if fuser -m "$mp" >/dev/null 2>&1; then
    date +%s > "$key"; continue
  fi
  [[ -f "$key" ]] || date +%s > "$key"
  idle=$(( ( $(date +%s) - $(cat "$key") ) / 60 ))
  if (( idle >= IDLE_MIN )); then
    fusermount3 -u "$mp" 2>/dev/null || fusermount -u "$mp" 2>/dev/null || umount "$mp" && { echo "unmounted $mp (idle ${idle}m)"; rm -f "$key"; }
  fi
done
