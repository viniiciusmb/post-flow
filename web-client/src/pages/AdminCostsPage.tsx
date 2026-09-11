import { useEffect, useState } from "react"
import { IconCoins, IconAlertTriangle } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminCostsResponse, DateRangeKey } from "@/types/api"

// Vírgula decimal, como o resto da tela: "US$ 0.0081" ao lado de "R$ 97,48"
// faz o mesmo número parecer de dois sistemas diferentes.
function usd(v: number | null | undefined, casas = 2) {
  if (v === null || v === undefined) return "—"
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
}

function brl(v: number | null | undefined, casas = 2) {
  if (v === null || v === undefined) return "—"
  return v.toLocaleString("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  })
}

function min(v: number) {
  return `${Math.round(v).toLocaleString("pt-BR")} min`
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

function Metric({
  label,
  value,
  sub,
  destaque,
}: {
  label: string
  value: string
  sub?: string
  destaque?: boolean
}) {
  return (
    <div>
      <div
        className={`font-heading font-semibold tabular-nums ${destaque ? "text-3xl text-primary" : "text-2xl"}`}
      >
        {value}
      </div>
      <div className="text-xs font-medium">{label}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </div>
  )
}

export function AdminCostsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<AdminCostsResponse | null>(null)
  const [range, setRange] = useState<DateRangeKey>("this_month")
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [cotacaoDraft, setCotacaoDraft] = useState<string | null>(null)
  const [infraDraft, setInfraDraft] = useState<string | null>(null)

  async function load() {
    const params = new URLSearchParams({ range })
    if (range === "custom") {
      params.set("since", de)
      params.set("until", ate)
    }
    setData(await api.get<AdminCostsResponse>(`/api/admin/costs?${params}`))
  }

  useEffect(() => {
    if (!user) return
    setData(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range, de, ate])

  if (authLoading || !user) return null

  // Salva no onBlur, não a cada tecla: digitar "5,40" mandaria três
  // requisições e a mais lenta poderia vencer com o valor pela metade.
  async function salvarCotacao() {
    if (cotacaoDraft === null) return
    const valor = Number(cotacaoDraft.replace(",", "."))
    setCotacaoDraft(null)
    if (!Number.isFinite(valor) || valor <= 0) return
    await api.post("/api/admin/costs/cotacao", { cotacaoUsdBrl: valor })
    await load()
  }

  async function salvarInfra() {
    if (infraDraft === null) return
    const valor = Number(infraDraft.replace(",", "."))
    setInfraDraft(null)
    if (!Number.isFinite(valor) || valor < 0) return
    await api.post("/api/admin/costs/infra", { infraMensalUsd: valor })
    await load()
  }

  const r = data?.resumo

  return (
    <DashboardLayout user={user} onLogout={logout} title="Custos">
      <p className="text-sm text-muted-foreground">
        Quanto a operação gasta de verdade — e quanto sobra de cada plano. Os valores sobrevivem à exclusão
        de vídeos: são lançados quando o custo acontece.
      </p>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">Período</span>
          <DateRangeFilter value={range} onChange={setRange} extras={["all", "custom"]} />
        </div>
        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">até</span>
            <Input type="date" value={ate} min={de} max={hoje()} onChange={(e) => setAte(e.target.value)} className="w-auto" />
          </div>
        )}
      </div>

      {!data || !r ? (
        <Skeleton className="h-64 w-full" />
      ) : (
        <>
          {/* Os dois números que respondem "quanto custa o meu minuto".
              Separados de propósito: juntá-los num só esconderia que o
              reaproveitamento entrega minuto sem custo nenhum, e quem
              precifica pelo número misturado precifica abaixo do custo. */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconCoins className="size-4 text-muted-foreground" />
                Custo por minuto de vídeo
              </CardTitle>
              <CardDescription>
                Whisper + IA + banda de proxy pago. Túnel e reaproveitamento não entram: essa banda já está
                paga na conta de internet.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-6 sm:grid-cols-2">
              {/* A conta aparece inteira, não só o resultado: uma média sozinha
                  não dá para conferir nem diz sobre quanta coisa foi calculada
                  — R$ 0,05 por minuto medido em 10 minutos e em 10.000 minutos
                  são confianças bem diferentes. */}
              <Metric
                destaque
                label="Vídeo novo (custo real de processar)"
                value={usd(r.usdPorMinutoNovo, 4)}
                sub={
                  r.usdPorMinutoNovo === null
                    ? "nenhum vídeo novo neste período"
                    : `${usd(r.totalNovosUsd, 2)} ÷ ${min(r.minutosNovos)} processados = ${brl(
                        r.usdPorMinutoNovo * data.cotacaoUsdBrl,
                        3,
                      )}/min`
                }
              />
              <Metric
                label="Entregue (média, com reaproveitamento)"
                value={usd(r.usdPorMinutoEntregue, 4)}
                sub={
                  r.usdPorMinutoEntregue === null
                    ? "nenhum minuto entregue neste período"
                    : `${usd(r.totalUsd, 2)} ÷ ${min(r.minutosEntregues)} entregues = ${brl(
                        r.usdPorMinutoEntregue * data.cotacaoUsdBrl,
                        3,
                      )}/min`
                }
              />
            </CardContent>
          </Card>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-6">
                <Metric label="Custo total do período" value={usd(r.totalUsd)} sub={brl(r.totalUsd * data.cotacaoUsdBrl)} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Metric label="Transcrição (Whisper)" value={usd(r.whisperUsd)} sub={`${r.videos} vídeos processados`} />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Metric label="IA (Claude)" value={usd(r.iaUsd)} sub="escolha dos trechos e títulos" />
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-6">
                <Metric
                  label="Banda (proxy pago)"
                  value={usd(r.bandaUsd)}
                  sub={`${(r.bytes / 1024 ** 3).toFixed(2)} GB baixados no total`}
                />
              </CardContent>
            </Card>
          </div>

          {r.videosReaproveitados > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Economia por reaproveitamento</CardTitle>
                <CardDescription>
                  Vídeos que outro cliente já tinha baixado e transcrito. Custaram zero e mesmo assim entregaram
                  minuto de vídeo — é isso que separa os dois números lá em cima.
                </CardDescription>
              </CardHeader>
              <CardContent className="grid gap-6 sm:grid-cols-2">
                <Metric label="Vídeos reaproveitados" value={String(r.videosReaproveitados)} />
                <Metric label="Minutos entregues sem custo" value={min(r.minutosReaproveitados)} />
              </CardContent>
            </Card>
          )}

          {/* Custo sem dono: veio da série histórica, de vídeos apagados antes
              do livro existir. Só aparece quando existe, e nunca é somado às
              linhas de cliente — "sem cliente" não é "cliente zerado". */}
          {r.totalSemDonoUsd > 0 && (
            <TonePill tone="neutral">
              <IconAlertTriangle className="mr-1.5 inline size-3.5" />
              {usd(r.totalSemDonoUsd)} do período são de vídeos já apagados, recuperados da série histórica — sem
              cliente identificado, porque essa série nunca guardou essa informação.
            </TonePill>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Margem por plano</CardTitle>
              <CardDescription>
                Custo calculado com o preço medido do minuto de vídeo novo, sobre a cota mensal do plano (cota
                semanal × 4,33). Considera o plano usado por inteiro — o pior caso para a margem.
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Plano</TableHead>
                    <TableHead className="text-right">Mensalidade</TableHead>
                    <TableHead className="text-right">Cota/mês</TableHead>
                    <TableHead className="text-right">Custo se usar tudo</TableHead>
                    <TableHead className="text-right">Margem</TableHead>
                    <TableHead className="text-right">Ativos</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.margens.map((m) => (
                    <TableRow key={m.key}>
                      <TableCell className="font-medium">{m.name}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(m.priceCents / 100)}</TableCell>
                      <TableCell className="text-right tabular-nums">{min(m.minutosMes)}</TableCell>
                      <TableCell className="text-right tabular-nums">{brl(m.custoBrl)}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {brl(m.margemBrl)}
                        {m.margemPercent !== null && (
                          <span className="ml-1.5 text-xs text-muted-foreground">
                            ({m.margemPercent.toFixed(0)}%)
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{m.assinaturasAtivas}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Custo por cliente</CardTitle>
              <CardDescription>Só o período escolhido. Ordenado do que mais gasta para o que menos gasta.</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {data.porCliente.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum vídeo processado neste período.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Cliente</TableHead>
                      <TableHead className="text-right">Vídeos</TableHead>
                      <TableHead className="text-right">Minutos</TableHead>
                      <TableHead className="text-right">Whisper</TableHead>
                      <TableHead className="text-right">IA</TableHead>
                      <TableHead className="text-right">Banda</TableHead>
                      <TableHead className="text-right">Total</TableHead>
                      <TableHead className="text-right">US$/min</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {data.porCliente.map((c) => (
                      <TableRow key={c.clientUserId}>
                        <TableCell className="font-medium">{c.nome}</TableCell>
                        <TableCell className="text-right tabular-nums">{c.videos}</TableCell>
                        <TableCell className="text-right tabular-nums">{min(c.minutos)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.whisperUsd, 3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.iaUsd, 3)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.bandaUsd, 3)}</TableCell>
                        <TableCell className="text-right font-semibold tabular-nums">{usd(c.totalUsd)}</TableCell>
                        <TableCell className="text-right tabular-nums">{usd(c.usdPorMinuto, 4)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Parâmetros da conta</CardTitle>
              <CardDescription>
                O custo fixo fica separado do custo por vídeo de propósito: somar os dois num número só faria o
                "custo por minuto" subir justamente nos meses de pouco movimento.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Dólar (R$)</span>
                <Input
                  value={cotacaoDraft ?? String(data.cotacaoUsdBrl)}
                  onChange={(e) => setCotacaoDraft(e.target.value)}
                  onBlur={salvarCotacao}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">Usado só para mostrar os valores em real.</span>
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-medium">Custo fixo mensal (US$)</span>
                <Input
                  value={infraDraft ?? String(data.infraMensalUsd)}
                  onChange={(e) => setInfraDraft(e.target.value)}
                  onBlur={salvarInfra}
                  className="w-32"
                />
                <span className="text-xs text-muted-foreground">
                  VPS e o que mais roda independente de quantos vídeos entram.
                  {data.infraMensalUsd > 0 && ` Hoje: ${brl(data.infraMensalUsd * data.cotacaoUsdBrl)}/mês.`}
                </span>
              </label>
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
