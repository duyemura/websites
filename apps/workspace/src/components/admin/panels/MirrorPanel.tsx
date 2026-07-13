import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface MirrorPanelProps {
  siteUuid: string;
}

export function MirrorPanel({ siteUuid }: MirrorPanelProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mirror pipeline</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 text-sm text-muted-foreground">
        <p>Mirror status and controls are not wired yet for {siteUuid}.</p>
        <p>Use the existing `GET /api/sites/:uuid/mirror` and `POST /api/sites/:uuid/mirror/run` endpoints directly for now.</p>
      </CardContent>
    </Card>
  );
}
