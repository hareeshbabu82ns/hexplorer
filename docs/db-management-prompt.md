# Prompt: MongoDB management module (multi-connection admin, users, collections, backups)

Copy everything below the line into the coding agent for the target app. Edit
the **Target stack** section first. Every other section is framework-neutral.

---

## Goal

Build an admin-only **DB Management** module that manages one or more MongoDB
servers from inside this app:

- saved connections to several servers
- databases, collections, indexes and documents
- database users and their role-based permissions
- streaming backups with restore to any saved connection

Treat this as a real admin tool. Every operation is checked on the server,
audited, and protected against obvious foot-guns.

## Target stack (edit to match the app)

- Reference implementation: Next.js 16 App Router with server actions, Prisma 6
  on MongoDB for the app's own metadata, Auth.js v5, shadcn/ui, sonner toasts,
  and the official `mongodb` Node driver (v6+/v7) for all admin operations.
- Use the official MongoDB driver for anything that touches a managed server,
  not the app ORM. Use the app's ORM only for the module's own metadata tables
  (connections, backups, audit log).
- Read the framework's own docs for the installed version before writing code.
  For example, in Next.js 15+ the page `params` and `searchParams` are Promises.

## 1. Access control and auditing

- Every server entry point (action, API route, page) calls a guard such as
  `requireDbAdmin()`. The guard rejects anyone without the admin role, and
  enforces this on the server, not only by hiding UI.
- Wrap every operation in one of two helpers:
  - `read(fallback, task)` returns `{ success: true, data }` or
    `{ success: false, error }`, with errors turned into readable messages.
  - `mutate(auditEntry, fallback, task)` does the same and also writes an audit
    row. It writes the row on **success and on failure**, recording the error
    message.
- **Audit log table** `DbAuditLog` has these fields: `userId`, `actorEmail?`,
  `action` (e.g. `database.drop`, `user.create`, `backup.restore`),
  `connectionId?`, `target?` (e.g. `db.collection`), `success`, `error?`,
  `details` (JSON) and `at`. Never put passwords or URIs in `details`.
- All results use one type:
  `type ActionResult<T> = { success: true; data: T } | { success: false; error: string }`.
  Throw a typed `DbAdminError` for user-facing validation errors.

## 2. Connections (multiple servers)

**Model `DbConnection`:** `id`, `name`, `uri` (**encrypted at rest** with
AES-256-GCM, using a key derived from an app secret env var), `description?`,
`createdById`, `lastUsedAt?`, `createdAt`, `updatedAt`.

**Built-in connection:** add a virtual connection with id `"app"` named
"App database", built from the app's own `DATABASE_URL`. It is always listed,
can't be edited or deleted, and **the app's own database can't be dropped
through it** (`isProtectedDatabase`).

**Never send a URI to the browser.** `ConnectionSummary` exposes only:

