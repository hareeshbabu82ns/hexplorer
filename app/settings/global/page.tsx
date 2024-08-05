import { Separator } from "@/components/ui/separator";

export default function SettingsAppearancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Global</h3>
        <p className="text-muted-foreground text-sm">
          Global settings across apps.
        </p>
      </div>
      <Separator />
    </div>
  );
}
