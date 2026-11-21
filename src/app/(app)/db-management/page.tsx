import { ErrorCard } from "@/components/db-admin/error-card";
import { DbPageHeader } from "@/components/db-admin/page-header";
import { listConnections } from "@/lib/actions/db-admin/connections";
import { ConnectionsView } from "./_components/connections-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DbManagementPage() {
  const res = await listConnections();
  return (
    <div className="space-y-6 p-4 pb-16 md:px-6">
      <DbPageHeader
        crumbs={[{ label: "DB Management" }]}
        title="DB Management"
        subtitle="Manage MongoDB servers: databases, collections, documents, users and backups."
      />
      {res.success ? <ConnectionsView connections={res.data} /> : <ErrorCard error={res.error} />}
    </div>
  );
}
