import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useState } from "react"
import { IconCheck, IconRefresh, IconX } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"

interface StageTimings {
  sampleSize: number
  avgDownloadSecondsPerMinute: number | null
  avgTranscriptionSecondsPerMinute: number | null
  avgSelectionSecondsPerMinute: number | null
  avgCuttingSecondsPerMinute: number | null
  avgTotalSecondsPerMinute: number | null
}

interface QueueItem {
  id: number
  title: string
  clientName: string
  channelName: string
  status: string
  errorMessage: string | null
  createdAt: string
  updatedAt: string
}

/** Custo REAL do vídeo: quem reaproveitou download/transcrição de outro
 *  cliente aparece com esses custos zerados, porque não pagou por eles. */
interface CustosDoVideo {
  downloadUsd: number
  transcricaoUsd: number
  selecaoUsd: number
  totalUsd: number
  downloadBytes: number
  downloadOrigem: string | null
  downloadReaproveitado: boolean
  transcricaoReaproveitada: boolean
}

interface HistoryItem extends QueueItem {
  clipsCount: number
  processingSeconds: number | null
  custos: CustosDoVideo
}

interface QueueOverview {
  processing: QueueItem[]
  waiting: QueueItem[]
  history: HistoryItem[]
  stageTimings: StageTimings
  maxSimultaneos: number
}

function formatSecondsPerMinute(seconds: number | null) {
  if (seconds === null) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  const minutes = Math.floor(seconds / 60)
  const rest = Math.round(seconds % 60)
  return `${minutes}min${rest > 0 ? ` ${rest}s` : ""}`
}

function TimingMetric({ label, seconds }: { label: string; seconds: number | null }) {
  return (
    <div>
      <div className="font-heading text-2xl font-semibold tabular-nums">{formatSecondsPerMinute(seconds)}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  )
}

const STEPS: { status: string; label: ChaveDeTraducao }[] = [
  { status: "downloading", label: "adm.baixandoVideo" },
  { status: "transcribing", label: "adm.transcricao" },
  { status: "selecting_clips", label: "adm.selecionandoCortes" },
  { status: "cutting", label: "adm.cortandoLegendando" },
]

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime()
  const minutes = Math.floor(diffMs / 60000)
  if (minutes < 1) return "agora mesmo"
  if (minutes < 60) return `há ${minutes} min`
  const hours = Math.floor(minutes / 60)
  return `há ${hours}h`
}

// Custo por vídeo é da ordem de centavos de dólar, então 2 casas viraria
// "$0.00" em quase tudo. 3 casas mantém o número legível sem virar ruído.
function usd(n: number) {
  if (n <= 0) return "$0"
  if (n < 0.001) return "<$0.001"
  return `$${n.toFixed(3)}`
}

function duracao(seconds: number | null) {
  if (seconds === null || seconds < 0) return "—"
  if (seconds < 60) return `${Math.round(seconds)}s`
  const h = Math.floor(seconds / 3600)
  const m = Math.round((seconds % 3600) / 60)
  return h > 0 ? `${h}h ${m}min` : `${m}min`
}

function mb(bytes: number) {
  if (!bytes) return null
  const gigas = bytes / 1024 ** 3
  return gigas >= 1 ? `${gigas.toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`
}

