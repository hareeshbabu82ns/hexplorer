"use client";

import { useState } from "react";
import { ErrorCard } from "@/components/db-admin/error-card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type {
  ActionResult,
  BackupSummary,
  ConnectionSummary,
  CustomRole,
  DatabaseInfo,
  UsersResult,
} from "@/lib/db-admin/types";
import { BackupsTab } from "./backups-tab";
import { DatabasesTab } from "./databases-tab";
import { UsersTab } from "./users-tab";

export type ConnectionTab = "databases" | "users" | "backups";

export function ConnectionView({
  connection,
  initialTab,
  initialDatabase,
  databases,
  users,
  customRoles,
  canListUsers,
  backups,
  connections,
}: {
  connection: ConnectionSummary;
  initialTab: ConnectionTab;
  initialDatabase: string | null;
  databases: ActionResult<DatabaseInfo[]>;
  users: ActionResult<UsersResult> | null;
  customRoles: CustomRole[];
  canListUsers: boolean;
  backups: ActionResult<BackupSummary[]>;
  connections: ConnectionSummary[];
}) {
  const [tab, setTab] = useState<ConnectionTab>(initialTab);
  // database to open the create-backup dialog for (from "Back up" on the databases tab)
  const [backupDb, setBackupDb] = useState<string | null>(initialTab === "backups" ? initialDatabase : null);

  const go = (t: ConnectionTab, database?: string | null) => {
    setTab(t);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", t);
    if (database) url.searchParams.set("database", database);
    else url.searchParams.delete("database");
    window.history.replaceState(null, "", url);
  };

  const dbNames = databases.success ? databases.data.map((d) => d.name) : [];

  return (
    <Tabs value={tab} onValueChange={(v) => go(v as ConnectionTab)}>
      <TabsList>
        <TabsTrigger value="databases">Databases</TabsTrigger>
        <TabsTrigger value="users">Users &amp; roles</TabsTrigger>
        <TabsTrigger value="backups">Backups</TabsTrigger>
      </TabsList>
      <TabsContent value="databases" className="mt-4">
        {databases.success ? (
          <DatabasesTab
            connectionId={connection.id}
            databases={databases.data}
            onBackup={(db) => {
              setBackupDb(db);
              go("backups", db);
            }}
          />
        ) : (
          <ErrorCard error={databases.error} />
        )}
      </TabsContent>
      <TabsContent value="users" className="mt-4">
        {!canListUsers ? (
          <ErrorCard
            title="Users are not available"
            error="The user this connection signs in as is not allowed to run usersInfo. Connect with a user that has userAdmin / userAdminAnyDatabase to manage users."
          />
        ) : users && !users.success ? (
          <ErrorCard error={users.error} />
        ) : users ? (
          <UsersTab connectionId={connection.id} data={users.data} customRoles={customRoles} databases={dbNames} />
        ) : null}
      </TabsContent>
      <TabsContent value="backups" className="mt-4">
        {backups.success ? (
          <BackupsTab
            connection={connection}
            initial={backups.data}
            databases={dbNames}
            connections={connections}
            createFor={backupDb}
            onCreateHandled={() => setBackupDb(null)}
          />
        ) : (
          <ErrorCard error={backups.error} />
        )}
      </TabsContent>
    </Tabs>
  );
}
