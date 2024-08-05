import { Separator } from "@/components/ui/separator";
import { AppearanceForm } from "@/app/settings/appearance/appearance-form";

export default function SettingsAppearancePage() {
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-medium">Appearance</h3>
        <p className="text-muted-foreground text-sm">
          Customize the appearance of the app.
        </p>
      </div>
      <Separator />
      <AppearanceForm />
    </div>
  );
}
