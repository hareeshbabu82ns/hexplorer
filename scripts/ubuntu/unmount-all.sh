#!/usr/bin/env bash
# Unmount every sshfs / cifs mount under the mounts root (e.g. before shutdown).
# Usage: ./unmount-all.sh <mounts-root>
set -euo pipefail
ROOT="$(realpath "${1:?mounts root}")"
awk -v root="$ROOT" '($3=="fuse.sshfs" || $3=="cifs" || $3=="smb3") && index($2, root"/")==1 {print $2}' /proc/mounts |
while read -r mp_esc; do
  mp="$(printf '%b' "$mp_esc")"
  fusermount3 -u "$mp" 2>/dev/null || fusermount -u "$mp" 2>/dev/null || umount "$mp" || fusermount -uz "$mp"
  echo "unmounted $mp"
done
