import { useEffect, useMemo, useState } from "react"
import {
  IconTrendingUp,
  IconUsers,
  IconReceipt2,
  IconAlertTriangle,
  IconSparkles,
  IconRepeat,
  IconPuzzle,
  IconArrowBackUp,
  IconUserMinus,
} from "@tabler/icons-react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { StatCard } from "@/components/dashboard/StatCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill } from "@/components/ui/tone-pill"
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart"
import { Bandeira, bandeiraDoAsaas } from "@/components/checkout/BandeirasDeCartao"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminRevenueResponse, AssinaturaDaReceita, DateRangeKey, TipoDeReceita } from "@/types/api"

function brl(cents: number | null | undefined) {
  if (cents === null || cents === undefined) return "—"
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function data(iso: string | null | undefined, comHora = false) {
  if (!iso) return "—"
  return new Date(iso).toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    ...(comHora ? { hour: "2-digit", minute: "2-digit" } : {}),
    timeZone: "America/Sao_Paulo",
  })
}

// Dia de hoje em Brasília, o mesmo fuso do filtro no servidor. toISOString
// usaria UTC: depois das 21h o seletor abriria em "amanhã".
function hoje() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())
}

function mesesTexto(n: number) {
  if (n === 0) return "menos de 1 mês"
  return n === 1 ? "1 mês" : `${n} meses`
}

const NOME_DO_TIPO: Record<TipoDeReceita, string> = {
  primeira_mensalidade: "Primeira mensalidade",
  recorrencia: "Mensalidade (recorrência)",
  credito_avulso: "Crédito avulso",
  excedente: "Excedente",
  conexoes_extras: "Conexões extras",
}

// As cores do gráfico são as três primeiras da paleta categórica de
// referência, validadas nos dois temas contra as superfícies deste painel
// (#ffffff e #141619). No tema claro o verde fica abaixo de 3:1 de contraste:
// por isso o gráfico sempre tem legenda E a tabela com os valores logo abaixo.
// A ordem é fixa - a cor segue o tipo de receita, nunca a posição na pilha.
const chartConfig = {
  primeira: { label: "Primeira venda", theme: { light: "#2a78d6", dark: "#3987e5" } },
  recorrencia: { label: "Recorrência", theme: { light: "#1baf7a", dark: "#199e70" } },
  extras: { label: "Gastos extras", theme: { light: "#eb6834", dark: "#d95926" } },
} satisfies ChartConfig

const ORDEM_DA_PILHA = ["primeira", "recorrencia", "extras"]

function rotuloDoMes(mes: string) {
  const [ano, m] = mes.split("-").map(Number)
  const texto = new Date(Date.UTC(ano, m - 1, 15)).toLocaleDateString("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" })
  // Só a primeira letra: a classe `capitalize` do CSS subia TODAS ("Set. De 26").
  return texto.charAt(0).toUpperCase() + texto.slice(1)
}

function MeioDePagamento({ a }: { a: AssinaturaDaReceita }) {
  if (a.meioDePagamento === "pix") return <span className="text-sm">PIX Automático</span>
  if (a.meioDePagamento === "manual") return <span className="text-sm text-muted-foreground">Atribuído pelo admin</span>
  const id = a.cartao ? bandeiraDoAsaas(a.cartao.bandeira) : null
  return (
    <span className="inline-flex items-center gap-1.5 text-sm tabular-nums">
      {id && <Bandeira id={id} className="shrink-0" />}
      {a.cartao ? `•••• ${a.cartao.final}` : "Cartão"}
    </span>
  )
}

function StatusDaAssinatura({ a }: { a: AssinaturaDaReceita }) {
  if (a.status === "inadimplente") return <TonePill tone="danger">Inadimplente</TonePill>
  if (a.status === "cancelado") return <TonePill tone="neutral">Cancelada</TonePill>
  // Já cancelou, mas ainda está no período pago: continua ativo e fora do MRR.
  if (a.cancelaEm) {
    return <TonePill tone="violet">Cancela em {new Date(a.cancelaEm).toLocaleDateString("pt-BR")}</TonePill>
  }
  if (!a.pagante) return <TonePill tone="neutral">Cortesia</TonePill>
  return <TonePill tone="success">Pagante</TonePill>
}

