import { Separator } from "@/components/ui/separator";
import config from "@/config/config";
import { getDbStatus } from "@/lib/actions/folders";
import { mountsRoot } from "@/lib/mounts";

export const dynamic = "force-dynamic";

export default async function SettingsGlobalPage() {
  const status = await getDbStatus();
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Global</h3>
        <p className="text-muted-foreground text-sm">Database and storage status.</p>
      </div>
      <Separator />
      <div className="space-y-2 rounded-lg border p-4 text-sm">
        <div className="font-medium">MongoDB (DATABASE_URL)</div>
        {status.ok ? (
          <p className="text-green-600">
            Connected — {status.folderCount} folders, ~{status.fileCount.toLocaleString()} indexed
            entries. Collections and indexes are created automatically.
          </p>
        ) : (
          <p className="text-destructive">Not connected: {status.error}</p>
        )}
      </div>
      <div className="space-y-1 rounded-lg border p-4 text-sm">
        <div className="font-medium">Paths</div>
        <p>
          DATA_FOLDER: <code>{config.dataFolder}</code> (relative folder paths resolve here)
        </p>
        <p>
          Mounts root: <code>{mountsRoot()}</code> (sshfs mounts of remotes)
        </p>
      </div>
    </div>
  );
}