- `id`, `name`, `description`, `builtIn`
- `hosts` (host:port list, without credentials)
- `username` (without the password), `defaultDb`
- `connected` (whether there's a live pooled client), `lastUsedAt`

**Client pool:** keep one `MongoClient` per connection id in a `globalThis`
map, so it survives dev hot reload.

- Reconnect when the stored URI changes.
- Close clients that have been idle for 10 minutes.
- Use short timeouts: `serverSelectionTimeoutMS` of about 5s and
  `connectTimeoutMS` of about 5s.
- Update `lastUsedAt` on use, throttled.

**Operations:**

- `listConnections`: the built-in one first, then the saved ones.
- `testConnection({ uri } | { connectionId })`: pings and returns the server
  version and the number of visible databases.
- `saveConnection({ id?, name, uri?, description })`: create, or update. On
  update, an empty `uri` keeps the saved one. Test a new URI before saving.
- `deleteConnection(id)`: removes only the saved record. Databases and backup
  files are not touched.
- `disconnectConnection(id)`: closes the pooled client.

**Helpers:**

- `describeUri(uri)`: hosts, username and default database, never the password.
- `uriWithCredentials(baseUri, user, password, authSource)`: builds a
  ready-to-use connection string for a newly created user.

## 3. Server overview and databases

- `getServerOverview` returns:
  - `version`, `replicaSet?`, `uptimeSeconds?`, current `connections?`;
    `serverStatus` may be denied, so return null for those fields;
  - `canListUsers`, which tells the UI whether the users tab works.
- `listDatabases` returns `name`, `sizeOnDisk`, `empty`, `system` (admin,
  local, config) and `protected` (system, or the app's own database).
- `createDatabase(conn, name, firstCollection)`. MongoDB only keeps a database
  once it has a collection, so the first collection name is required.
- `dropDatabase(conn, name, confirmName)`:
  - The server checks `confirmName === name`.
  - It refuses system and protected databases.
- `getDatabaseStats` returns collections, views, objects, data, storage and
  index sizes from `dbStats`.

**Name validation:**

- Databases: no `/\. "$*<>:|?` characters and at most 63 bytes.
- Collections: not empty, no `$` and no NUL. Names may start with `system.`
  only when read-only.

## 4. Collections

- `listCollections` returns each collection's `name`, `type`
  (collection/view/timeseries), `count`, `size`, `storageSize`, `avgObjSize`,
  `indexCount`, `totalIndexSize`, `capped`, and for views `viewOn` and
  `pipeline`.
  - Get stats with a `$collStats` aggregation.
  - If that's denied, fall back to `estimatedDocumentCount`.
- `createCollection(conn, db, name, { capped?, size?, max? })`. Build the
  options object from **only the keys that are set**; see pitfalls.
- `renameCollection` within the same database, failing if the target exists.
- `dropCollection` and `clearCollection` (`deleteMany({})`, which keeps the
  indexes). Both are type-to-confirm in the UI.

## 5. Indexes

- `listIndexes` returns `name`, `key`, `unique`, `sparse`,
  `expireAfterSeconds`, `partialFilterExpression` and `size` (from
  `$collStats` or `indexSizes`).
- `createIndex(conn, db, coll, keys, { name?, unique?, sparse?, expireAfterSeconds?, background? })`.
  - `keys` is a JSON object such as `{ "email": 1 }` or `{ "title": "text" }`.
  - The options object contains only the set keys.
- `dropIndex`. The `_id_` index can't be dropped.

## 6. Documents (data browser)

**`findDocuments(conn, db, coll, { filter, sort, projection, skip, limit })`:**

- Inputs are **Extended JSON strings**, parsed with `EJSON.parse(text, { relaxed: false })`
  so `{"$oid": …}`, `{"$date": …}`, `{"$numberLong": …}` and similar work.
- Shorthand: a bare 24-hex string as the filter means `{ _id: ObjectId(…) }`.
- Cap `limit` at 200. Return `total` from `countDocuments(filter)`, falling
  back to an estimate when the filter is empty.
- Return each document as a **relaxed EJSON string** (`EJSON.stringify(doc, { relaxed: true })`),
  so the browser never has to deal with BSON types.

**Writes:**

- `insertDocuments`: accepts one object or an array of objects (EJSON).
- `replaceDocument(id, json)`: parse the edited JSON as EJSON, which keeps Date,
  Long and Decimal types. Refuse to change `_id`.
- `deleteDocument(id)`, plus `deleteMatching(filter)`, which requires a
  non-empty filter and type-to-confirm and returns `deletedCount`.

**UI:**

- Inputs for filter, sort and projection; pagination with page size 20/50/100.
- A JSON-cards view and a table view, whose columns are the union of top-level
  keys.
- Insert, edit, duplicate (drops `_id`) and delete actions on each document.
- A JSON textarea that flags syntax errors live.

## 7. Users and permissions

- `listUsers(conn)`:
  - Run `usersInfo` with `{ forAllDBs: true }`.
  - If that's denied, run `usersInfo` per database and set `partial: true` so
    the UI can explain.
  - Return `user`, `db` (the authentication database), `roles: { role, db }[]`
    and `mechanisms`.
- `listCustomRoles(conn)`: run `rolesInfo` per database with
  `showBuiltinRoles: false`.
- `createUser(conn, { username, password, authDb, roles })` runs `createUser`
  on `authDb`. Return the result **plus a connection string** for the new user,
  built with `uriWithCredentials`; the UI shows it once with a copy button.
- `updateUserRoles(conn, user, authDb, roles)` runs `updateUser` with the full
  roles array, replacing the old one.
- `changeUserPassword` (minimum 8 characters) and `dropUser`. A user can't drop
  the user the current connection is authenticated as.
- **Role editor UI:** a list of (role, database) rows.
  - Database-level built-in roles: `read`, `readWrite`, `dbAdmin`, `dbOwner`,
    `userAdmin`.
  - Admin-only built-in roles, which force db = `admin`: `readAnyDatabase`,
    `readWriteAnyDatabase`, `dbAdminAnyDatabase`, `userAdminAnyDatabase`,
    `clusterMonitor`, `clusterManager`, `clusterAdmin`, `backup`, `restore`,
    `root`.
  - Also offer custom roles from `rolesInfo`.
  - Show a short description next to each role.
- The password field has a "generate" button that produces 24 random URL-safe
  characters.

## 8. Backups

**Model `DbBackup`:**

| Field | Notes |
|---|---|
| `connectionId` | `"app"` or an id |
| `connectionName` | snapshot, kept if the connection is renamed or deleted |
| `database`, `name`, `description?` | |
| `collections[]` | |
| `documentCount`, `sizeBytes` | |
| `fileName` | |
| `status` | `running` / `completed` / `failed` |
| `source` | `backup` / `upload` |
| `error?` | |
| `createdById`, `createdAt`, `completedAt?` | |

Add an index on `(connectionId, createdAt)`.

**Storage:** keep files in `DB_BACKUP_DIR` (default `./data/backups`). In
Docker, mount a volume there. Store files as `<backupId>.ndjson.gz`, and
resolve paths only from the database record, never from user input.

**File format:** gzipped NDJSON. Each line is **canonical EJSON**
(`relaxed: false`), so every BSON type round-trips exactly. The lines, in order:

1. `{ "type": "header", "format": "<app>-mongo-backup", "version": 1, "database", "createdAt", "server": { "version" } }`
2. For each collection:
   1. `{ "type": "collection", "name", "kind": "collection"|"view"|"timeseries", "options", "indexes": [...] }`
   2. its document lines: `{ "type": "doc", "c": "<collection>", "d": <document> }`
3. `{ "type": "end", "collections": N, "documents": M }`

Write views last; views have no document lines.

**`createBackup(conn, db, { name, description, collections? })`:**

- Inserts a `running` record and returns it right away.
- Runs the job in the background (Next: `after()`; otherwise a job queue or a
  detached promise).
- Streams `cursor → async generator → Readable.from → createGzip → file`, so
  memory stays flat for large collections.
- When done, sets `completed` with counts and size, or `failed` with the error.
  Delete partial files on failure.

**`listBackups(connectionId?)`:** a `running` record older than the process
start time is marked `failed` with "Interrupted (server restarted)".

**Download:** an admin-only `GET /api/db-admin/backups/:id/download` route
that streams the file with `Content-Disposition` and audits the download.

**Upload:** an admin-only `POST /api/db-admin/backups/upload?connectionId=&name=`
route.

- The raw file is the request body.
- Stream it to a temp file, then validate it: gunzip, check the header line,
  require the end line, count the collections and documents.
- Rename it into place and register it with `source: "upload"`.
- Reject corrupt files and unknown connections with 400, and delete the temp
  file.

**`restoreBackup(id, { targetConnectionId, targetDatabase, collections?, mode })`:**

- `mode: "drop"` (Replace) drops each target collection first. `mode: "merge"`
  keeps existing documents: use `insertMany(..., { ordered: false })`, ignore
  duplicate-key errors (code 11000), and count them per collection.
- Recreate each collection with its saved options. Remove `uuid` from the
  options.
- Recreate its indexes. Remove `v` and `ns`, and skip `_id_`.
- Create views last, from `viewOn` and `pipeline`.
- Stream `gunzip → readline`, inserting in batches of 1000.
- Return `{ collections, documents, skipped, warnings[] }`, where `warnings`
  contains entries like "`users`: 12 existing document(s) kept".
- Allowed targets: any saved connection and any database name, including new
  ones. Never restore into a protected database in drop mode.

**UI:**

- Backups list with status badges, size, document count and relative time.
- Poll every 2s while any backup is running.
- Create dialog: pick a database, then choose all collections or a checklist.
- Upload button, and download and delete on each row.
- Restore dialog:
  - target connection select (all saved connections), target database
    (prefilled), collection subset;
  - mode, Replace or Merge;
  - **Replace requires typing the target database name**.

## 9. Pages and navigation

| Route | Content |
|---|---|
| `/db-management` | Connection cards (name, hosts, badges: Built-in / Connected / user / db, last used). Add/edit dialog with a **Test** button. Actions: Test, Disconnect, Edit, Remove. |
| `/db-management/[connectionId]?tab=databases\|users\|backups&database=` | Header with server version, replica set, uptime and client connections. Tabs: **Databases** (table, sizes, badges, Back up → opens the backup dialog for that database, Drop), **Users & roles**, **Backups**. The tab is kept in the URL with `history.replaceState`. |
| `/db-management/[connectionId]/[database]` | Stats cards, and a collections table with count, size, indexes, type and capped flag. Actions: create collection (capped options), rename, clear, drop, plus drop database. |
| `/db-management/[connectionId]/[database]/[collection]` | Documents browser, and an Indexes panel with a create-index dialog (keys JSON, name, unique, sparse, TTL). |

- Every page shows breadcrumbs and loads data on the server (`force-dynamic`
  or the equivalent, with no caching).
- Use one path helper everywhere: `dbPath(connectionId, database?, collection?)`.
  It URL-encodes segments and lives in a module that **both client and server
  can import**, not in a `"use client"` file.
- If a page's data load fails (bad credentials, server down), show an error
  card instead of crashing.

## 10. Shared UI pieces

- `useRunAction()` runs an action and returns `{ busy, run(action, successMsg?) }`.
  It shows a toast on error, shows the optional success toast, and returns the
  data or null.
- `DangerDialog`: a destructive confirmation. With an optional `confirmWord`,
  the button stays disabled until the user types that word. Use it for drop
  database, drop or clear collection, delete matching, and restore in Replace
  mode.
- `JsonTextarea`: a monospace editor that shows the parse error inline.
- `ErrorCard`, `formatBytes`, and a page header with breadcrumbs and an actions
  slot.
- If the project uses the React Compiler lint rules, don't call `setState`
  synchronously in effects. Load data in the effect with a `cancelled` flag and
  set state in `.then()`, or seed the state from props and a `key`.

## 11. Pitfalls to handle (all were real bugs)

1. **The MongoDB driver serializes `undefined` option values as `null`.** The
   server then rejects them, for example "expireAfterSeconds must be numeric,
   but received null". Always build option objects from only the keys that are
   set.
2. Replacing a document from relaxed JSON turns Dates into strings. Parse the
   edited text as EJSON so types are kept, and test this.
3. Backups written with `JSON.stringify` lose ObjectId, Date, Long and Decimal
   types. Use canonical EJSON.
4. Restoring with the saved options fails on `uuid`, and restoring indexes
   fails on `v`/`ns` and on the `_id_` index. Remove or skip them.
5. Buffering a whole collection in memory runs out of memory on large
   collections. Stream both ways.
6. Background jobs die on restart. Mark stale `running` records as failed.
7. Least-privileged users get "not authorized" on `serverStatus`, `usersInfo`
   with `forAllDBs`, and `$collStats`. Degrade gracefully (nulls, `partial`,
   estimates) rather than failing the page.
8. Pool clients on `globalThis`, or dev hot reload leaks connections.
9. A path helper defined in a client component file can't be called from
   server code.
10. Long-running scripts that open a client must close it before exiting.

## 12. Configuration

- `DB_BACKUP_DIR`: where backups are stored. In Docker, mount a persistent
  volume and make it writable by the app user.
- An encryption key env var for saved URIs. It defaults to the auth secret;
  changing it means re-entering the saved connections.
- Document both in `.env.sample` and the README.

## 13. Acceptance checks (write as an end-to-end script against a dev MongoDB)

1. A non-admin gets "Unauthorized" from every action and both API routes.
2. Saved connection: the URI is encrypted in the database, never appears in
   `listConnections` output, and the test-connection result includes the
   server version.
3. Create a database and collection, insert 2,500 documents that include
   ObjectId, Date, `Long`, `Decimal128` and nested arrays, and confirm the
   stats are right.
4. Find with an EJSON filter and the 24-hex `_id` shorthand, with sort,
   projection and paging, and check `total`.
5. Replace a document and confirm the Date fields are still Date.
6. Create unique, TTL and compound indexes, then drop one. Dropping `_id_`
   fails.
7. A capped collection and a view both exist after a restore.
8. Backup, then restore into a new database (drop mode). Every document is
   deep-equal, with BSON types intact, and indexes and views match.
9. A merge restore over partially modified data adds only the missing
   documents and reports how many were kept.
10. Create a user with roles on two databases, update its roles, change its
    password, connect with the returned connection string, and drop the user.
11. Dropping the app's own database, or using a wrong `confirmName`, is
    rejected.
12. Upload a valid backup and it registers. Upload a truncated or garbage file
    and it's rejected. A missing backup id returns 404.
13. Each mutation above wrote an audit row with the right `success` value.

## Out of scope for v1 (good follow-ups)

- Creating and editing custom roles (they can be listed and assigned).
- Scheduled backups with retention.
- Export or import of single collections as JSON or CSV.
- Compatibility with `mongodump` and `mongorestore`.
