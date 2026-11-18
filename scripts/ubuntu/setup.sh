#!/usr/bin/env bash
# One-time Ubuntu setup for HExplorer's network remotes and backups.
#  - installs sshfs + fuse3 + sshpass (SSH key or password login)
#  - installs smbclient + cifs-utils (SMB / Windows shares with user + password)
#  - installs rsync (backups)
#  - enables user_allow_other in /etc/fuse.conf (optional, for shared access)
#  - creates the mounts folder
#  - creates an ssh key for the app user if missing and prints how to authorize it
#
# Usage: sudo ./setup.sh [app-user] [mounts-dir]
#   app-user   user that runs the Next.js server (default: $SUDO_USER or current user)
#   mounts-dir where remotes are mounted (default: <repo>/data/mounts)
set -euo pipefail

APP_USER="${1:-${SUDO_USER:-$(id -un)}}"
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
MOUNTS_DIR="${2:-$REPO_DIR/data/mounts}"
APP_HOME="$(getent passwd "$APP_USER" | cut -d: -f6)"

if [[ $EUID -ne 0 ]]; then
  echo "Please run with sudo: sudo $0 $*" >&2
  exit 1
fi

echo "==> Installing sshfs, fuse3, sshpass, smbclient, cifs-utils, rsync"
apt-get update -qq
apt-get install -y -qq sshfs fuse3 openssh-client sshpass smbclient cifs-utils rsync

if [[ "$APP_USER" != "root" ]]; then
  echo "==> Allowing $APP_USER to mount/umount cifs shares without a password (sudoers)"
  cat > /etc/sudoers.d/hexplorer <<SUDO
# HExplorer: SMB/CIFS mounts are done with 'sudo -n mount -t cifs' / 'sudo -n umount'
$APP_USER ALL=(root) NOPASSWD: /usr/bin/mount -t cifs *, /usr/bin/umount *
SUDO
  chmod 440 /etc/sudoers.d/hexplorer
  visudo -cf /etc/sudoers.d/hexplorer
fi

echo "==> Enabling user_allow_other in /etc/fuse.conf"
if ! grep -q '^user_allow_other' /etc/fuse.conf 2>/dev/null; then
  echo 'user_allow_other' >> /etc/fuse.conf
fi

echo "==> Creating mounts dir $MOUNTS_DIR (owner $APP_USER)"
mkdir -p "$MOUNTS_DIR"
chown "$APP_USER": "$MOUNTS_DIR"

KEY="$APP_HOME/.ssh/id_ed25519"
if [[ ! -f "$KEY" ]]; then
  echo "==> Generating ssh key $KEY"
  sudo -u "$APP_USER" mkdir -p "$APP_HOME/.ssh"
  sudo -u "$APP_USER" chmod 700 "$APP_HOME/.ssh"
  sudo -u "$APP_USER" ssh-keygen -t ed25519 -N "" -f "$KEY" -C "hexplorer@$(hostname)"
fi

cat <<MSG

Done. Next steps (as $APP_USER):
  0. Set APP_SECRET in .env (any long random string) — used to encrypt stored passwords:
       echo "APP_SECRET=$(openssl rand -hex 32)" >> $REPO_DIR/.env
  1. For key login, authorize the key on each remote:   ssh-copy-id -i $KEY.pub user@remote-host
     (or just use user ID + password in the app)
  2. Optionally add hosts to $APP_HOME/.ssh/config so they appear in the app:
       Host nas
         HostName 192.168.1.10
         User me
         IdentityFile $KEY
  3. Set MOUNTS_FOLDER=$MOUNTS_DIR in .env (defaults to DATA_FOLDER/mounts)
  4. Open the app → Remotes → add SSH or SMB remote → Browse & mount.

The app mounts remotes on demand (scan / hash / view / delete) and unmounts them
after the idle timeout you choose. Search & duplicates keep working unmounted.
MSG
