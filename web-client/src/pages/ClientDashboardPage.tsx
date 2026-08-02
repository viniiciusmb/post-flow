import { useEffect, useState } from "react"
import { IconBrandYoutube, IconMovie, IconScissors, IconCircleCheck, IconListCheck } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { TikTokConnectionCard } from "@/components/dashboard/TikTokConnectionCard"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { StatCard } from "@/components/dashboard/StatCard"
import { UsageCard } from "@/components/dashboard/UsageCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { ClientDashboardResponse } from "@/types/api"

function useFlashFromQuery() {
  const params = new URLSearchParams(window.location.search)
  return {
    tiktokConnected: params.get("tiktok_connected") === "1",
    tiktokError: params.get("tiktok_error"),
    driveConnected: params.get("google_connected") === "1",
    driveError: params.get("google_error"),
  }
}

export function ClientDashboardPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [data, setData] = useState<ClientDashboardResponse | null>(null)
  const [flash] = useState(useFlashFromQuery)

  useEffect(() => {
    if (!user) return
    setData(null)
    api.get<ClientDashboardResponse>(`/api/client/dashboard?range=${range}`).then(setData)
  }, [user, range])

  if (authLoading || !user) return null

  const rows: PostingRow[] =
    data?.postings.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      date: p.updatedAt,
      origin: p.origin,
      channelName: p.channelName,
    })) ?? []

  return (
    <DashboardLayout user={user} onLogout={logout} title="Início">
      <PageHeader
        title="Início"
        description="Um resumo do que o Post Flow fez pelos seus canais no período escolhido."
      />
      {flash.tiktokConnected && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
          Conta TikTok conectada com sucesso!
        </p>
      )}
      {flash.tiktokError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível conectar o TikTok: {flash.tiktokError}
        </p>
      )}
      {flash.driveConnected && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
          Google Drive conectado! Agora aponte sua pasta em{" "}
          <a href="/client/settings" className="font-medium underline">
            Configurações
          </a>
          .
        </p>
      )}
      {flash.driveError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          Não foi possível conectar o Drive: {flash.driveError}
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Período</h2>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {data ? (
        <TikTokConnectionCard accounts={data.tiktokAccounts} />
      ) : (
        <Skeleton className="h-24" />
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {data ? (
          <>
            <StatCard
              label="Canais monitorados"
              value={data.counts.youtubeChannels}
              icon={<IconBrandYoutube />}
              tone="danger"
              href="/client/youtube-channels"
              hrefLabel="Ver canais"
            />
            <StatCard
              label="Vídeos detectados no período"
              value={data.counts.videosInRange}
              icon={<IconMovie />}
              tone="cyan"
            />
            <StatCard
              label="Cortes gerados no período"
              value={data.counts.clipsInRange}
              icon={<IconScissors />}
              tone="violet"
            />
            <StatCard
              label="Cortes postados no período"
              value={data.counts.clipsPostedInRange}
              icon={<IconCircleCheck />}
              tone="success"
              href="/client/videos-clips"
              hrefLabel="Ver cortes"
            />
            <StatCard
              label="Cortes na fila aguardando postar"
              value={data.counts.pendingInQueue}
              icon={<IconListCheck />}
              tone="cyan"
              href="/client/tiktok-account"
              hrefLabel="Ver a fila"
            />
          </>
        ) : (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        )}
      </div>

      <UsageCard range={range} />

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Meus vídeos no período</h2>
        {data ? (
          <PostingsTable
            rows={rows}
            showOrigin
            showChannel
            emptyMessage="Nenhum vídeo processado nesse período. Cadastre um canal em Canais e o Post Flow passa a acompanhar os vídeos novos sozinho."
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </DashboardLayout>
  )
}
