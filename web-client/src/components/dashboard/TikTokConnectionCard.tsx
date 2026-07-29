import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { ClientDashboardResponse } from "@/types/api"

export function TikTokConnectionCard({
  account,
}: {
  account: ClientDashboardResponse["tiktokAccount"]
}) {
  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Conta TikTok</CardTitle>
      </CardHeader>
      <CardContent className="flex items-center justify-between gap-4">
        {account.connected ? (
          <>
            <p className="text-sm text-muted-foreground">
              Conectada: <span className="font-medium text-foreground">{account.displayName}</span>
            </p>
            <Button asChild variant="outline" size="sm">
              <a href="/auth/tiktok/connect">Reconectar / trocar de conta</a>
            </Button>
          </>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Nenhuma conta TikTok conectada ainda.</p>
            <Button asChild size="sm">
              <a href="/auth/tiktok/connect">Conectar TikTok</a>
            </Button>
          </>
        )}
      </CardContent>
    </Card>
  )
}
