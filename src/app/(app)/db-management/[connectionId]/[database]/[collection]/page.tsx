import { ErrorCard } from "@/components/db-admin/error-card";
import { DbPageHeader } from "@/components/db-admin/page-header";
import { Badge } from "@/components/ui/badge";
import { listCollections, listIndexes } from "@/lib/actions/db-admin/collections";
import { findDocuments } from "@/lib/actions/db-admin/documents";
import { getConnection } from "@/lib/actions/db-admin/connections";
import { formatBytes, formatNumber } from "@/lib/db-admin/format";
import { dbPath, decodeSegment } from "@/lib/db-admin/paths";
import { DocumentsBrowser } from "../../../_components/documents-browser";
import { IndexesPanel } from "../../../_components/indexes-panel";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function CollectionPage(
  props: {
    params: Promise<{ connectionId: string; database: string; collection: string }>;
  }
) {
  const params = await props.params;
  const connectionId = decodeSegment(params.connectionId);
  const database = decodeSegment(params.database);
  const collection = decodeSegment(params.collection);
  const conn = await getConnection(connectionId);
  const crumbs = [
    { label: "DB Management", href: dbPath() },
    { label: conn.success ? conn.data.name : connectionId, href: dbPath(connectionId) },
    { label: database, href: dbPath(connectionId, database) },
    { label: collection },
  ];
  if (!conn.success)
    return (
      <div className="space-y-6 p-4 pb-16 md:px-6">
        <DbPageHeader crumbs={crumbs} title={collection} />
        <ErrorCard title="Could not connect" error={conn.error} />
      </div>
    );

  const [colls, docs, indexes] = await Promise.all([
    listCollections(connectionId, database),
    findDocuments(connectionId, database, collection, { limit: 20 }),
    listIndexes(connectionId, database, collection),
  ]);
  const info = colls.success ? colls.data.find((c) => c.name === collection) : undefined;
  const readOnly = collection.startsWith("system.") || info?.type === "view";

  return (
    <div className="space-y-6 p-4 pb-16 md:px-6">
      <DbPageHeader
        crumbs={crumbs}
        title={<span className="font-mono">{collection}</span>}
        subtitle={
          info ? (
            <span className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">{info.type}</Badge>
              {info.capped && <Badge variant="secondary">capped</Badge>}
              {info.viewOn && <span>view on {info.viewOn}</span>}
              {info.count != null && <span>{formatNumber(info.count)} documents</span>}
              {info.size != null && <span>{formatBytes(info.size)}</span>}
            </span>
          ) : null
        }
      />
      {docs.success ? (
        <DocumentsBrowser
          connectionId={connectionId}
          database={database}
          collection={collection}
          initial={docs.data}
          readOnly={readOnly}
        />
      ) : (
        <ErrorCard error={docs.error} />
      )}
      {info?.type !== "view" &&
        (indexes.success ? (
          <IndexesPanel
            connectionId={connectionId}
            database={database}
            collection={collection}
            indexes={indexes.data}
            readOnly={readOnly}
          />
        ) : (
          <ErrorCard title="Indexes unavailable" error={indexes.error} />
        ))}
    </div>
  );
}
