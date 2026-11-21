import { ErrorCard } from "@/components/db-admin/error-card";
import { DbPageHeader } from "@/components/db-admin/page-header";
import { listBackups } from "@/lib/actions/db-admin/backups";
import { getConnection, listConnections } from "@/lib/actions/db-admin/connections";
import { getServerOverview, listDatabases } from "@/lib/actions/db-admin/server";
import { listCustomRoles, listUsers } from "@/lib/actions/db-admin/users";
import { formatUptime } from "@/lib/db-admin/format";
import { dbPath, decodeSegment } from "@/lib/db-admin/paths";
import { ConnectionView, ConnectionTab } from "../_components/connection-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const TABS: ConnectionTab[] = ["databases", "users", "backups"];

export default async function ConnectionPage(
  props: {
    params: Promise<{ connectionId: string }>;
    searchParams: Promise<{ tab?: string; database?: string }>;
  }
) {
  const searchParams = await props.searchParams;
  const params = await props.params;
  const connectionId = decodeSegment(params.connectionId);
  const tab = TABS.includes(searchParams.tab as ConnectionTab) ? (searchParams.tab as ConnectionTab) : "databases";
  const conn = await getConnection(connectionId);
  const crumbs = [{ label: "DB Management", href: dbPath() }, { label: conn.success ? conn.data.name : connectionId }];
  if (!conn.success)
    return (
      <div className="space-y-6 p-4 pb-16 md:px-6">
        <DbPageHeader crumbs={crumbs} title="Connection" />
        <ErrorCard title="Could not connect" error={conn.error} />
      </div>
    );

  const [overview, databases, backups, connections] = await Promise.all([
    getServerOverview(connectionId),
    listDatabases(connectionId),
    listBackups(connectionId),
    listConnections(),
  ]);
  const canUsers = overview.success && overview.data.canListUsers;
  const [users, roles] = canUsers
    ? await Promise.all([listUsers(connectionId), listCustomRoles(connectionId)])
    : [null, null];

  const o = overview.success ? overview.data : null;
  return (
    <div className="space-y-6 p-4 pb-16 md:px-6">
      <DbPageHeader
        crumbs={crumbs}
        title={conn.data.name}
        subtitle={
          o ? (
            <span className="flex flex-wrap gap-x-4 gap-y-1">
              <span>MongoDB {o.version}</span>
              {o.replicaSet && <span>replica set {o.replicaSet}</span>}
              <span>uptime {formatUptime(o.uptimeSeconds)}</span>
              <span>{o.connections != null ? `${o.connections} client connections` : "client connections —"}</span>
              <span className="font-mono">{conn.data.hosts.join(", ")}</span>
            </span>
          ) : (
            <span className="font-mono">{conn.data.hosts.join(", ")}</span>
          )
        }
      />
      {!overview.success && <ErrorCard title="Server info unavailable" error={overview.error} />}
      <ConnectionView
        connection={conn.data}
        initialTab={tab}
        initialDatabase={searchParams.database ?? null}
        databases={databases}
        users={users}
        customRoles={roles?.success ? roles.data : []}
        canListUsers={!!canUsers}
        backups={backups}
        connections={connections.success ? connections.data : [conn.data]}
      />
    </div>
  );
}
