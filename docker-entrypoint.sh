#!/bin/sh
# Create the data folders and check mount prerequisites, then start the app.
# Trusted deployment: the app runs as root (no privilege drop), so SSH (sshfs)
# and SMB (cifs) mounts work directly.
set -e

DATA_FOLDER="${DATA_FOLDER:-/app/data}"
MOUNTS_FOLDER="${MOUNTS_FOLDER:-$DATA_FOLDER/mounts}"
DB_BACKUP_DIR="${DB_BACKUP_DIR:-$DATA_FOLDER/backups}"

# Next's server.js binds to $HOSTNAME, but Docker/Kubernetes set HOSTNAME to the
# container/pod name at runtime (overriding the image ENV). Bind all interfaces so
# loopback (AUTH_INTERNAL_URL=http://127.0.0.1:3000) works; BIND_HOST overrides.
export HOSTNAME="${BIND_HOST:-0.0.0.0}"

mkdir -p "$DATA_FOLDER" "$MOUNTS_FOLDER" "$DB_BACKUP_DIR"

# SSH remotes (sshfs) need the FUSE device passed into the container
if [ ! -c /dev/fuse ]; then
  echo "entrypoint: warning: /dev/fuse not found - SSH (sshfs) mounts will fail." \
    "Docker: add 'devices: [/dev/fuse]' + 'cap_add: [SYS_ADMIN]'; Kubernetes: privileged" \
    "container or a hostPath /dev/fuse volume. The host needs the fuse module ('modprobe fuse')."
else
  # things that make sshfs fail with "fuse: mount failed: Permission denied"
  aa="$(cat /proc/self/attr/current 2>/dev/null || true)"
  case "$aa" in
    "" | unconfined*) ;;
    *) echo "entrypoint: warning: AppArmor profile '$aa' blocks FUSE mounts;" \
         "use security_opt 'apparmor:unconfined' (Kubernetes: appArmorProfile type Unconfined, or privileged)" ;;
  esac
  if grep -q '^NoNewPrivs:[[:space:]]*1' /proc/self/status; then
    echo "entrypoint: warning: no-new-privileges is set; fusermount3 (setuid) cannot mount." \
      "Remove 'no-new-privileges' (Kubernetes: allowPrivilegeEscalation: true)"
  fi
  capbnd="$(sed -n 's/^CapBnd:[[:space:]]*//p' /proc/self/status)"
  if [ $(( 0x$capbnd >> 21 & 1 )) -eq 0 ]; then
    echo "entrypoint: warning: CAP_SYS_ADMIN not granted; add cap_add: [SYS_ADMIN]"
  fi
fi

exec "$@"
