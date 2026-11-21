import { ErrorCard } from "@/components/db-admin/error-card";
import { DbPageHeader, StatCard } from "@/components/db-admin/page-header";
import { listCollections } from "@/lib/actions/db-admin/collections";
import { getConnection } from "@/lib/actions/db-admin/connections";
import { getDatabaseStats, listDatabases } from "@/lib/actions/db-admin/server";
import { formatBytes, formatNumber } from "@/lib/db-admin/format";
import { dbPath, decodeSegment } from "@/lib/db-admin/paths";
import { CollectionsView, DatabaseHeader } from "../../_components/collections-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DatabasePage(props: { params: Promise<{ connectionId: string; database: string }> }) {
  const params = await props.params;
  const connectionId = decodeSegment(params.connectionId);
  const database = decodeSegment(params.database);
  const conn = await getConnection(connectionId);
  const crumbs = [
    { label: "DB Management", href: dbPath() },
    { label: conn.success ? conn.data.name : connectionId, href: dbPath(connectionId) },
    { label: database },
  ];
  if (!conn.success)
    return (
      <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 pb-16 md:px-8 md:py-8">
        <DbPageHeader crumbs={crumbs} title={database} />
        <ErrorCard title="Could not connect" error={conn.error} />
      </div>
    );
  const [stats, collections, dbs] = await Promise.all([
    getDatabaseStats(connectionId, database),
    listCollections(connectionId, database),
    listDatabases(connectionId),
  ]);
  const info = dbs.success ? dbs.data.find((d) => d.name === database) : undefined;

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 pb-16 md:px-8 md:py-8">
      <DatabaseHeader
        crumbs={crumbs}
        connectionId={connectionId}
        database={database}
        isProtected={info?.protected ?? true}
      />
      {stats.success ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <StatCard label="Collections" value={formatNumber(stats.data.collections)} />
          <StatCard label="Views" value={formatNumber(stats.data.views)} />
          <StatCard label="Documents" value={formatNumber(stats.data.objects)} />
          <StatCard label="Data size" value={formatBytes(stats.data.dataSize)} />
          <StatCard label="Storage size" value={formatBytes(stats.data.storageSize)} />
          <StatCard label="Index size" value={formatBytes(stats.data.indexSize)} />
        </div>
      ) : (
        <ErrorCard title="Stats unavailable" error={stats.error} />
      )}
      {collections.success ? (
        <CollectionsView connectionId={connectionId} database={database} collections={collections.data} />
      ) : (
        <ErrorCard error={collections.error} />
      )}
    </div>
  );
}
