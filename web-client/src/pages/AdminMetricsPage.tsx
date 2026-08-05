import { useT } from "@/i18n"
import { useEffect, useState } from "react"
import { IconAlertTriangle, IconCircleCheck, IconCircleX, IconServer } from "@tabler/icons-react"
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminMetricsResponse, DateRangeKey } from "@/types/api"

// O rótulo do gráfico é montado dentro do componente (ver AdminMetricsPage),
// porque aqui fora ainda não existe idioma escolhido.
const SYSTEM_CHART_COLORS = {
  cpuPercent: "var(--tone-danger-ink)",
  memPercent: "var(--tone-indigo-ink)",
}

function gb(n: number | null) {
  if (n === null) return "—"
  return `${n.toFixed(1)} GB`
}

const ERROR_RATE_WARN = 0.15
const QUEUE_DEPTH_WARN = 20

function pct(n: number | null) {
  if (n === null) return "—"
  return `${Math.round(n * 100)}%`
}

function usd(n: number | null) {
  if (n === null) return "—"
  return `$${n.toFixed(2)}`
}

function minutes(seconds: number | null) {
  if (seconds === null) return "—"
  const m = Math.round(seconds / 60)
  return m < 1 ? `${Math.round(seconds)}s` : `${m} min`
}

function Metric({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div>
      <div className="font-heading text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground/70">{sub}</div>}
    </div>
  )
}

// Backup do banco: a falha perigosa aqui e a silenciosa (parou de rodar e
// ninguem viu), por isso qualquer coisa diferente de "ok" vira pilula vermelha
// em vez de so um numero a mais.
function BackupMetric({ backup }: { backup: AdminMetricsResponse["backup"] }) {
  const t = useT()
  const isOk = backup.status === "ok"
  const label =
    backup.status === "nunca"
      ? t("adm.backupNuncaRodou")
      : backup.status === "erro"
        ? t("adm.backupFalhou")
        : backup.status === "atrasado"
          ? t("adm.backupAtrasado")
          : backup.ageHours !== null && backup.ageHours < 1
            ? t("adm.backupHaMinutos")
            : t("adm.backupHaHoras", { n: Math.round(backup.ageHours ?? 0) })

  return (
    <div>
      <div className="font-heading text-2xl font-semibold tabular-nums">
        {isOk ? (
          <span className="text-tone-success-ink">OK</span>
        ) : (
          <TonePill tone="danger" icon={<IconAlertTriangle className="size-3.5" />}>
            {label}
          </TonePill>
        )}
      </div>
      <div className="text-xs text-muted-foreground">{t("adm.backupDoBanco")}</div>
      <div className="mt-0.5 text-xs text-muted-foreground/70">
        {isOk ? `último ${label}` : "verifique /var/log/postflow-backup.log na VPS"}
      </div>
    </div>
  )
}

// Cada painel carrega o proprio filtro de periodo no cabecalho. Antes havia um
// filtro so, no topo da tela, e metade dos blocos o ignorava (mostravam janela
// fixa de 7/30 dias): escolher "Hoje" nao mudava o custo de IA, o que parecia
// painel quebrado. Com o filtro dentro do bloco, o numero e a janela dele ficam
// sempre no mesmo lugar, e da pra comparar periodos diferentes lado a lado.
function Section({
  title,
  range,
  onRangeChange,
  children,
}: {
  title: string
  range?: DateRangeKey
  onRangeChange?: (r: DateRangeKey) => void
  children: React.ReactNode
}) {
  return (
    <Card>
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 has-data-[slot=card-action]:grid-cols-none">
        <CardTitle className="text-base">{title}</CardTitle>
        {range && onRangeChange && <DateRangeFilter value={range} onChange={onRangeChange} />}
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">{children}</CardContent>
    </Card>
  )
}

