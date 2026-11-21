import { AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export function ErrorCard({ title = "Could not load data", error }: { title?: string; error: string }) {
  return (
    <Card className="border-destructive/50">
      <CardHeader className="flex flex-row items-center gap-2 space-y-0">
        <AlertTriangle className="text-destructive size-5" />
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-muted-foreground whitespace-pre-wrap wrap-break-word font-mono text-sm">{error}</p>
      </CardContent>
    </Card>
  );
}
