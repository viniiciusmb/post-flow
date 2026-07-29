import { useEffect, useState } from "react"
import { AppShell } from "@/components/shell/AppShell"
import { TikTokConnectionCard } from "@/components/dashboard/TikTokConnectionCard"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { ClientDashboardResponse } from "@/types/api"

function useFlashFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    connected: params.get("tiktok_connected") === "1",
    error: params.get("tiktok_error"),
  }
}

export function ClientDashboardPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<ClientDashboardResponse | null>(null)
  const [flash] = useState(useFlashFromQuery)

  useEffect(() => {
    if (!user) return
    api.get<ClientDashboardResponse>("/api/client/dashboard").then(setData)
  }, [user])

  if (authLoading) return null

  const rows: PostingRow[] =
    data?.postings.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      date: p.updatedAt,
    })) ?? []

  return (
    <AppShell user={user} onLogout={logout} title="Meu Painel">
      {flash.connected && (
        <p className="mb-6 rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
          Conta TikTok conectada com sucesso!
        </p>
      )}
      {flash.error && (
        <p className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Nao foi possivel conectar: {flash.error}
        </p>
      )}

      <div className="mb-8">
        {data ? (
          <TikTokConnectionCard account={data.tiktokAccount} />
        ) : (
          <Skeleton className="h-24" />
        )}
      </div>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Meus vídeos</h2>
      {data ? (
        <PostingsTable
          rows={rows}
          emptyMessage="Nenhum video seu foi processado ainda. Assim que a integracao com o Drive estiver ativa, eles vao aparecer aqui."
        />
      ) : (
        <Skeleton className="h-64" />
      )}
    </AppShell>
  )
}