export function AdminMetricsPage() {
  const t = useT()
  const systemChartConfig = {
    cpuPercent: { label: t("adm.cpuCarga"), color: SYSTEM_CHART_COLORS.cpuPercent },
    memPercent: { label: t("adm.memoriaUsada"), color: SYSTEM_CHART_COLORS.memPercent },
  } satisfies ChartConfig
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<AdminMetricsResponse | null>(null)
  // Um periodo por painel. Vao juntos numa chamada so pra nao virar quatro
  // requisicoes a cada clique.
  const [rangeVolume, setRangeVolume] = useState<DateRangeKey>("last7days")
  const [rangePipeline, setRangePipeline] = useState<DateRangeKey>("last7days")
  const [rangeCost, setRangeCost] = useState<DateRangeKey>("last7days")
  const [rangeRanking, setRangeRanking] = useState<DateRangeKey>("last7days")

  useEffect(() => {
    if (!user) return
    const q = new URLSearchParams({
      volume: rangeVolume,
      pipeline: rangePipeline,
      cost: rangeCost,
      ranking: rangeRanking,
    })
    api.get<AdminMetricsResponse>(`/api/admin/metrics?${q}`).then(setData)
  }, [user, rangeVolume, rangePipeline, rangeCost, rangeRanking])

  if (authLoading || !user) return null

  const alerts: string[] = []
  if (data) {
    if (data.pipeline.errorRate > ERROR_RATE_WARN) {
      alerts.push(`Taxa de erro do pipeline em ${pct(data.pipeline.errorRate)} no período escolhido. Acima do esperado.`)
    }
    if (data.pipeline.queueDepth > QUEUE_DEPTH_WARN) {
      alerts.push(`${data.pipeline.queueDepth} vídeos acumulados na fila de espera.`)
    }
    const down = data.services.filter((s) => !s.isUp)
    if (down.length > 0) {
      alerts.push(`Serviço${down.length > 1 ? "s" : ""} sem sinal: ${down.map((s) => s.name).join(", ")}.`)
    }
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.metricas")}>
      <PageHeader
        title={t("menu.metricas")}
        description={t("adm.metricasDescricao")}
      />

      {!data ? (
        <div className="grid gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      ) : (
        <>
          {alerts.length > 0 && (
            <div className="flex flex-col gap-2 rounded-lg border border-tone-danger-wash bg-tone-danger-wash/40 p-4">
              {alerts.map((a) => (
                <div key={a} className="flex items-center gap-2 text-sm text-tone-danger-ink">
                  <IconAlertTriangle className="size-4 shrink-0" />
                  {a}
                </div>
              ))}
            </div>
          )}

          <Section title="Volume" range={rangeVolume} onRangeChange={setRangeVolume}>
            <Metric label={t("adm.videosDetectados")} value={data.volume.videosDetected} />
            <Metric label="Cortes gerados" value={data.volume.clipsGenerated} />
            <Metric label="Cortes postados" value={data.volume.clipsPosted} />
            <Metric label={t("adm.taxaAproveitamento")} value={pct(data.volume.aproveitamentoRate)} sub="cortes postados / gerados" />
            <Metric label="Clientes ativos" value={data.clients.active} sub={t("adm.comAtividade30")} />
            <Metric label="Clientes inativos" value={data.clients.inactive} />
          </Section>

          <Section title={t("adm.saudePipeline")} range={rangePipeline} onRangeChange={setRangePipeline}>
            <Metric label={t("adm.taxaDeErro")} value={pct(data.pipeline.errorRate)} sub={`${data.pipeline.totalFinished} vídeos concluídos`} />
            <Metric label={t("adm.tempoMedioProcessamento")} value={minutes(data.pipeline.avgProcessingSeconds)} />
            <Metric label={t("adm.tempoMedioEspera")} value={minutes(data.pipeline.avgQueueWaitSeconds)} />
            <Metric label={t("adm.videosNaFilaAgora")} value={data.pipeline.queueDepth} />
          </Section>

          <Section title={t("adm.custoDeIA")} range={rangeCost} onRangeChange={setRangeCost}>
            <Metric label={t("adm.whisper")} value={usd(data.cost.whisperCostUsd)} />
            <Metric label={t("adm.claude")} value={usd(data.cost.claudeCostUsd)} />
            <Metric label={t("adm.totalNoPeriodo")} value={usd(data.cost.totalCostUsd)} />
            <Metric
              label={t("adm.custoMedioPorVideo")}
              value={usd(data.cost.avgCostPerVideo)}
              sub={`${data.cost.videosWithCost} vídeos com custo registrado`}
            />
            <Metric label={t("adm.projecaoMensal")} value={usd(data.cost.projectedMonthlyUsd)} sub={t("adm.baseUltimos7")} />
          </Section>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconServer className="size-4 text-muted-foreground" />{t("adm.saudeDoServidor")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="grid grid-cols-2 gap-6 sm:grid-cols-6">
                <Metric
                  label={t("adm.cargaCpu")}
                  value={data.system.latest ? data.system.latest.loadAvg1m.toFixed(2) : "—"}
                  sub={data.system.latest ? `${data.system.latest.cpuCores} núcleos` : undefined}
                />
                <Metric
                  label={t("adm.memoriaUsada")}
                  value={data.system.latest ? `${Math.round((data.system.latest.memUsedMb / data.system.latest.memTotalMb) * 100)}%` : "—"}
                  sub={data.system.latest ? `${(data.system.latest.memUsedMb / 1024).toFixed(1)} / ${(data.system.latest.memTotalMb / 1024).toFixed(1)} GB` : undefined}
                />
                <Metric
                  label="Disco usado"
                  value={data.system.latest ? `${Math.round(((data.system.latest.diskUsedGb ?? 0) / (data.system.latest.diskTotalGb || 1)) * 100)}%` : "—"}
                  sub={data.system.latest ? `${gb(data.system.latest.diskUsedGb)} / ${gb(data.system.latest.diskTotalGb)}` : undefined}
                />
                <Metric
                  label={t("adm.ultimaAmostra")}
                  value={data.system.latest ? new Date(data.system.latest.sampledAt).toLocaleTimeString("pt-BR") : "—"}
                />
                <Metric
                  label={t("adm.tuneisConectados")}
                  value={data.tunnels.connectedClients}
                  sub={t("adm.saindoPelaInternetCliente")}
                />
                <BackupMetric backup={data.backup} />
              </div>

              {data.system.history.length > 1 && (
                <ChartContainer config={systemChartConfig} className="aspect-auto h-56 w-full">
                  <LineChart
                    data={data.system.history.map((h) => ({
                      time: new Date(h.sampledAt).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" }),
                      cpuPercent: Math.round((h.loadAvg1m / h.cpuCores) * 100),
                      memPercent: Math.round((h.memUsedMb / h.memTotalMb) * 100),
                    }))}
                  >
                    <CartesianGrid vertical={false} />
                    <XAxis dataKey="time" tickLine={false} axisLine={false} minTickGap={40} />
                    <YAxis tickLine={false} axisLine={false} width={36} unit="%" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line dataKey="cpuPercent" stroke="var(--color-cpuPercent)" strokeWidth={2} dot={false} />
                    <Line dataKey="memPercent" stroke="var(--color-memPercent)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              )}
              <p className="text-xs text-muted-foreground">
                Amostrado a cada 5 minutos. Como o servidor é compartilhado (Docker Swarm sem limite de CPU/memória por
                serviço), os números refletem a VPS inteira, não só o Post Flow.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.rankingClientes")}</CardTitle>
              <DateRangeFilter value={rangeRanking} onChange={setRangeRanking} />
            </CardHeader>
            <CardContent>
              {data.ranking.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("adm.nenhumVideoProcessadoPeriodo")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.ranking.map((r, i) => (
                    <div key={r.name} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-b-0">
                      <span className="flex items-center gap-3">
                        <span className="flex size-6 items-center justify-center rounded-full bg-tone-neutral-wash text-xs font-bold text-tone-neutral-ink">
                          {i + 1}
                        </span>
                        {r.name}
                      </span>
                      <span className="font-medium tabular-nums">{r.videosCount} vídeos</span>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.statusDosServicos")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("adm.nenhumServicoReportou")}</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.services.map((s) => (
                    <div key={s.name} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-b-0">
                      <span className="font-medium">{s.name}</span>
                      <TonePill tone={s.isUp ? "success" : "danger"} icon={s.isUp ? <IconCircleCheck className="size-3.5" /> : <IconCircleX className="size-3.5" />}>
                        {s.isUp ? t("adm.noAr") : t("adm.semSinal")}
                      </TonePill>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