function Cliente({ nome, email }: { nome: string | null; email: string | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate font-medium">{nome || email || "Cliente removido"}</div>
      {nome && email && <div className="truncate text-xs text-muted-foreground">{email}</div>}
    </div>
  )
}

export function AdminRevenuePage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [dados, setDados] = useState<AdminRevenueResponse | null>(null)
  const [range, setRange] = useState<DateRangeKey>("this_month")
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  const [filtroAtivas, setFiltroAtivas] = useState<"todas" | "pagantes" | "cortesia" | "inadimplentes">("todas")

  useEffect(() => {
    if (!user) return
    setDados(null)
    const params = new URLSearchParams({ range })
    if (range === "custom") {
      params.set("since", de)
      params.set("until", ate)
    }
    api.get<AdminRevenueResponse>(`/api/admin/revenue?${params}`).then(setDados)
  }, [user, range, de, ate])

  const serieMensal = useMemo(
    () =>
      (dados?.porMes ?? []).map((m) => ({
        mes: rotuloDoMes(m.mes),
        primeira: m.primeiraCents / 100,
        recorrencia: m.recorrenciaCents / 100,
        extras: m.extrasCents / 100,
        totalCents: m.primeiraCents + m.recorrenciaCents + m.extrasCents,
      })),
    [dados],
  )

  if (authLoading || !user) return null

  const ativas = (dados?.assinaturas ?? []).filter((a) => a.status === "ativo" || a.status === "inadimplente")
  const ativasFiltradas = ativas.filter((a) => {
    if (filtroAtivas === "pagantes") return a.status === "ativo" && a.pagante
    if (filtroAtivas === "cortesia") return a.status === "ativo" && !a.pagante
    if (filtroAtivas === "inadimplentes") return a.status === "inadimplente"
    return true
  })
  const canceladas = (dados?.assinaturas ?? []).filter((a) => a.status === "cancelado")
  const semReceitaNoAno = serieMensal.every((m) => m.totalCents === 0)

  return (
    <DashboardLayout user={user} onLogout={logout} title="Receita">
      <p className="text-sm text-muted-foreground">
        Quanto entra, de onde vem e quanto entra todo mês. Cada pagamento é registrado no momento em que o dinheiro
        cai — inclusive as renovações mensais — e estorno sai no dia em que acontece.
      </p>

      {/* O PRESENTE. MRR é uma foto de agora, não soma de período - por isso
          fica acima do filtro, que não mexe nestes números. */}
      <section className="flex flex-col gap-3">
        <h2 className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">Agora</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {dados ? (
            <>
              <StatCard
                label="MRR — receita recorrente mensal"
                value={brl(dados.atual.mrrCents)}
                hint={`${brl(dados.atual.arrCents)} por ano (ARR)`}
                icon={<IconTrendingUp />}
              />
              <StatCard
                label="Assinaturas ativas pagantes"
                value={dados.atual.pagantes}
                hint={
                  dados.atual.cortesia > 0
                    ? `+ ${dados.atual.cortesia} de cortesia (plano sem cobrança)`
                    : "nenhuma de cortesia"
                }
                icon={<IconUsers />}
              />
              <StatCard
                label="Ticket médio por assinante"
                value={brl(dados.atual.ticketMedioCents)}
                hint={dados.atual.ticketMedioCents === null ? "nenhum assinante pagante ainda" : "MRR ÷ assinantes pagantes"}
                icon={<IconReceipt2 />}
              />
              <StatCard
                label="Inadimplentes"
                value={dados.atual.inadimplentes}
                hint={
                  dados.atual.mrrEmRiscoCents > 0
                    ? `${brl(dados.atual.mrrEmRiscoCents)}/mês esperando pagamento`
                    : `${dados.atual.canceladas} cancelada(s) no total`
                }
                icon={<IconAlertTriangle />}
              />
            </>
          ) : (
            [0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-28" />)
          )}
        </div>
      </section>

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

      {!dados ? (
        <Skeleton className="h-96 w-full" />
      ) : (
        <Tabs defaultValue="visao">
          <TabsList className="max-w-full justify-start overflow-x-auto">
            <TabsTrigger value="visao">Visão geral</TabsTrigger>
            <TabsTrigger value="ativas">Assinaturas ativas ({ativas.length})</TabsTrigger>
            <TabsTrigger value="canceladas">Canceladas ({canceladas.length})</TabsTrigger>
            <TabsTrigger value="pagamentos">Pagamentos ({dados.pagamentos.length})</TabsTrigger>
          </TabsList>

          {/* ---------------- Visão geral ---------------- */}
          <TabsContent value="visao" className="flex flex-col gap-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <StatCard
                label="Receita líquida no período"
                value={brl(dados.periodo.liquidoCents)}
                hint={
                  dados.periodo.estornosCents > 0
                    ? `${brl(dados.periodo.brutoCents)} recebidos − ${brl(dados.periodo.estornosCents)} estornados`
                    : `${dados.periodo.pagamentos} pagamento(s) recebido(s)`
                }
                icon={<IconTrendingUp />}
              />
              <StatCard
                label="Primeira venda"
                value={brl(dados.periodo.primeiraCents)}
                hint={`${dados.periodo.novasAssinaturas} assinatura(s) nova(s)`}
                icon={<IconSparkles />}
              />
              <StatCard
                label="Recorrência (2ª mensalidade em diante)"
                value={brl(dados.periodo.recorrenciaCents)}
                hint={`${dados.periodo.renovacoes} renovação(ões) paga(s)`}
                icon={<IconRepeat />}
              />
              <StatCard
                label="Gastos extras"
                value={brl(dados.periodo.extrasCents)}
                hint={`avulso ${brl(dados.periodo.extras.creditoAvulsoCents)} · excedente ${brl(
                  dados.periodo.extras.excedenteCents,
                )} · conexões ${brl(dados.periodo.extras.conexoesExtrasCents)}`}
                icon={<IconPuzzle />}
              />
              <StatCard
                label="Estornos e contestações"
                value={brl(dados.periodo.estornosCents)}
                hint={`${dados.periodo.estornosQtd} no período`}
                icon={<IconArrowBackUp />}
              />
              <StatCard
                label="Cancelamentos"
                value={dados.periodo.cancelamentos}
                hint="assinaturas canceladas no período"
                icon={<IconUserMinus />}
              />
            </div>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">Receita por mês</CardTitle>
                <CardDescription>
                  Últimos 12 meses, sempre — independente do filtro de período. Valores recebidos, antes de estornos.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                {semReceitaNoAno ? (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento recebido nos últimos 12 meses.</p>
                ) : (
                  <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
                    <BarChart data={serieMensal} barCategoryGap="28%">
                      <CartesianGrid vertical={false} />
                      <XAxis dataKey="mes" tickLine={false} axisLine={false} minTickGap={8} />
                      <YAxis
                        tickLine={false}
                        axisLine={false}
                        width={64}
                        tickFormatter={(v: number) =>
                          v.toLocaleString("pt-BR", { style: "currency", currency: "BRL", notation: "compact" })
                        }
                      />
                      <ChartTooltip
                        cursor={{ fill: "var(--muted)", opacity: 0.5 }}
                        content={
                          <ChartTooltipContent
                            formatter={(value, name) => (
                              <div className="flex w-full items-center justify-between gap-4">
                                <span className="text-muted-foreground">
                                  {chartConfig[name as keyof typeof chartConfig]?.label ?? name}
                                </span>
                                <span className="font-medium tabular-nums">
                                  {Number(value).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}
                                </span>
                              </div>
                            )}
                          />
                        }
                      />
                      {/* Na ordem da pilha, de baixo pra cima. Sem isto o Recharts ordena
                          a legenda em ordem alfabética e ela deixa de bater com o gráfico. */}
                      <ChartLegend
                        content={<ChartLegendContent />}
                        itemSorter={(item) => ORDEM_DA_PILHA.indexOf(String(item.dataKey))}
                      />
                      {/* Traço da cor do cartão entre os segmentos: é o espaço
                          de 2px que separa uma camada da outra sem desenhar
                          borda nenhuma. Só o topo da pilha é arredondado.

                          SEM ANIMAÇÃO, de propósito: no tema escuro e no
                          celular a tela redesenha logo depois de abrir (o tema
                          é aplicado, o menu vira o do celular), e o Recharts
                          interrompia a animação no meio - as barras ficavam
                          com altura zero e o gráfico aparecia vazio. Visto na
                          verificação com Playwright em 13/09/2026. */}
                      <Bar dataKey="primeira" stackId="r"
                        isAnimationActive={false} fill="var(--color-primeira)" stroke="var(--card)" strokeWidth={2} />
                      <Bar dataKey="recorrencia" stackId="r"
                        isAnimationActive={false} fill="var(--color-recorrencia)" stroke="var(--card)" strokeWidth={2} />
                      <Bar
                        dataKey="extras"
                        stackId="r"
                        isAnimationActive={false}
                        fill="var(--color-extras)"
                        stroke="var(--card)"
                        strokeWidth={2}
                        radius={[4, 4, 0, 0]}
                      />
                    </BarChart>
                  </ChartContainer>
                )}

                {/* A tabela é a leitura exata do gráfico - e a garantia de que
                    ninguém depende só da cor para saber quanto veio de onde. */}
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Mês</TableHead>
                        <TableHead className="text-right">Primeira venda</TableHead>
                        <TableHead className="text-right">Recorrência</TableHead>
                        <TableHead className="text-right">Gastos extras</TableHead>
                        <TableHead className="text-right">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {[...(dados.porMes ?? [])]
                        .reverse()
                        .filter((m, i) => i < 6 || m.primeiraCents + m.recorrenciaCents + m.extrasCents > 0)
                        .map((m) => (
                          <TableRow key={m.mes}>
                            <TableCell className="whitespace-nowrap font-medium">{rotuloDoMes(m.mes)}</TableCell>
                            <TableCell className="text-right tabular-nums">{brl(m.primeiraCents)}</TableCell>
                            <TableCell className="text-right tabular-nums">{brl(m.recorrenciaCents)}</TableCell>
                            <TableCell className="text-right tabular-nums">{brl(m.extrasCents)}</TableCell>
                            <TableCell className="text-right font-semibold tabular-nums">
                              {brl(m.primeiraCents + m.recorrenciaCents + m.extrasCents)}
                            </TableCell>
                          </TableRow>
                        ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">MRR por plano</CardTitle>
                <CardDescription>
                  Mensalidade cheia de cada assinante pagante, com as conexões extras. O preço de estreia não entra:
                  ele acontece uma vez só.
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {dados.atual.mrrPorPlano.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura pagante ativa.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Plano</TableHead>
                        <TableHead className="text-right">Assinantes</TableHead>
                        <TableHead className="text-right">MRR</TableHead>
                        <TableHead className="text-right">Parte do MRR</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.atual.mrrPorPlano.map((p) => (
                        <TableRow key={p.key}>
                          <TableCell className="font-medium">{p.name}</TableCell>
                          <TableCell className="text-right tabular-nums">{p.assinaturas}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(p.mrrCents)}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            {dados.atual.mrrCents ? `${Math.round((p.mrrCents / dados.atual.mrrCents) * 100)}%` : "—"}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Assinaturas ativas ---------------- */}
          <TabsContent value="ativas" className="flex flex-col gap-3">
            <div className="-mx-1 overflow-x-auto px-1 pb-1">
              <ToggleGroup
                type="single"
                variant="outline"
                value={filtroAtivas}
                onValueChange={(v) => v && setFiltroAtivas(v as typeof filtroAtivas)}
              >
                <ToggleGroupItem value="todas">Todas</ToggleGroupItem>
                <ToggleGroupItem value="pagantes">Pagantes</ToggleGroupItem>
                <ToggleGroupItem value="cortesia">Cortesia</ToggleGroupItem>
                <ToggleGroupItem value="inadimplentes">Inadimplentes</ToggleGroupItem>
              </ToggleGroup>
            </div>
            <Card>
              <CardContent className="overflow-x-auto pt-6">
                {ativasFiltradas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura neste filtro.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Situação</TableHead>
                        <TableHead className="text-right">Mensalidade</TableHead>
                        <TableHead>Pagamento</TableHead>
                        <TableHead>Assina há</TableHead>
                        <TableHead className="text-right">Parcelas pagas</TableHead>
                        <TableHead className="text-right">Total pago</TableHead>
                        <TableHead>Último pagamento</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {ativasFiltradas.map((a) => (
                        <TableRow key={a.clientUserId}>
                          <TableCell className="max-w-56">
                            <Cliente nome={a.nome} email={a.email} />
                          </TableCell>
                          <TableCell>
                            {a.planName ?? "—"}
                            {(a.extraChannels > 0 || a.extraTiktokAccounts > 0) && (
                              <div className="text-xs text-muted-foreground">
                                +{a.extraChannels} canal · +{a.extraTiktokAccounts} conta
                              </div>
                            )}
                          </TableCell>
                          <TableCell>
                            <StatusDaAssinatura a={a} />
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {a.pagante ? brl(a.mensalidadeCents) : <span className="text-muted-foreground">R$ 0,00</span>}
                          </TableCell>
                          <TableCell>
                            <MeioDePagamento a={a} />
                          </TableCell>
                          <TableCell className="whitespace-nowrap">
                            {mesesTexto(a.meses)}
                            <div className="text-xs text-muted-foreground">desde {data(a.assinanteDesde)}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{a.parcelasPagas}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(a.totalPagoCents)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{data(a.ultimoPagamento)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Canceladas ---------------- */}
          <TabsContent value="canceladas">
            <Card>
              <CardContent className="overflow-x-auto pt-6">
                {canceladas.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhuma assinatura cancelada.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Plano</TableHead>
                        <TableHead>Assinou por</TableHead>
                        <TableHead>Cancelada em</TableHead>
                        <TableHead className="text-right">Parcelas pagas</TableHead>
                        <TableHead className="text-right">Total pago</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {canceladas.map((a) => (
                        <TableRow key={a.clientUserId}>
                          <TableCell className="max-w-56">
                            <Cliente nome={a.nome} email={a.email} />
                          </TableCell>
                          <TableCell>{a.planName ?? "—"}</TableCell>
                          <TableCell className="whitespace-nowrap">{mesesTexto(a.meses)}</TableCell>
                          <TableCell className="whitespace-nowrap tabular-nums">{data(a.canceladoEm)}</TableCell>
                          <TableCell className="text-right tabular-nums">{a.parcelasPagas}</TableCell>
                          <TableCell className="text-right tabular-nums">{brl(a.totalPagoCents)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* ---------------- Pagamentos ---------------- */}
          <TabsContent value="pagamentos">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Pagamentos recebidos no período</CardTitle>
                <CardDescription>Do mais recente para o mais antigo. Estornados continuam na lista, marcados.</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                {dados.pagamentos.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Nenhum pagamento neste período.</p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Data</TableHead>
                        <TableHead>Cliente</TableHead>
                        <TableHead>Produto</TableHead>
                        <TableHead>Meio</TableHead>
                        <TableHead className="text-right">Valor</TableHead>
                        <TableHead>Situação</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dados.pagamentos.map((p) => (
                        <TableRow key={p.id}>
                          <TableCell className="whitespace-nowrap tabular-nums">{data(p.paidAt, true)}</TableCell>
                          <TableCell className="max-w-56">
                            <Cliente nome={p.nome} email={p.email} />
                          </TableCell>
                          <TableCell>
                            {NOME_DO_TIPO[p.kind]}
                            {p.planName && <div className="text-xs text-muted-foreground">Plano {p.planName}</div>}
                          </TableCell>
                          <TableCell className="text-sm">
                            {p.billingType === "PIX" ? "PIX" : p.billingType === "CREDIT_CARD" ? "Cartão" : "—"}
                          </TableCell>
                          <TableCell className="text-right font-medium tabular-nums">{brl(p.amountCents)}</TableCell>
                          <TableCell>
                            {p.refundedAt ? (
                              <TonePill tone="danger">Estornado {data(p.refundedAt)}</TonePill>
                            ) : (
                              <TonePill tone="success">Pago</TonePill>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      )}
    </DashboardLayout>
  )
}
