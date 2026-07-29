import { useEffect, useState } from "react"
import { IconAlertTriangle, IconCircleCheck, IconCircleX } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminMetricsResponse } from "@/types/api"

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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-3 lg:grid-cols-4">{children}</CardContent>
    </Card>
  )
}

export function AdminMetricsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<AdminMetricsResponse | null>(null)

  useEffect(() => {
    if (!user) return
    api.get<AdminMetricsResponse>("/api/admin/metrics").then(setData)
  }, [user])

  if (authLoading || !user) return null

  const alerts: string[] = []
  if (data) {
    if (data.pipeline.errorRate30d > ERROR_RATE_WARN) {
      alerts.push(`Taxa de erro do pipeline em ${pct(data.pipeline.errorRate30d)} nos últimos 30 dias — acima do esperado.`)
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
    <DashboardLayout user={user} onLogout={logout} title="Métricas">
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

          <Section title="Clientes e volume">
            <Metric label="Clientes ativos (30d)" value={data.clients.active} />
            <Metric label="Clientes inativos" value={data.clients.inactive} />
            <Metric label="Vídeos detectados (7d)" value={data.volume.videosDetected7d} />
            <Metric label="Vídeos detectados (30d)" value={data.volume.videosDetected30d} />
            <Metric label="Cortes gerados (30d)" value={data.volume.clipsGenerated30d} />
            <Metric label="Cortes postados (30d)" value={data.volume.clipsPosted30d} />
            <Metric label="Taxa de aproveitamento" value={pct(data.volume.aproveitamentoRate)} sub="cortes postados / gerados" />
          </Section>

          <Section title="Saúde do pipeline">
            <Metric label="Taxa de erro (30d)" value={pct(data.pipeline.errorRate30d)} sub={`${data.pipeline.totalFinished30d} vídeos concluídos`} />
            <Metric label="Tempo médio de processamento" value={minutes(data.pipeline.avgProcessingSeconds)} />
            <Metric label="Tempo médio de espera na fila" value={minutes(data.pipeline.avgQueueWaitSeconds)} />
            <Metric label="Vídeos na fila agora" value={data.pipeline.queueDepth} />
          </Section>

          <Section title="Custo de API">
            <Metric label="Whisper (7d)" value={usd(data.cost.whisperCostUsd7d)} />
            <Metric label="Claude (7d)" value={usd(data.cost.claudeCostUsd7d)} />
            <Metric label="Total (7d)" value={usd(data.cost.totalCostUsd7d)} />
            <Metric label="Custo médio por vídeo (30d)" value={usd(data.cost.avgCostPerVideo30d)} />
            <Metric label="Projeção mensal" value={usd(data.cost.projectedMonthlyUsd)} sub="com base nos últimos 7 dias" />
          </Section>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Ranking de clientes (30d)</CardTitle>
            </CardHeader>
            <CardContent>
              {data.ranking.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum vídeo processado nos últimos 30 dias ainda.</p>
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
              <CardTitle className="text-base">Status dos serviços</CardTitle>
            </CardHeader>
            <CardContent>
              {data.services.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum serviço reportou status ainda.</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {data.services.map((s) => (
                    <div key={s.name} className="flex items-center justify-between border-b border-border py-2 text-sm last:border-b-0">
                      <span className="font-medium">{s.name}</span>
                      <TonePill tone={s.isUp ? "success" : "danger"} icon={s.isUp ? <IconCircleCheck className="size-3.5" /> : <IconCircleX className="size-3.5" />}>
                        {s.isUp ? "No ar" : "Sem sinal"}
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
