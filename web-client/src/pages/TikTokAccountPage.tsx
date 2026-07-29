import { useEffect, useState } from "react"
import { IconBrandTiktok, IconHeart, IconUsers, IconMovie } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { TikTokAccountResponse } from "@/types/api"

export function TikTokAccountPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<TikTokAccountResponse | null>(null)
  const [savingAutoPost, setSavingAutoPost] = useState(false)

  useEffect(() => {
    if (!user) return
    api.get<TikTokAccountResponse>("/api/client/tiktok-account").then(setData)
  }, [user])

  async function toggleAutoPost(checked: boolean) {
    if (!data?.connected) return
    setSavingAutoPost(true)
    setData({ ...data, autoPostEnabled: checked })
    try {
      await api.put<{ autoPostEnabled: boolean }>("/api/client/tiktok-account/auto-post", { enabled: checked })
    } finally {
      setSavingAutoPost(false)
    }
  }

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Conta TikTok">
      <p className="-mt-2 text-sm text-muted-foreground">
        A conta conectada aqui é onde os cortes gerados podem ser publicados — você controla se isso acontece
        automaticamente logo abaixo.
      </p>

      {!data ? (
        <Skeleton className="h-28" />
      ) : (
        <>
          <Card>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
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
                        ? `Conectada em ${new Date(data.connectedAt).toLocaleDateString("pt-BR")}.`
                        : "Conecte uma conta TikTok pra que os cortes gerados possam ser publicados."}
                    </p>
                  </div>
                </div>
                <Button asChild variant={data.connected ? "outline" : "default"}>
                  <a href="/auth/tiktok/connect">
                    {data.connected ? "Reconectar / trocar de conta" : "Conectar TikTok"}
                  </a>
                </Button>
              </div>

              {data.connected && data.followerCount !== null && (
                <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4 text-sm">
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <IconUsers className="size-4 text-muted-foreground" />
                    <span className="font-semibold">{data.followerCount}</span>
                    <span className="text-muted-foreground">seguidores</span>
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <IconHeart className="size-4 text-muted-foreground" />
                    <span className="font-semibold">{data.likesCount}</span>
                    <span className="text-muted-foreground">curtidas</span>
                  </span>
                  <span className="flex items-center gap-1.5 tabular-nums">
                    <IconMovie className="size-4 text-muted-foreground" />
                    <span className="font-semibold">{data.videoCount}</span>
                    <span className="text-muted-foreground">vídeos no perfil</span>
                  </span>
                </div>
              )}
            </CardContent>
          </Card>

          {data.connected && (
            <Card>
              <CardContent className="flex items-start gap-3 py-5">
                <Checkbox
                  id="autoPost"
                  checked={data.autoPostEnabled}
                  onCheckedChange={(checked) => toggleAutoPost(checked === true)}
                  disabled={savingAutoPost}
                  className="mt-0.5"
                />
                <label htmlFor="autoPost" className="cursor-pointer">
                  <span className="text-sm font-medium">Postar automaticamente</span>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Desligado por padrão — os cortes ficam prontos em "Vídeos & Cortes" mas só entram na fila de
                    postagem depois que você ligar isso aqui.
                  </p>
                </label>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </DashboardLayout>
  )
}
