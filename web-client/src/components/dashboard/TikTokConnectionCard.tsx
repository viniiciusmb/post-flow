import { IconHeart, IconUsers, IconMovie } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import type { ClientDashboardResponse } from "@/types/api"

function formatCount(n: number | null | undefined) {
  if (n === null || n === undefined) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}mil`
  return String(n)
}

export function TikTokConnectionCard({
  account,
}: {
  account: ClientDashboardResponse["tiktokAccount"]
}) {
  const hasStats = account.connected && account.followerCount !== null && account.followerCount !== undefined

  return (
    <Card className="border-border bg-card">
      <CardHeader>
        <CardTitle className="text-base">Conta TikTok</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-4">
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
        </div>

        {account.connected && (
          <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4 text-sm">
            {hasStats ? (
              <>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <IconUsers className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{formatCount(account.followerCount)}</span>
                  <span className="text-muted-foreground">seguidores</span>
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <IconHeart className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{formatCount(account.likesCount)}</span>
                  <span className="text-muted-foreground">curtidas</span>
                </span>
                <span className="flex items-center gap-1.5 tabular-nums">
                  <IconMovie className="size-4 text-muted-foreground" />
                  <span className="font-semibold">{formatCount(account.videoCount)}</span>
                  <span className="text-muted-foreground">vídeos no perfil</span>
                </span>
              </>
            ) : (
              <p className="text-xs text-muted-foreground">
                Seguidores e curtidas aparecem aqui depois que você{" "}
                <a href="/auth/tiktok/connect" className="font-medium text-primary hover:underline">
                  reconectar a conta
                </a>{" "}
                (a permissão de estatísticas foi adicionada depois da sua última conexão).
              </p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
