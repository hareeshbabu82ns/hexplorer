# HExplorer

Next.js app that indexes data folders into MongoDB, then lets you search, sort,
browse and de-duplicate files — even while the folders are offline.

## Features

- **Data folders** (`/folders`): add local paths, scan/rescan (background, with
  progress), per-folder stats. Ignore patterns live in Settings → Extras.
- **Network remotes** (`/remotes`): SSH hosts (from `~/.ssh/config`, or host IP
  with SSH key **or user ID + password**) and SMB/Windows shares (host IP + user
  ID + password). Browse remote folders and mount one as a data folder (`sshfs`
  or `mount -t cifs`). The app mounts on demand and unmounts after a per-folder
  idle timeout. Passwords are stored AES-256-GCM encrypted with `APP_SECRET`.
- **Scan / hash at any level**: rescan or content-hash the whole folder or any
  sub folder (Files page toolbar for the current level, or the `…` menu on a
  directory row). Sub folder scans only touch index entries below that folder.
- **Backups** (`/backups`): back up any folder or sub folder to another data
  folder (local or remote mount) or a local path with rsync — *sync* (copy
  new/changed), *mirror* (exact copy, deletes extras) or *snapshot* (new
  timestamped copy per run). Jobs are saved and can be re-run; the copy can be
  indexed in the destination folder automatically.
- **Files** (`/files`): browse folder trees or search by name across one/all
  folders; sort by name, size, type, modified, created; multi-select delete.
- **Duplicates** (`/duplicates`): group by name+size, similar name+size
  (ignores `(1)`, `- Copy`, `Copy of`…), name only, or identical content (SHA-1
  of same-size candidates). Auto-select all-but oldest/newest/shortest-path,
  bulk or single delete.

### Offline behaviour

Browsing, search and duplicate detection read only from MongoDB, so they work
when a share is unmounted or unreachable. Disk is touched only by scan, hash,
file preview/download and delete; those first check the folder is reachable
(mounting it if it is an SSH remote). An empty folder root that is indexed with
entries is treated as "not mounted", so a scan never wipes the index, and
deletes never drop index rows for an offline folder.

## Sign in, 2FA and installing the app

HExplorer is a single-user app. The first visit to `/login` creates the owner
account (user ID + password); after that sign ups are refused.

- **Passkeys** (Face ID / Touch ID / device PIN): offered right after setup and
  in *Settings → Security*. Passkeys only work over `https` (or on `localhost`)
  and are bound to the host name in `BETTER_AUTH_URL`.
- **Two-factor (TOTP)**: *Settings → Security → Two-factor authentication*. Scan
  the QR code with an authenticator app and save the backup codes. Password
  sign in then asks for a code ("trust this device" skips it for 30 days);
  passkey sign in does not.
- Every page, server action and `/api/assets` request needs a session
  (`src/middleware.ts`).

Env vars: `BETTER_AUTH_URL`, `BETTER_AUTH_SECRET` (falls back to `APP_SECRET`),
optional `BETTER_AUTH_TRUSTED_ORIGINS` (other URLs you open the app with) and
`AUTH_INTERNAL_URL` (how the server reaches itself, e.g. `http://127.0.0.1:3000`
behind a reverse proxy).

**Install as an app:** on iPad/iPhone open the site in Safari → Share → *Add to
Home Screen*; in Chrome/Edge use the install icon or *Install app* in the user
menu. The layout is iPad-first: icon rail in portrait, full sidebar in
landscape, bottom tab bar on phones.

## Local development

```sh
cp .env.template .env   # set DATABASE_URL (MongoDB) and DATA_FOLDER
pnpm install
pnpm dev
```

Collections (`folders`, `files`, `remotes`, `settings`) and indexes are created
automatically on first connection.

### Network remotes on Ubuntu

```sh
sudo ./scripts/ubuntu/setup.sh   # sshfs, sshpass, smbclient, cifs-utils, rsync, mounts dir, ssh key
echo "APP_SECRET=$(openssl rand -hex 32)" >> .env   # needed for password logins
```

Then add the remote in the app (SSH key login additionally needs
`ssh-copy-id user@host`). SMB mounts need root, or the sudoers rule that
`setup.sh` installs for a non-root app user. Helper scripts for manual use:

