"use server";

import type { MongoClient } from "mongodb";
import { DbAdminError, isUnauthorizedError } from "@/lib/db-admin/errors";
import { validateDatabaseName } from "@/lib/db-admin/names";
import { getClient } from "@/lib/db-admin/pool";
import { mutate, read } from "@/lib/db-admin/run";
import type { CustomRole, DbUserInfo, RoleRef, UsersResult } from "@/lib/db-admin/types";
import { uriWithCredentials } from "@/lib/db-admin/uri";

function mapUser(u: any): DbUserInfo {
  return {
    user: String(u.user),
    db: String(u.db),
    roles: (u.roles ?? []).map((r: any) => ({ role: String(r.role), db: String(r.db) })),
    mechanisms: (u.mechanisms ?? []).map(String),
  };
}

async function currentUser(client: MongoClient) {
  const s = await client
    .db("admin")
    .command({ connectionStatus: 1 })
    .catch(() => null);
  const u = s?.authInfo?.authenticatedUsers?.[0];
  return u ? { user: String(u.user), db: String(u.db) } : null;
}

async function databaseNames(client: MongoClient) {
  const res = await client.db("admin").admin().listDatabases({ nameOnly: true, authorizedDatabases: true });
  return res.databases.map((d) => d.name);
}

export async function listUsers(connectionId: string) {
  return read("Failed to list users", async (): Promise<UsersResult> => {
    const { client } = await getClient(connectionId);
    const me = await currentUser(client);
    try {
      const res = await client.db("admin").command({ usersInfo: { forAllDBs: true } });
      return { users: (res.users ?? []).map(mapUser), partial: false, currentUser: me };
    } catch (e) {
      if (!isUnauthorizedError(e)) throw e;
    }
    // forAllDBs denied: ask each database we can see (plus our own auth db)
    const names = new Set(await databaseNames(client).catch(() => [] as string[]));
    if (me) names.add(me.db);
    const users: DbUserInfo[] = [];
    await Promise.all(
      [...names].map(async (db) => {
        const res = await client
          .db(db)
          .command({ usersInfo: 1 })
          .catch(() => null);
        for (const u of res?.users ?? []) users.push(mapUser(u));
      }),
    );
    users.sort((a, b) => a.db.localeCompare(b.db) || a.user.localeCompare(b.user));
    return { users, partial: true, currentUser: me };
  });
}

export async function listCustomRoles(connectionId: string) {
  return read("Failed to list roles", async (): Promise<CustomRole[]> => {
    const { client } = await getClient(connectionId);
    const names = await databaseNames(client);
    const roles: CustomRole[] = [];
    await Promise.all(
      names.map(async (db) => {
        const res = await client
          .db(db)
          .command({ rolesInfo: 1, showBuiltinRoles: false })
          .catch(() => null);
        for (const r of res?.roles ?? []) roles.push({ role: String(r.role), db: String(r.db) });
      }),
    );
    return roles.sort((a, b) => a.db.localeCompare(b.db) || a.role.localeCompare(b.role));
  });
}

const ANY_DB_ROLES = new Set([
  "readAnyDatabase",
  "readWriteAnyDatabase",
  "dbAdminAnyDatabase",
  "userAdminAnyDatabase",
  "clusterMonitor",
  "clusterManager",
  "clusterAdmin",
  "backup",
  "restore",
  "root",
]);

function cleanRoles(roles: RoleRef[]): RoleRef[] {
  if (!Array.isArray(roles)) throw new DbAdminError("Roles must be a list");
  const seen = new Set<string>();
  const out: RoleRef[] = [];
  for (const r of roles) {
    const role = String(r?.role ?? "").trim();
    if (!role) continue;
    const db = ANY_DB_ROLES.has(role) ? "admin" : validateDatabaseName(String(r?.db ?? ""));
    const key = `${role}@${db}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ role, db });
  }
  return out;
}

function validateUsername(u: string) {
  const name = (u ?? "").trim();
  if (!name) throw new DbAdminError("Username is required");
  if (name.length > 128 || /[\s\0]/.test(name)) throw new DbAdminError("Invalid username");
  return name;
}

function validatePassword(p: string) {
  if (!p || p.length < 8) throw new DbAdminError("Password must be at least 8 characters");
  return p;
}

export async function createUser(
  connectionId: string,
  input: { username: string; password: string; authDb: string; roles: RoleRef[] },
) {
  return mutate(
    {
      action: "user.create",
      connectionId,
      target: `${input.authDb}.${input.username}`,
      details: { roles: input.roles },
    },
    "Failed to create user",
    async () => {
      const user = validateUsername(input.username);
      const pwd = validatePassword(input.password);
      const authDb = validateDatabaseName(input.authDb);
      const roles = cleanRoles(input.roles);
      const { client, conn } = await getClient(connectionId);
      await client.db(authDb).command({ createUser: user, pwd, roles });
      return {
        user,
        db: authDb,
        roles,
        // shown once in the UI with a copy button; never stored or audited
        connectionString: uriWithCredentials(conn.uri, user, pwd, authDb),
      };
    },
  );
}

/** replaces the user's roles with the full list given */
export async function updateUserRoles(connectionId: string, user: string, authDb: string, roles: RoleRef[]) {
  return mutate(
    { action: "user.updateRoles", connectionId, target: `${authDb}.${user}`, details: { roles } },
    "Failed to update roles",
    async () => {
      const clean = cleanRoles(roles);
      const { client } = await getClient(connectionId);
      await client.db(validateDatabaseName(authDb)).command({ updateUser: validateUsername(user), roles: clean });
      return { roles: clean };
    },
  );
}

export async function changeUserPassword(connectionId: string, user: string, authDb: string, password: string) {
  return mutate(
    { action: "user.changePassword", connectionId, target: `${authDb}.${user}` },
    "Failed to change password",
    async () => {
      const pwd = validatePassword(password);
      const { client } = await getClient(connectionId);
      await client.db(validateDatabaseName(authDb)).command({ updateUser: validateUsername(user), pwd });
      return { user };
    },
  );
}

export async function dropUser(connectionId: string, user: string, authDb: string) {
  return mutate({ action: "user.drop", connectionId, target: `${authDb}.${user}` }, "Failed to drop user", async () => {
    const { client } = await getClient(connectionId);
    const me = await currentUser(client);
    if (me && me.user === user && me.db === authDb)
      throw new DbAdminError("You cannot drop the user this connection is signed in as");
    await client.db(validateDatabaseName(authDb)).command({ dropUser: validateUsername(user) });
    return { user };
  });
}