// Uma métrica pequena da linha do histórico. `nota` explica um zero que é
// real (reaproveitado) - sem isso um custo zerado parece dado faltando.
function CustoItem({ label, valor, nota }: { label: string; valor: string; nota?: string }) {
  return (
    <div>
      <div className="text-sm font-semibold tabular-nums">{valor}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
      {nota && <div className="text-[11px] text-tone-success-ink">{nota}</div>}
    </div>
  )
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function ProcessingCard({ video }: { video: QueueItem }) {
  const t = useT()
  const currentStepIndex = STEPS.findIndex((s) => s.status === video.status)

  return (
          <div className="rounded-2xl border border-primary bg-card p-5 shadow-[0_0_0_4px_var(--tone-indigo-wash)]">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
              <div className="flex min-w-50 items-center gap-3">
                <Avatar className="size-10">
                  <AvatarFallback>{initials(video.clientName)}</AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{video.clientName}</div>
                  <div className="max-w-45 truncate text-xs text-muted-foreground">{video.title}</div>
                </div>
              </div>

              <div className="flex flex-1 items-center gap-1">
                {STEPS.map((step, i) => (
                  <div key={step.status} className="flex flex-1 items-center gap-2 last:flex-none">
                    <div className="flex items-center gap-2">
                      <div
                        className={
                          "flex size-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-bold " +
                          (i < currentStepIndex
                            ? "border-primary bg-primary text-primary-foreground"
                            : i === currentStepIndex
                              ? "border-primary text-primary"
                              : "border-border text-muted-foreground")
                        }
                      >
                        {i < currentStepIndex ? <IconCheck className="size-3.5" /> : i + 1}
                      </div>
                      <span
                        className={
                          "hidden text-xs font-medium whitespace-nowrap sm:inline " +
                          (i === currentStepIndex ? "text-foreground font-semibold" : "text-muted-foreground")
                        }
                      >
                        {t(step.label)}
                      </span>
                    </div>
                    {i < STEPS.length - 1 && (
                      <div className={"h-px flex-1 " + (i < currentStepIndex ? "bg-primary" : "bg-border")} />
                    )}
                  </div>
                ))}
              </div>

              <div className="text-xs text-muted-foreground whitespace-nowrap">
                atualizado {timeAgo(video.updatedAt)}
              </div>
            </div>
          </div>
  )
}

export function AdminQueuePage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<QueueOverview | null>(null)

  async function load() {
    const overview = await api.get<QueueOverview>("/api/admin/queue")
    setData(overview)
  }

  useEffect(() => {
    if (!user) return
    load()
    const interval = setInterval(load, 15000)
    return () => clearInterval(interval)
  }, [user])

  async function retry(id: number) {
    await api.post(`/api/admin/queue/${id}/retry`, {})
    await load()
  }

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Processamento">
      <p className="-mt-2 text-sm text-muted-foreground">{t("adm.umVideoPorVez", { n: data?.maxSimultaneos ?? 1 })}</p>

      {!data ? (
        <Skeleton className="h-28" />
      ) : (
        <>
          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">
            {t("adm.processandoAgora")}
            <span className="rounded-full bg-tone-neutral-wash px-2 py-0.5 text-[11px] font-bold text-tone-neutral-ink normal-case">
              {data.processing.length} de {data.maxSimultaneos}
            </span>
          </div>
          {data.processing.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">{t("adm.filaLivre")}</div>
          ) : (
            <div className="flex flex-col gap-3">
              {data.processing.map((v) => (
                <ProcessingCard key={v.id} video={v} />
              ))}
            </div>
          )}

          <div className="flex items-center gap-2 text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t("adm.naFila")}<span className="rounded-full bg-tone-neutral-wash px-2 py-0.5 text-[11px] font-bold text-tone-neutral-ink normal-case">
              {data.waiting.length}
            </span>
          </div>
          {data.waiting.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">
              Nada esperando.
            </div>
          ) : (
            <div className="rounded-lg border border-border">
              {data.waiting.map((v, i) => (
                <div key={v.id} className="flex items-center gap-4 border-b border-border px-4 py-3 last:border-b-0">
                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-tone-neutral-wash text-xs font-bold text-tone-neutral-ink">
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{v.clientName}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {v.title} · {v.channelName}
                    </div>
                  </div>
                  {v.status === "aguardando_creditos" && <TonePill tone="danger">{t("adm.semCredito")}</TonePill>}
                  {v.status === "aguardando_conexao" && (
                    <TonePill tone="cyan">{t("adm.esperandoComputador")}</TonePill>
                  )}
                  <div className="shrink-0 text-xs text-muted-foreground">{timeAgo(v.createdAt)}</div>
                </div>
              ))}
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.tempoProcessamento")}</CardTitle>
              <CardDescription>
                Média dos últimos 30 dias, normalizada por minuto de vídeo, ex: "15s" significa 15 segundos dessa
                etapa pra cada 1 minuto de vídeo original.
                {data.stageTimings.sampleSize > 0 && ` Baseado em ${data.stageTimings.sampleSize} vídeo(s).`}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-5">
              <TimingMetric label="Download" seconds={data.stageTimings.avgDownloadSecondsPerMinute} />
              <TimingMetric label={t("adm.transcricao")} seconds={data.stageTimings.avgTranscriptionSecondsPerMinute} />
              <TimingMetric label={t("adm.selecaoDeCortes")} seconds={data.stageTimings.avgSelectionSecondsPerMinute} />
              <TimingMetric label={t("adm.corteRenderizacao")} seconds={data.stageTimings.avgCuttingSecondsPerMinute} />
              <TimingMetric label="Total" seconds={data.stageTimings.avgTotalSecondsPerMinute} />
            </CardContent>
          </Card>

          <div className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t("adm.historicoRecente")}</div>
          <p className="-mt-2 text-xs text-muted-foreground">
            Custo real de cada vídeo. Quando outro cliente segue o mesmo canal, só o primeiro paga o download e a
            transcrição — os seguintes aparecem como "reaproveitado" com custo zero. Download só custa dinheiro quando
            sai pelo proxy pago; pelo túnel a banda já está paga.
          </p>
          {data.history.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border py-8 text-center text-sm text-muted-foreground">{t("adm.nenhumProcessamentoConcluido")}</div>
          ) : (
            <div className="rounded-lg border border-border">
              {data.history.map((v) => (
                <div key={v.id} className="flex items-start gap-4 border-b border-border px-4 py-3 last:border-b-0">
                  <div
                    className={
                      "mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full " +
                      (v.status === "ready" ? "bg-tone-success-wash text-tone-success-ink" : "bg-tone-danger-wash text-tone-danger-ink")
                    }
                  >
                    {v.status === "ready" ? <IconCheck className="size-3.5" /> : <IconX className="size-3.5" />}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{v.clientName}</div>
                    <div className="truncate text-xs text-muted-foreground">{v.title}</div>
                    {v.errorMessage && (
                      <div className="mt-1.5 inline-block rounded-md bg-tone-danger-wash px-2.5 py-1 text-xs text-tone-danger-ink">
                        {v.errorMessage}
                      </div>
                    )}

                    <div className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 lg:grid-cols-6">
                      <CustoItem label="Tempo" valor={duracao(v.processingSeconds)} />
                      <CustoItem label="Cortes" valor={String(v.clipsCount)} />
                      <CustoItem
                        label="Download"
                        valor={usd(v.custos.downloadUsd)}
                        nota={
                          v.custos.downloadReaproveitado
                            ? "reaproveitado"
                            : (mb(v.custos.downloadBytes) ?? undefined)
                        }
                      />
                      <CustoItem
                        label={t("adm.transcricao")}
                        valor={usd(v.custos.transcricaoUsd)}
                        nota={v.custos.transcricaoReaproveitada ? "reaproveitado" : undefined}
                      />
                      <CustoItem label="Seleção (IA)" valor={usd(v.custos.selecaoUsd)} />
                      <CustoItem label="Custo total" valor={usd(v.custos.totalUsd)} />
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-2">
                    <TonePill tone={v.status === "ready" ? "success" : "danger"}>
                      {v.status === "ready" ? t("adm.concluido") : t("pub.abaErro")}
                    </TonePill>
                    {v.status === "error" && (
                      <Button variant="outline" size="sm" onClick={() => retry(v.id)} className="h-7 gap-1 text-xs">
                        <IconRefresh className="size-3" />
                        Tentar novamente
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </DashboardLayout>
  )
}