- `scripts/ubuntu/mount-remote.sh <[user@]host> <remote-path> <mount-point> [port]` (`SSH_PASSWORD=…` for password login)
- `sudo scripts/ubuntu/mount-smb.sh <host-ip> <share[/dir]> <mount-point> <user> [domain] [vers]`
- `scripts/ubuntu/unmount-idle.sh <mounts-root> [idle-minutes]` (cron-friendly)
- `scripts/ubuntu/unmount-all.sh <mounts-root>`

New SSH host keys are accepted on first use (`StrictHostKeyChecking=accept-new`).

### Run

```sh
# build (local)
docker build -t hexplorer:main .

# run (from local)
docker run -it -p 3000:3000 \
 -e DATABASE_URL="mongodb://user:pass@host:27017/hexplorer" \
 --volume "$(pwd)"/data:/app/data:rw \
 --device /dev/fuse --cap-add SYS_ADMIN \
 --rm hexplorer:main

# run (from registry)
docker pull ghcr.io/hareeshbabu82ns/hexplorer:main

docker run -it -p 3000:3000 \
 --user "$(id -u):$(id -g)" \
 --volume "$(pwd)"/hexplorer:/app/data:rw \
 --rm ghcr.io/hareeshbabu82ns/hexplorer:main
```

### commit with tags

```sh
git add .
git commit -m "update instructions"
git push origin main

# push single tag
git tag -a v1.0.0 -m "tag instructions"
git push origin v1.0.0

# push multiple tags
git tag -a v1.0.0 -m "tag instructions"
git tag -a v1 -m "tag instructions"
git push origin --tags
```

## Prerequisites

- **Docker**: Make sure you have Docker installed on your system. You can download Docker from [Docker's official website](https://www.docker.com/get-started).

## Getting Started

Follow these instructions to get the project up and running in a Docker container.

### 1. Clone the Repository

First, clone the repository to your local machine:

```bash
git clone https://github.com/hareeshbabu82ns/hexplorer.git
cd hexplorer
```

### 2. Build the Docker Image

To build the Docker image for the project, run the following command in the project directory:

```bash
docker build -t hexplorer .
```

This command builds the Docker image and tags it as `hexplorer`.

### 3. Run the Docker Container

After building the Docker image, you can run the container using:

```bash
docker run -p 3010:3010 hexplorer
```

This command starts the container and maps port 3010 of the container to port 3010 on your local machine. You can access the application by navigating to `http://localhost:3010` in your web browser.

### 4. Environment Variables

Don't forget to set the environment variables, you can use the .env.template to know what has to be filled out.

```
DATABASE_URL=mongodb://...
DATA_FOLDER=./data
MOUNTS_FOLDER=./data/mounts   # optional
APP_SECRET=...                # encrypts stored remote passwords
```

### 6. Stopping the Container

To stop the running Docker container, find the container ID using:

```bash
docker ps
```

Then stop it with:

```bash
docker stop <container_id>
```

## Project Structure

Briefly describe the structure of your project.

```
/components  # React components
/app         # Next.js app
/lib         # Libraries
/public      # Public assets
...
```

## Roadmap

- Add file icons depending on file type
- Different color for already downloaded files
- Add total size + number of files + number of dirs

## Contributing

Contributions are welcome! Please open an issue or submit a pull request.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

### coder home path
```sh
docker ps
# instance id for 'coder-hareesh-ws-test' is coder-8a3d37ef-75df-49f0-9ce6-9a451ac1ab42
docker inspect coder-hareesh-ws-test

# go to mount folder
cd /var/lib/docker/volumes/coder-8a3d37ef-75df-49f0-9ce6-9a451ac1ab42-home/_data/dev/hexplorer/data
mkdir mnt_books

mount -t cifs //192.168.86.10/books /var/lib/docker/volumes/coder-8a3d37ef-75df-49f0-9ce6-9a451ac1ab42-home/_data/dev/hexplorer/data/mnt_books -o username=hareesh,password=<XXX>,rw,vers=2.1

mount -t cifs //192.168.86.10/books/Edu/Telugu/project-chalam-telugu-books-collection /var/lib/docker/volumes/coder-8a3d37ef-75df-49f0-9ce6-9a451ac1ab42-home/_data/dev/hexplorer/data/mnt_books -o username=hareesh,password=<XXX>,rw,vers=2.1

umount /var/lib/docker/volumes/coder-8a3d37ef-75df-49f0-9ce6-9a451ac1ab42-home/_data/dev/hexplorer/data/mnt_books

```