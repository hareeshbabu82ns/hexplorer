import { ErrorCard } from "@/components/db-admin/error-card";
import { DbPageHeader } from "@/components/db-admin/page-header";
import { listConnections } from "@/lib/actions/db-admin/connections";
import { ConnectionsView } from "./_components/connections-view";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function DbManagementPage() {
  const res = await listConnections();
  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 px-4 py-6 pb-16 md:px-8 md:py-8">
      <DbPageHeader
        crumbs={[{ label: "DB Management" }]}
        title="DB Management"
        subtitle="Manage MongoDB servers: databases, collections, documents, users and backups."
      />
      {res.success ? <ConnectionsView connections={res.data} /> : <ErrorCard error={res.error} />}
    </div>
  );
}
