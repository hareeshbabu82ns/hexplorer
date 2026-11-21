/**
 * End-to-end acceptance checks for the DB Management module.
 *
 * Runs the real server actions and API route handlers against a dev MongoDB
 * (needs a replica set for Prisma, and auth enabled for the user checks).
 * It creates and drops databases named e2e_*; never point it at production.
 *
 *   DATABASE_URL="mongodb://root:pass@127.0.0.1:27017/hexplorer_e2e?authSource=admin&directConnection=true" \
 *   DB_ADMIN_E2E_URI="mongodb://root:pass@127.0.0.1:27017/?authSource=admin&directConnection=true" \
 *   pnpm test:db-admin
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { BSON, Decimal128, Long, MongoClient, ObjectId } from "mongodb";

process.env.DB_ADMIN_E2E = "1";
process.env.DB_ADMIN_SECRET ||= "e2e-secret-" + "x".repeat(16);
process.env.DB_BACKUP_DIR ||= fs.mkdtempSync(path.join(os.tmpdir(), "db-admin-e2e-"));

const URI = process.env.DB_ADMIN_E2E_URI;
if (!URI || !process.env.DATABASE_URL) {
  console.error("Set DATABASE_URL (app db) and DB_ADMIN_E2E_URI (server to manage)");
  process.exit(2);
}

type Actor = { userId: string; email: string | null } | null;
const setActor = (a: Actor) => ((globalThis as any).__DB_ADMIN_TEST_ACTOR__ = a);
const ADMIN = { userId: "e2e-admin", email: "e2e@example.test" };

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (e) {
    console.error(`  ✗ ${name}\n`, e);
    throw e;
  }
}

function ok<T>(r: { success: true; data: T } | { success: false; error: string }): T {
  if (!r.success) throw new Error(`expected success, got: ${r.error}`);
  return r.data;
}
function fails(r: { success: boolean; error?: string }, re?: RegExp) {
  assert.equal(r.success, false, "expected failure");
  if (re) assert.match(r.error!, re);
}

const until = async (fn: () => Promise<boolean>, ms = 30_000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("timed out");
};

async function main() {
  const conns = await import("@/lib/actions/db-admin/connections");
  const server = await import("@/lib/actions/db-admin/server");
  const colls = await import("@/lib/actions/db-admin/collections");
  const docs = await import("@/lib/actions/db-admin/documents");
  const users = await import("@/lib/actions/db-admin/users");
  const backups = await import("@/lib/actions/db-admin/backups");
  const download = await import("@/app/api/db-admin/backups/[id]/download/route");
  const upload = await import("@/app/api/db-admin/backups/upload/route");
  const { prisma } = await import("@/lib/prisma");
  const { closeAllClients, appDatabaseName } = await import("@/lib/db-admin/pool");
  const { NextRequest } = await import("next/server");

  const raw = new MongoClient(URI!);
  await raw.connect();
  const stamp = Date.now().toString(36);
  const DB = `e2e_src_${stamp}`;
  const DB2 = `e2e_restore_${stamp}`;
  const USER = `e2e_user_${stamp}`;
  const auditStart = new Date();
  let connId = "";

  const uploadReq = (qs: string, body: BodyInit) =>
    new NextRequest(`http://localhost/api/db-admin/backups/upload?${qs}`, {
      method: "POST",
      body,
      duplex: "half",
    });

  try {
    console.log("DB Management e2e");

    await check("1. non-admin is rejected by actions and API routes", async () => {
      setActor(null);
      const results = await Promise.all([
        conns.listConnections(),
        conns.saveConnection({ name: "x", uri: URI! }),
        server.listDatabases("app"),
        server.dropDatabase("app", "x", "x"),
        colls.listCollections("app", "x"),
        docs.findDocuments("app", "x", "y"),
        users.listUsers("app"),
        backups.listBackups(),
        backups.restoreBackup("0".repeat(24), { targetConnectionId: "app", targetDatabase: "x", mode: "merge" }),
      ]);
      for (const r of results) fails(r, /^Unauthorized$/);
      const d = await download.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "0".repeat(24) }) });
      assert.equal(d.status, 401);
      const u = await upload.POST(uploadReq("connectionId=app", "x"));
      assert.equal(u.status, 401);
      setActor(ADMIN);
    });

    await check("2. saved connection: URI encrypted, never listed, test returns version", async () => {
      const t = ok(await conns.testConnection({ uri: URI! }));
      assert.match(t.version, /^\d+\.\d+/);
      const saved = ok(await conns.saveConnection({ name: "E2E server", uri: URI!, description: "e2e" }));
      connId = saved.id;
      const row = await prisma.dbConnection.findUniqueOrThrow({ where: { id: connId } });
      assert.ok(!row.uriEnc.includes("mongodb://"), "uri stored in plain text");
      const password = new URL(URI!.replace(/^mongodb(\+srv)?:/, "http:")).password;
      const listed = ok(await conns.listConnections());
      assert.equal(listed[0].id, "app");
      const json = JSON.stringify(listed);
      assert.ok(!json.includes("mongodb://"), "uri leaked");
      if (password) assert.ok(!json.includes(password), "password leaked");
      assert.ok(listed.some((c) => c.id === connId && c.hosts.length > 0));
      const t2 = ok(await conns.testConnection({ connectionId: connId }));
      assert.equal(t2.version, t.version);
      // edit with empty uri keeps the stored one
      ok(await conns.saveConnection({ id: connId, name: "E2E server 2", uri: "" }));
      const row2 = await prisma.dbConnection.findUniqueOrThrow({ where: { id: connId } });
      assert.equal(row2.uriEnc, row.uriEnc);
      fails(await conns.saveConnection({ id: "app", name: "x" }));
      fails(await conns.deleteConnection("app"));
    });

    const sample = (i: number) => ({
      _id: new ObjectId(),
      i,
      name: `item ${i}`,
      when: new Date(Date.UTC(2024, 0, 1) + i * 60_000),
      big: Long.fromString(`${9007199254740993n + BigInt(i)}`),
      small: Long.fromNumber(i),
      price: Decimal128.fromString(`${i}.25`),
      tags: [`t${i % 5}`, { nested: [i, [i + 1]] }],
      ratio: new BSON.Double(i),
    });
    let firstId: ObjectId;

    await check("3. create db + collection, insert 2,500 typed docs, stats are right", async () => {
      ok(await server.createDatabase(connId, DB, "items"));
      fails(await server.createDatabase(connId, "bad.name", "x"), /cannot contain/);
      const items = Array.from({ length: 2500 }, (_, i) => sample(i));
      firstId = items[0]._id;
      // insert through the action (EJSON in, as the browser sends it)
      const json = BSON.EJSON.stringify(items, { relaxed: false });
      const ins = ok(await docs.insertDocuments(connId, DB, "items", json));
      assert.equal(ins.insertedCount, 2500);
      const stats = ok(await server.getDatabaseStats(connId, DB));
      assert.equal(stats.objects, 2500);
      assert.equal(stats.collections, 1);
      const list = ok(await colls.listCollections(connId, DB));
      assert.equal(list[0].count, 2500);
      const dbs = ok(await server.listDatabases(connId));
      assert.ok(dbs.find((d) => d.name === DB && !d.protected));
      assert.ok(dbs.find((d) => d.name === "admin" && d.system && d.protected));
      const stored = await raw.db(DB).collection("items").findOne({ i: 7 }, { promoteValues: false, promoteLongs: false });
      assert.equal(stored!.big._bsontype, "Long");
      assert.equal(stored!.price._bsontype, "Decimal128");
      assert.ok(stored!.when instanceof Date);
    });

    await check("4. find: EJSON filter, 24-hex shorthand, sort, projection, paging, total", async () => {
      const r = ok(
        await docs.findDocuments(connId, DB, "items", {
          filter: '{"when": {"$gte": {"$date": "2024-01-01T10:00:00Z"}}, "tags.0": "t1"}',
          sort: '{"i": -1}',
          projection: '{"name": 1, "i": 1}',
          skip: 10,
          limit: 5,
        }),
      );
      const expected = await raw
        .db(DB)
        .collection("items")
        .countDocuments({ when: { $gte: new Date("2024-01-01T10:00:00Z") }, "tags.0": "t1" });
      assert.equal(r.total, expected);
      assert.equal(r.documents.length, 5);
      const parsed = r.documents.map((d) => JSON.parse(d));
      assert.deepEqual(Object.keys(parsed[0]).sort(), ["_id", "i", "name"]);
      assert.ok(parsed[0].i > parsed[1].i);
      const byId = ok(await docs.findDocuments(connId, DB, "items", { filter: firstId.toHexString() }));
      assert.equal(byId.total, 1);
      assert.equal(JSON.parse(byId.documents[0]).i, 0);
      const capped = ok(await docs.findDocuments(connId, DB, "items", { limit: 5000 }));
      assert.equal(capped.documents.length, 200);
      fails(await docs.findDocuments(connId, DB, "items", { filter: "{bad" }), /Invalid filter/);
    });

    await check("5. replace keeps Date (and Long) types; _id cannot change", async () => {
      const r = ok(await docs.findDocuments(connId, DB, "items", { filter: firstId.toHexString() }));
      const edited = JSON.parse(r.documents[0]);
      edited.name = "renamed";
      const idJson = JSON.stringify(edited._id);
      ok(await docs.replaceDocument(connId, DB, "items", idJson, JSON.stringify(edited)));
      const after = await raw.db(DB).collection("items").findOne({ _id: firstId }, { promoteValues: false, promoteLongs: false });
      assert.equal(String(after!.name), "renamed");
      assert.ok(after!.when instanceof Date, "Date became " + typeof after!.when);
      assert.equal(after!.small._bsontype, "Long");
      assert.equal(after!.big._bsontype, "Long");
      assert.equal(after!.price._bsontype, "Decimal128");
      assert.equal(after!.ratio._bsontype, "Double");
      fails(
        await docs.replaceDocument(connId, DB, "items", idJson, JSON.stringify({ ...edited, _id: { $oid: new ObjectId().toHexString() } })),
        /_id/,
      );
      // delete one + deleteMatching
      const tmp = ok(await docs.insertDocuments(connId, DB, "items", '[{"tmp":1},{"tmp":1},{"tmp":2}]'));
      ok(await docs.deleteDocument(connId, DB, "items", tmp.ids[2]));
      fails(await docs.deleteMatching(connId, DB, "items", "{}", "items"), /non-empty/);
      fails(await docs.deleteMatching(connId, DB, "items", '{"tmp":1}', "wrong"), /Confirmation/);
      assert.equal(ok(await docs.deleteMatching(connId, DB, "items", '{"tmp":1}', "items")).deletedCount, 2);
    });

    await check("6. unique, TTL and compound indexes; dropping _id_ fails", async () => {
      ok(await colls.createIndex(connId, DB, "items", '{"i": 1}', { unique: true }));
      // only "unique" set: the other options must not be sent as null
      ok(await colls.createIndex(connId, DB, "items", '{"when": 1}', { expireAfterSeconds: 10 ** 9, name: "ttl_when" }));
      ok(await colls.createIndex(connId, DB, "items", '{"name": 1, "i": -1}', { sparse: true }));
      const ix = ok(await colls.listIndexes(connId, DB, "items"));
      assert.equal(ix.length, 4);
      assert.equal(ix.find((x) => x.name === "ttl_when")!.expireAfterSeconds, 10 ** 9);
      assert.ok(ix.find((x) => x.name === "i_1")!.unique);
      ok(await colls.dropIndex(connId, DB, "items", "name_1_i_-1"));
      fails(await colls.dropIndex(connId, DB, "items", "_id_"), /_id_/);
      fails(await colls.createIndex(connId, DB, "items", '{"x": 5}'), /Invalid direction/);
    });

    await check("7. capped collection, view, rename, clear", async () => {
      ok(await colls.createCollection(connId, DB, "events", { capped: true, size: 1 << 20, max: 1000 }));
      ok(await colls.createCollection(connId, DB, "plain", {}));
      fails(await colls.createCollection(connId, DB, "c2", { capped: true }), /size/);
      await raw.db(DB).collection("events").insertMany([{ e: 1 }, { e: 2 }]);
      await raw.db(DB).createCollection("cheap", { viewOn: "items", pipeline: [{ $match: { i: { $lt: 10 } } }] });
      ok(await colls.renameCollection(connId, DB, "plain", "plain2"));
      fails(await colls.renameCollection(connId, DB, "plain2", "items"), /exists/);
      await raw.db(DB).collection("plain2").insertOne({ a: 1 });
      ok(await colls.clearCollection(connId, DB, "plain2", "plain2"));
      assert.equal(await raw.db(DB).collection("plain2").countDocuments(), 0);
      const list = ok(await colls.listCollections(connId, DB));
      assert.ok(list.find((c) => c.name === "events")!.capped);
      assert.equal(list.find((c) => c.name === "cheap")!.type, "view");
    });

    let backupId = "";
    await check("8. backup → restore into new db (drop mode): deep-equal docs, indexes, views", async () => {
      const b = ok(await backups.createBackup(connId, DB, { name: "e2e full" }));
      assert.equal(b.status, "running");
      backupId = b.id;
      await until(async () => (await prisma.dbBackup.findUniqueOrThrow({ where: { id: b.id } })).status !== "running");
      const done = ok(await backups.getBackup(b.id));
      assert.equal(done.status, "completed", done.error ?? "");
      assert.equal(done.documentCount, 2500 + 2);
      assert.ok(done.sizeBytes > 0);

      const r = ok(
        await backups.restoreBackup(b.id, { targetConnectionId: connId, targetDatabase: DB2, mode: "drop" }),
      );
      assert.equal(r.documents, 2502);
      assert.equal(r.skipped, 0);
      for (const c of ["items", "events", "plain2"]) {
        const opts = { promoteValues: false, promoteLongs: false, sort: { _id: 1 } } as const;
        const a = await raw.db(DB).collection(c).find({}, opts).toArray();
        const z = await raw.db(DB2).collection(c).find({}, opts).toArray();
        assert.equal(BSON.EJSON.stringify(z, { relaxed: false }), BSON.EJSON.stringify(a, { relaxed: false }), c);
        const strip = (ix: any[]) => ix.map(({ v, ns, ...rest }) => rest).sort((p, q) => p.name.localeCompare(q.name));
        assert.deepEqual(
          strip(await raw.db(DB2).collection(c).listIndexes().toArray()),
          strip(await raw.db(DB).collection(c).listIndexes().toArray()),
          `${c} indexes`,
        );
      }
      const info = await raw.db(DB2).listCollections().toArray();
      const events = info.find((i) => i.name === "events") as any;
      assert.ok(events.options.capped, "capped lost");
      const view = info.find((i) => i.name === "cheap") as any;
      assert.equal(view.type, "view");
      assert.equal(await raw.db(DB2).collection("cheap").countDocuments(), 10);
    });

    await check("9. merge restore adds only missing docs and reports kept ones", async () => {
      const items = raw.db(DB2).collection("items");
      await items.deleteMany({ i: { $gte: 2000 } }); // 500 missing
      await items.updateMany({ i: { $lt: 12 } }, { $set: { name: "modified" } });
      const r = ok(
        await backups.restoreBackup(backupId, {
          targetConnectionId: connId,
          targetDatabase: DB2,
          mode: "merge",
          collections: ["items"],
        }),
      );
      assert.equal(r.documents, 500);
      assert.equal(r.skipped, 2000);
      assert.ok(r.warnings.some((w) => w === "items: 2000 existing document(s) kept"), r.warnings.join("; "));
      assert.equal(await items.countDocuments(), 2500);
      assert.equal(await items.countDocuments({ name: "modified" }), 12);
    });

    await check("10. users: create on two dbs, update roles, change password, connect, drop", async () => {
      const created = ok(
        await users.createUser(connId, {
          username: USER,
          password: "initial-pass-123",
          authDb: DB,
          roles: [
            { role: "readWrite", db: DB },
            { role: "read", db: DB2 },
          ],
        }),
      );
      assert.ok(created.connectionString.includes(`authSource=${DB}`));
      fails(await users.createUser(connId, { username: "x", password: "short", authDb: DB, roles: [] }), /8 characters/);
      const list = ok(await users.listUsers(connId));
      const u = list.users.find((x) => x.user === USER)!;
      assert.equal(u.roles.length, 2);
      ok(await users.updateUserRoles(connId, USER, DB, [{ role: "read", db: DB }, { role: "clusterMonitor", db: DB }]));
      const u2 = ok(await users.listUsers(connId)).users.find((x) => x.user === USER)!;
      assert.deepEqual(
        u2.roles.map((r) => `${r.role}@${r.db}`).sort(),
        ["clusterMonitor@admin", `read@${DB}`],
      );
      ok(await users.changeUserPassword(connId, USER, DB, "changed-pass-456"));
      const cs = created.connectionString.replace(encodeURIComponent("initial-pass-123"), encodeURIComponent("changed-pass-456"));
      const c = new MongoClient(cs, { serverSelectionTimeoutMS: 5000 });
      await c.connect();
      assert.equal(await c.db(DB).collection("items").countDocuments(), 2500);
      await assert.rejects(c.db(DB).collection("items").insertOne({ nope: 1 }), /not authorized/);
      await c.close();
      const me = ok(await users.listUsers(connId)).currentUser!;
      fails(await users.dropUser(connId, me.user, me.db), /signed in as/);
      ok(await users.dropUser(connId, USER, DB));
      assert.ok(!ok(await users.listUsers(connId)).users.some((x) => x.user === USER));
      const roles = ok(await users.listCustomRoles(connId));
      assert.ok(Array.isArray(roles));
    });

    await check("11. app database protected; wrong confirmName rejected", async () => {
      const appDb = appDatabaseName();
      await raw.db(appDb).collection("_e2e_marker").insertOne({ x: 1 });
      fails(await server.dropDatabase("app", appDb, appDb), /protected/);
      fails(await server.dropDatabase(connId, appDb, appDb), /protected/); // same hosts via a saved connection
      fails(await server.dropDatabase(connId, "admin", "admin"), /protected/);
      fails(await server.dropDatabase(connId, DB2, "wrong"), /Confirmation/);
      fails(
        await backups.restoreBackup(backupId, { targetConnectionId: "app", targetDatabase: appDb, mode: "drop" }),
        /protected/,
      );
      assert.ok(ok(await server.listDatabases("app")).find((d) => d.name === appDb)!.protected);
    });

    await check("12. upload valid backup registers; garbage / truncated rejected; missing id 404", async () => {
      const dl = await download.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: backupId }) });
      assert.equal(dl.status, 200);
      assert.match(dl.headers.get("content-disposition")!, /attachment; filename=".*\.ndjson\.gz"/);
      const bytes = Buffer.from(await dl.arrayBuffer());
      assert.ok(zlib.gunzipSync(bytes).toString().startsWith('{"type":"header"'));

      const up = await upload.POST(uploadReq(`connectionId=${connId}&name=uploaded`, bytes));
      assert.equal(up.status, 200, await up.clone().text());
      const reg = (await up.json()).data;
      assert.equal(reg.source, "upload");
      assert.equal(reg.documentCount, 2502);
      assert.equal(reg.database, DB);

      const truncated = bytes.subarray(0, Math.floor(bytes.length / 2));
      assert.equal((await upload.POST(uploadReq(`connectionId=${connId}`, truncated))).status, 400);
      assert.equal((await upload.POST(uploadReq(`connectionId=${connId}`, "garbage!"))).status, 400);
      // valid gzip, but cut before the end line
      const noEnd = zlib.gzipSync(zlib.gunzipSync(bytes).toString().split("\n").slice(0, 50).join("\n"));
      assert.equal((await upload.POST(uploadReq(`connectionId=${connId}`, noEnd))).status, 400);
      assert.equal((await upload.POST(uploadReq(`connectionId=${"f".repeat(24)}`, bytes))).status, 400);
      const leftovers = fs.readdirSync(process.env.DB_BACKUP_DIR!).filter((f) => f.endsWith(".tmp"));
      assert.deepEqual(leftovers, []);
      const missing = await download.GET(new Request("http://localhost/x"), { params: Promise.resolve({ id: "0".repeat(24) }) });
      assert.equal(missing.status, 404);
      ok(await backups.deleteBackup(reg.id));
    });

    await check("13. every mutation wrote an audit row with the right success value", async () => {
      const rows = await prisma.dbAuditLog.findMany({ where: { at: { gte: auditStart } }, orderBy: { at: "asc" } });
      const has = (action: string, success: boolean) =>
        assert.ok(rows.some((r) => r.action === action && r.success === success), `${action} success=${success}`);
      for (const a of [
        "connection.create",
        "connection.update",
        "database.create",
        "document.insert",
        "document.replace",
        "document.delete",
        "document.deleteMany",
        "index.create",
        "index.drop",
        "collection.create",
        "collection.rename",
        "collection.clear",
        "backup.create",
        "backup.restore",
        "backup.download",
        "backup.upload",
        "backup.delete",
        "user.create",
        "user.updateRoles",
        "user.changePassword",
        "user.drop",
      ])
        has(a, true);
      for (const a of [
        "connection.update",
        "connection.delete",
        "database.create",
        "database.drop",
        "document.replace",
        "document.deleteMany",
        "index.drop",
        "index.create",
        "collection.create",
        "collection.rename",
        "backup.restore",
        "backup.upload",
        "user.create",
        "user.drop",
      ])
        has(a, false);
      assert.ok(rows.every((r) => r.userId === ADMIN.userId));
      const blob = JSON.stringify(rows);
      assert.ok(!blob.includes("mongodb://"), "URI in audit log");
      assert.ok(!blob.includes("initial-pass-123") && !blob.includes("changed-pass-456"), "password in audit log");
      // failures carry the error message
      assert.ok(rows.find((r) => r.action === "database.drop" && !r.success)!.error);
    });

    // clean up
    ok(await backups.deleteBackup(backupId));
    ok(await server.dropDatabase(connId, DB, DB));
    ok(await server.dropDatabase(connId, DB2, DB2));
    await raw.db(appDatabaseName()).collection("_e2e_marker").drop().catch(() => undefined);
    ok(await conns.deleteConnection(connId));
    console.log(`\nAll ${passed} checks passed.`);
  } finally {
    await raw.close();
    await closeAllClients();
    await prisma.$disconnect();
    const { getMongoClient } = await import("@/lib/db");
    await getMongoClient().close().catch(() => undefined);
  }
}

main().then(
  () => process.exit(0),
  () => process.exit(1),
);
