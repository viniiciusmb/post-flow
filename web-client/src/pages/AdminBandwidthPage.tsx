import { useEffect, useState } from "react"
import { IconGauge } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { AdminBandwidthResponse, BandwidthEgressType } from "@/types/api"

function gb(bytes: number) {
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}

const EGRESS_LABELS: Record<BandwidthEgressType, string> = {
  client_tunnel: "Túnel dos clientes",
  founder_tunnel: "Minha internet",
  proxy: "Proxy residencial",
  direct: "Direto (sem túnel/proxy)",
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

export function AdminBandwidthPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [data, setData] = useState<AdminBandwidthResponse | null>(null)
  const [savingFounder, setSavingFounder] = useState(false)
  const [savingProxy, setSavingProxy] = useState(false)

  async function load() {
    const res = await api.get<AdminBandwidthResponse>(`/api/admin/bandwidth?range=${range}`)
    setData(res)
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range])

  if (authLoading || !user) return null

  async function toggleFounder(checked: boolean) {
    setSavingFounder(true)
    try {
      await api.post("/api/admin/bandwidth/founder-tunnel/toggle", { enabled: checked })
      await load()
    } finally {
      setSavingFounder(false)
    }
  }

  async function toggleProxy(checked: boolean) {
    setSavingProxy(true)
    try {
      await api.post("/api/admin/bandwidth/proxy/toggle", { enabled: checked })
      await load()
    } finally {
      setSavingProxy(false)
    }
  }

  const totalBytes = data ? data.byEgress.reduce((sum, e) => sum + e.bytes, 0) : 0
  const bytesByType = (type: BandwidthEgressType) => data?.byEgress.find((e) => e.egressType === type)?.bytes ?? 0

  return (
    <DashboardLayout user={user} onLogout={logout} title="Consumo de banda">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">Período</h2>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      {!data ? (
        <Skeleton className="h-40" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Minha internet</CardTitle>
                <CardDescription>Túnel de reserva - usado quando o cliente não tem o programa instalado.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="founder-toggle"
                    checked={data.founderTunnel?.enabled ?? false}
                    onCheckedChange={(c) => toggleFounder(c === true)}
                    disabled={savingFounder || !data.founderTunnel}
                  />
                  <label htmlFor="founder-toggle" className="cursor-pointer text-sm font-medium">
                    Usar como saída de download
                  </label>
                  {data.founderTunnel && (
                    <TonePill tone={data.founderTunnel.connected ? "success" : "neutral"} className="ml-auto">
                      {data.founderTunnel.connected ? "Conectado" : "Desconectado"}
                    </TonePill>
                  )}
                </div>
                <Metric label="GB consumidos no período" value={gb(bytesByType("founder_tunnel"))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Proxy residencial</CardTitle>
                <CardDescription>Último recurso pago - só é tentado quando os túneis falham.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="proxy-toggle"
                    checked={data.proxy.enabled}
                    onCheckedChange={(c) => toggleProxy(c === true)}
                    disabled={savingProxy || !data.proxy.configured}
                  />
                  <label htmlFor="proxy-toggle" className="cursor-pointer text-sm font-medium">
                    Usar como saída de download
                  </label>
                  {!data.proxy.configured && (
                    <TonePill tone="neutral" className="ml-auto">
                      Não configurado
                    </TonePill>
                  )}
                </div>
                <Metric label="GB consumidos no período" value={gb(bytesByType("proxy"))} />
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Consumo total por origem</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric label="Total no período" value={gb(totalBytes)} />
              <Metric label={EGRESS_LABELS.client_tunnel} value={gb(bytesByType("client_tunnel"))} />
              <Metric label={EGRESS_LABELS.founder_tunnel} value={gb(bytesByType("founder_tunnel"))} />
              <Metric label={EGRESS_LABELS.direct} value={gb(bytesByType("direct"))} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconGauge className="size-4 text-muted-foreground" />
                Consumo por cliente
              </CardTitle>
              <CardDescription>
                "Pelo túnel próprio" é banda que saiu pela internet do cliente de verdade; "caiu pro reserva" é banda
                que usou a sua internet ou o proxy pago porque o túnel do cliente não estava disponível.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.byClient.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum download registrado nesse período ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Cliente</TableHead>
                      <TableHead>Vídeos</TableHead>
                      <TableHead>Pelo túnel próprio</TableHead>
                      <TableHead>Caiu pro reserva</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.byClient.map((c) => (
                      <TableRow key={c.clientUserId}>
                        <TableCell className="font-medium">{c.name}</TableCell>
                        <TableCell>{c.videos}</TableCell>
                        <TableCell>{gb(c.ownTunnelBytes)}</TableCell>
                        <TableCell>
                          {c.fallbackBytes > 0 ? (
                            <TonePill tone="danger">{gb(c.fallbackBytes)}</TonePill>
                          ) : (
                            gb(c.fallbackBytes)
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
