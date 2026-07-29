import { useEffect, useState } from "react"
import { IconBrandTiktok } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { TikTokAccountResponse } from "@/types/api"

export function TikTokAccountPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<TikTokAccountResponse | null>(null)

  useEffect(() => {
    if (!user) return
    api.get<TikTokAccountResponse>("/api/client/tiktok-account").then(setData)
  }, [user])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Conta TikTok">
      <p className="-mt-2 text-sm text-muted-foreground">
        A conta conectada aqui é onde os cortes gerados automaticamente são publicados.
      </p>

      {!data ? (
        <Skeleton className="h-28" />
      ) : (
        <Card>
          <CardContent className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-4">
              <Avatar className="size-11 bg-foreground text-background">
                {data.connected && data.avatarUrl && <AvatarImage src={data.avatarUrl} alt="" />}
                <AvatarFallback className="bg-foreground text-background">
                  <IconBrandTiktok className="size-5" />
                </AvatarFallback>
              </Avatar>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold">
                    {data.connected ? data.displayName : "Nenhuma conta conectada"}
                  </span>
                  <TonePill tone={data.connected ? "success" : "neutral"}>
                    {data.connected ? "Conectada" : "Desconectada"}
                  </TonePill>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {data.connected
                    ? `Conectada em ${new Date(data.connectedAt).toLocaleDateString("pt-BR")} — as postagens são feitas automaticamente neste perfil.`
                    : "Conecte uma conta TikTok pra que os cortes gerados possam ser publicados."}
                </p>
              </div>
            </div>
            <Button asChild variant={data.connected ? "outline" : "default"}>
              <a href="/auth/tiktok/connect">
                {data.connected ? "Reconectar / trocar de conta" : "Conectar TikTok"}
              </a>
            </Button>
          </CardContent>
        </Card>
      )}
    </DashboardLayout>
  )
}
