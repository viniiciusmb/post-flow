import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader, SectionLabel } from "@/components/dashboard/PageHeader"
import { TikTokConnectionCard } from "@/components/dashboard/TikTokConnectionCard"
import { OnboardingChecklist } from "@/components/dashboard/OnboardingChecklist"
import { iniciarTour } from "@/components/tour/GuidedTour"
import { Button } from "@/components/ui/button"
import { IconRoute } from "@tabler/icons-react"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { StatRow, Stat } from "@/components/dashboard/StatRow"
import { UsageCard } from "@/components/dashboard/UsageCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { ClientDashboardResponse } from "@/types/api"
import { useT } from "@/i18n"
import { SalaDeMaquinas } from "@/components/maquina/SalaDeMaquinas"

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
  const t = useT()
  const { user, loading: authLoading, logout, painelNovo } = useAuth()
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
    <DashboardLayout user={user} onLogout={logout} title={t("inicio.titulo")} autoIniciarTour>
      <PageHeader
        title={t("inicio.titulo")}
        description={
          painelNovo
            ? "Sua máquina de cortes trabalhando agora: o que entrou, o que está sendo cortado e o que vai ao ar em cada rede."
            : t("inicio.descricao")
        }
        action={
          <Button variant="outline" size="sm" onClick={() => iniciarTour(true)} className="gap-1.5">
            <IconRoute className="size-4" />
            {t("tour.fazerTour")}
          </Button>
        }
      />
      {flash.tiktokConnected && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
          {t("inicio.contaConectada")}
        </p>
      )}
      {flash.tiktokError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("inicio.erroTikTok")}: {flash.tiktokError}
        </p>
      )}
      {flash.driveConnected && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
          {t("inicio.driveConectado")}{" "}
          <a href="/client/settings" className="font-medium underline">
            {t("menu.configuracoes")}
          </a>
          .
        </p>
      )}
      {flash.driveError && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {t("inicio.erroDrive")}: {flash.driveError}
        </p>
      )}

      {/* Antes dos números: quem ainda não configurou não tem número nenhum
          pra ver, e o que ele precisa é do caminho, não do painel vazio.
          Some sozinho quando os três passos terminam. */}
      <OnboardingChecklist podeFechar={painelNovo} />

      {/* Painel novo (admin e Rise Style, em teste): só o essencial - o
          resultado do período numa linha e a linha de produção ao vivo.
          Quem não está no teste continua com a tela de sempre. */}
      {painelNovo ? (
        <>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span className="text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">Resultado do período</span>
              <DateRangeFilter value={range} onChange={setRange} />
            </div>
            {data ? (
              <StatRow className="sm:grid-cols-4 lg:grid-cols-4">
                <Stat label="Cortes gerados" value={data.counts.clipsInRange} emphasis href="/client/feed" hrefLabel="Ver os cortes" />
                <Stat label="Cortes publicados" value={data.counts.clipsPostedInRange} href="/client/social" hrefLabel="Ver publicados" />
                <Stat label="Na fila pra publicar" value={data.counts.pendingInQueue} href="/client/social" hrefLabel="Ver as filas" />
                <Stat label="Vídeos que entraram" value={data.counts.videosInRange} href="/client/youtube" hrefLabel="Ver os vídeos" />
              </StatRow>
            ) : (
              <Skeleton className="h-[6.5rem] rounded-xl" />
            )}
          </div>
          <SalaDeMaquinas escopo="cliente" />
        </>
      ) : (
        <>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <span className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">{t("inicio.periodo")}</span>
          <DateRangeFilter value={range} onChange={setRange} />
        </div>

        {data ? <TikTokConnectionCard accounts={data.tiktokAccounts} /> : <Skeleton className="h-24" />}

        {data ? (
          <StatRow>
            <Stat
              label={t("inicio.cortesGerados")}
              value={data.counts.clipsInRange}
              emphasis
            />
            <Stat
              label={t("inicio.cortesPostados")}
              value={data.counts.clipsPostedInRange}
              href="/client/videos-clips"
              hrefLabel={t("inicio.verCortes")}
            />
            <Stat
              label={t("inicio.naFila")}
              value={data.counts.pendingInQueue}
              href="/client/tiktok-account"
              hrefLabel={t("inicio.verAFila")}
            />
            <Stat label={t("inicio.videosDetectados")} value={data.counts.videosInRange} />
            <Stat
              label={t("inicio.canaisMonitorados")}
              value={data.counts.youtubeChannels}
              href="/client/youtube-channels"
              hrefLabel={t("inicio.verCanais")}
            />
          </StatRow>
        ) : (
          <Skeleton className="h-[7.5rem] rounded-xl" />
        )}

        <UsageCard range={range} />

        <div className="flex flex-col gap-3">
          <SectionLabel>{t("inicio.meusVideos")}</SectionLabel>
          {data ? (
            <PostingsTable
              rows={rows}
              showOrigin
              showChannel
              emptyMessage={t("inicio.vazio")}
            />
          ) : (
            <Skeleton className="h-64" />
          )}
        </div>
        </>
      )}
    </DashboardLayout>
  )
}
