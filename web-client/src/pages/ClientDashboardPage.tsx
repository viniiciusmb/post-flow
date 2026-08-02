import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader, SectionLabel } from "@/components/dashboard/PageHeader"
import { TikTokConnectionCard } from "@/components/dashboard/TikTokConnectionCard"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { StatRow, Stat } from "@/components/dashboard/StatRow"
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
        <span className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">Período</span>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {data ? (
        <TikTokConnectionCard accounts={data.tiktokAccounts} />
      ) : (
        <Skeleton className="h-24" />
      )}

      {data ? (
        <StatRow>
          <Stat
            label="Cortes gerados no período"
            value={data.counts.clipsInRange}
            emphasis
          />
          <Stat
            label="Cortes postados no período"
            value={data.counts.clipsPostedInRange}
            href="/client/videos-clips"
            hrefLabel="Ver cortes"
          />
          <Stat
            label="Na fila aguardando postar"
            value={data.counts.pendingInQueue}
            href="/client/tiktok-account"
            hrefLabel="Ver a fila"
          />
          <Stat label="Vídeos detectados no período" value={data.counts.videosInRange} />
          <Stat
            label="Canais monitorados"
            value={data.counts.youtubeChannels}
            href="/client/youtube-channels"
            hrefLabel="Ver canais"
          />
        </StatRow>
      ) : (
        <Skeleton className="h-[7.5rem] rounded-xl" />
      )}

      <UsageCard range={range} />

      <div className="flex flex-col gap-3">
        <SectionLabel>Meus vídeos no período</SectionLabel>
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
