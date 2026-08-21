import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useState } from "react"
import { IconGauge } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { AdminBandwidthResponse, BandwidthEgressType } from "@/types/api"

const BYTES_PER_GB = 1024 ** 3

function gb(bytes: number) {
  return `${(bytes / BYTES_PER_GB).toFixed(2)} GB`
}

const EGRESS_LABELS: Record<BandwidthEgressType, ChaveDeTraducao> = {
  client_tunnel: "adm.tunelDosClientes",
  founder_tunnel: "adm.minhaInternet",
  proxy: "adm.proxyResidencial",
  direct: "adm.direto",
  reuse: "adm.reaproveitado",
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
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [data, setData] = useState<AdminBandwidthResponse | null>(null)
  const [savingFounder, setSavingFounder] = useState(false)
  const [savingProxy, setSavingProxy] = useState(false)
  const [purchasedDraft, setPurchasedDraft] = useState<string | null>(null)
  const [savingPurchased, setSavingPurchased] = useState(false)

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

  async function savePurchased() {
    if (purchasedDraft === null) return
    const purchasedGb = Number(purchasedDraft)
    if (!Number.isFinite(purchasedGb) || purchasedGb < 0) {
      setPurchasedDraft(null)
      return
    }
    setSavingPurchased(true)
    try {
      await api.post("/api/admin/bandwidth/proxy/purchased", { purchasedGb })
      setPurchasedDraft(null)
      await load()
    } finally {
      setSavingPurchased(false)
    }
  }

  const totalBytes = data ? data.byEgress.reduce((sum, e) => sum + e.bytes, 0) : 0
  const bytesByType = (type: BandwidthEgressType) => data?.byEgress.find((e) => e.egressType === type)?.bytes ?? 0

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.banda")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("inicio.periodo")}</h2>
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
                <CardDescription>{t("adm.tunelReserva")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="founder-toggle"
                    checked={data.founderTunnel?.enabled ?? false}
                    onCheckedChange={(c) => toggleFounder(c === true)}
                    disabled={savingFounder || !data.founderTunnel}
                  />
                  <label htmlFor="founder-toggle" className="cursor-pointer text-sm font-medium">{t("adm.usarComoSaida")}</label>
                  {data.founderTunnel && (
                    <TonePill tone={data.founderTunnel.connected ? "success" : "neutral"} className="ml-auto">
                      {data.founderTunnel.connected ? t("comum.conectado") : "Desconectado"}
                    </TonePill>
                  )}
                </div>
                <Metric label={t("adm.bandaDescricao")} value={gb(bytesByType("founder_tunnel"))} />
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Proxy residencial</CardTitle>
                <CardDescription>{t("adm.ultimoRecursoPago")}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="proxy-toggle"
                    checked={data.proxy.enabled}
                    onCheckedChange={(c) => toggleProxy(c === true)}
                    disabled={savingProxy || !data.proxy.configured}
                  />
                  <label htmlFor="proxy-toggle" className="cursor-pointer text-sm font-medium">{t("adm.usarComoSaida")}</label>
                  {!data.proxy.configured && (
                    <TonePill tone="neutral" className="ml-auto">{t("adm.naoConfigurado")}</TonePill>
                  )}
                </div>
                <Metric label={t("adm.bandaDescricao")} value={gb(bytesByType("proxy"))} />
                <div className="flex items-center gap-2 border-t pt-3">
                  <label htmlFor="proxy-purchased" className="text-xs text-muted-foreground">
                    {t("adm.gbComprados")}
                  </label>
                  <Input
                    id="proxy-purchased"
                    type="number"
                    min={0}
                    step={0.5}
                    value={purchasedDraft ?? String(data.proxy.purchasedBytes / BYTES_PER_GB)}
                    disabled={savingPurchased}
                    onChange={(e) => setPurchasedDraft(e.target.value)}
                    onBlur={savePurchased}
                    className="w-24"
                  />
                </div>
                <div className="flex items-center justify-between gap-3">
                  <Metric label={t("adm.gbConsumidoTotal")} value={gb(data.proxy.consumedAllTimeBytes)} />
                  <div className="text-right">
                    <div className="font-heading text-2xl font-semibold tabular-nums">
                      {data.proxy.purchasedBytes > 0 && data.proxy.remainingBytes < BYTES_PER_GB ? (
                        <TonePill tone="danger">{gb(data.proxy.remainingBytes)}</TonePill>
                      ) : (
                        gb(data.proxy.remainingBytes)
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">{t("adm.gbRestante")}</div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.consumoTotalPorOrigem")}</CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric label={t("adm.totalNoPeriodo")} value={gb(totalBytes)} />
              <Metric label={EGRESS_LABELS.client_tunnel} value={gb(bytesByType("client_tunnel"))} />
              <Metric label={EGRESS_LABELS.founder_tunnel} value={gb(bytesByType("founder_tunnel"))} />
              <Metric label={EGRESS_LABELS.direct} value={gb(bytesByType("direct"))} />
            </CardContent>
          </Card>

          {/* O que este sistema economiza: dois clientes que monitoram o mesmo
              canal do YouTube baixam e transcrevem o vídeo uma vez só. O
              cliente paga o mesmo de sempre — a economia é de custo, não um
              desconto. */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.economiaReaproveitamento")}</CardTitle>
              <CardDescription>{t("adm.economiaReaproveitamentoDescricao")}</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-2 gap-6 sm:grid-cols-4">
              <Metric
                label={t("adm.bandaEconomizada")}
                value={gb(data.economia.bytesEconomizados)}
                sub={t("adm.emNDownloads", { n: data.economia.downloadsReaproveitados })}
              />
              <Metric label={t("adm.downloadsEvitados")} value={data.economia.downloadsReaproveitados} />
              <Metric label={t("adm.transcricoesEvitadas")} value={data.economia.transcricoesReaproveitadas} />
              <Metric
                label={t("adm.whisperEconomizado")}
                value={`US$ ${data.economia.whisperUsdEconomizado.toFixed(2)}`}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconGauge className="size-4 text-muted-foreground" />{t("adm.consumoPorCliente")}</CardTitle>
              <CardDescription>
                t("adm.peloTunelProprio") é banda que saiu pela internet do cliente de verdade; "caiu pro reserva" é banda
                que usou a sua internet ou o proxy pago porque o túnel do cliente não estava disponível.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {data.byClient.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("adm.nenhumDownloadRegistrado")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t("tabela.cliente")}</TableHead>
                      <TableHead>{t("adm.videos")}</TableHead>
                      <TableHead>{t("adm.peloTunelProprio")}</TableHead>
                      <TableHead>{t("adm.caiuProReserva")}</TableHead>
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
