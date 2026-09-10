import { useEffect, useState } from "react"
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts"
import {
  IconCoins,
  IconUsers,
  IconUserCheck,
  IconUserOff,
  IconWallet,
  IconCopy,
  IconCheck,
  IconGift,
  IconPointer,
  IconTrendingUp,
  IconShoppingBag,
  IconRepeat,
  IconPlus,
  IconArchive,
  IconArchiveOff,
  IconPencil,
  IconLink,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { StatCard } from "@/components/dashboard/StatCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useDateRange } from "@/hooks/useDateRange"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { useT, type ChaveDeTraducao } from "@/i18n"
import { data as formatarData } from "@/lib/formatoLocal"
import type {
  AffiliateLink,
  ClientCommissionsOverviewResponse,
  PixKeyType,
  WithdrawalStatus,
} from "@/types/api"

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const WITHDRAWAL_TONE: Record<WithdrawalStatus, "success" | "danger" | "neutral"> = {
  pendente: "neutral",
  pago: "success",
  recusado: "danger",
}

const WITHDRAWAL_LABEL: Record<WithdrawalStatus, ChaveDeTraducao> = {
  pendente: "com.statusPendente",
  pago: "com.statusPago",
  recusado: "com.statusRecusado",
}

const PIX_TYPES: { value: PixKeyType; label: ChaveDeTraducao }[] = [
  { value: "cpf", label: "com.pixTipoCpf" },
  { value: "cnpj", label: "com.pixTipoCnpj" },
  { value: "email", label: "com.pixTipoEmail" },
  { value: "telefone", label: "com.pixTipoTelefone" },
  { value: "aleatoria", label: "com.pixTipoAleatoria" },
]

// O status da assinatura do indicado, do ponto de vista de quem indicou.
// "sem_plano" aqui não é falha: é alguém que criou a conta e ainda não assinou,
// e continua podendo assinar amanhã.
const STATUS_INDICADO: Record<string, { tone: "success" | "danger" | "neutral"; label: ChaveDeTraducao }> = {
  ativo: { tone: "success", label: "adm.ativo" },
  cancelado: { tone: "danger", label: "com.assinaturasCanceladas" },
  inadimplente: { tone: "danger", label: "com.assinaturasAtrasadas" },
  sem_plano: { tone: "neutral", label: "adm.semPlano" },
}

/** Uma linha de link: endereço para copiar, números e as ações. */
function LinhaDoLink({
  link,
  t,
  onRename,
  onArchive,
  busy,
}: {
  link: AffiliateLink
  t: ReturnType<typeof useT>
  onRename: (link: AffiliateLink, label: string) => Promise<void>
  onArchive: (link: AffiliateLink, arquivar: boolean) => Promise<void>
  busy: boolean
}) {
  const [copiado, setCopiado] = useState(false)
  const [editando, setEditando] = useState(false)
  const [rascunho, setRascunho] = useState(link.label ?? "")

  async function copiar() {
    await navigator.clipboard.writeText(link.url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  const arquivado = link.archivedAt !== null

  return (
    <div className={`flex flex-col gap-3 rounded-lg border border-border p-4 ${arquivado ? "opacity-60" : ""}`}>
      <div className="flex flex-wrap items-center gap-2">
        {editando ? (
          <>
            <Input
              value={rascunho}
              autoFocus
              maxLength={60}
              className="h-8 max-w-64"
              onChange={(e) => setRascunho(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && rascunho.trim()) {
                  onRename(link, rascunho.trim()).then(() => setEditando(false))
                }
                if (e.key === "Escape") setEditando(false)
              }}
            />
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !rascunho.trim()}
              onClick={() => onRename(link, rascunho.trim()).then(() => setEditando(false))}
            >
              {t("com.salvarNome")}
            </Button>
          </>
        ) : (
          <>
            <IconLink className="size-4 shrink-0 text-muted-foreground" />
            <span className="font-medium">{link.label || t("com.linkPrincipal")}</span>
            {/* A pílula só entra quando o link principal ganhou nome próprio -
                senão a linha diria "Link principal" duas vezes seguidas. */}
            {link.isDefault && link.label && (
              <TonePill tone="indigo" dot={false}>{t("com.linkPrincipal")}</TonePill>
            )}
            {arquivado && <TonePill tone="neutral" dot={false}>{t("com.arquivado")}</TonePill>}
            <Button size="sm" variant="ghost" className="h-7 gap-1 px-2" onClick={() => setEditando(true)}>
              <IconPencil className="size-3.5" />
              {t("com.renomear")}
            </Button>
            {!link.isDefault && (
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 px-2"
                disabled={busy}
                onClick={() => onArchive(link, !arquivado)}
              >
                {arquivado ? <IconArchiveOff className="size-3.5" /> : <IconArchive className="size-3.5" />}
                {arquivado ? t("com.desarquivar") : t("com.arquivar")}
              </Button>
            )}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row">
        <Input readOnly value={link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
        <Button variant={copiado ? "outline" : "default"} size="sm" onClick={copiar} className="shrink-0 gap-1.5">
          {copiado ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
          {copiado ? t("com.linkCopiado") : t("com.copiarLink")}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 text-sm sm:grid-cols-4">
        <div>
          <p className="font-heading text-xl font-semibold tabular-nums">{link.clicksPeriod}</p>
          <p className="text-xs text-muted-foreground">{t("com.cliquesNoPeriodo")}</p>
        </div>
        <div>
          <p className="font-heading text-xl font-semibold tabular-nums">{link.referralCount}</p>
          <p className="text-xs text-muted-foreground">{t("com.cadastros")}</p>
        </div>
        <div>
          <p className="font-heading text-xl font-semibold tabular-nums">{link.activeCount}</p>
          <p className="text-xs text-muted-foreground">{t("com.assinantes")}</p>
        </div>
        <div>
          <p className="font-heading text-xl font-semibold tabular-nums">{formatCents(link.commissionCents)}</p>
          <p className="text-xs text-muted-foreground">{t("com.comissaoGerada")}</p>
        </div>
      </div>
    </div>
  )
}

export function ClientCommissionsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [dados, setDados] = useState<ClientCommissionsOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pixKeyDraft, setPixKeyDraft] = useState("")
  const [pixTypeDraft, setPixTypeDraft] = useState<PixKeyType | "">("")
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [novoLink, setNovoLink] = useState("")
  const [mostrarArquivados, setMostrarArquivados] = useState(false)

  async function load() {
    const res = await api.get<ClientCommissionsOverviewResponse>(`/api/client/commissions/overview?range=${range}`)
    setDados(res)
    setPixKeyDraft(res.pix.key ?? "")
    setPixTypeDraft(res.pix.type ?? "")
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range])

  // Todo hook precisa vir ANTES deste return: um retorno antecipado no meio da
  // lista faz a primeira renderização declarar menos hooks que a seguinte, e a
  // tela fica branca (React #310) — já aconteceu em /client/billing.
  if (authLoading || !user) return null

  async function copyLink() {
    if (!dados) return
    await navigator.clipboard.writeText(dados.link.url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  async function acao(chave: string, fn: () => Promise<void>, mensagem?: string) {
    setError(null)
    setInfo(null)
    setBusyKey(chave)
    try {
      await fn()
      if (mensagem) setInfo(mensagem)
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    } finally {
      setBusyKey(null)
    }
  }

  const savePixKey = () =>
    acao("pix", () => api.put("/api/client/commissions/pix-key", { pixKey: pixKeyDraft, pixKeyType: pixTypeDraft }), t("com.chavePixSalva"))

  const requestWithdrawal = () =>
    acao("saque", () => api.post("/api/client/commissions/withdraw"), t("com.saqueSolicitado"))

  const criarLink = () =>
    acao(
      "novoLink",
      async () => {
        await api.post("/api/client/commissions/links", { label: novoLink.trim() })
        setNovoLink("")
      },
      t("com.linkCriado"),
    )

  const renomearLink = (link: AffiliateLink, label: string) =>
    acao(`rename-${link.id}`, () => api.put(`/api/client/commissions/links/${link.id}`, { label }), t("com.nomeSalvo"))

  const arquivarLink = (link: AffiliateLink, arquivar: boolean) =>
    acao(`archive-${link.id}`, () => api.post(`/api/client/commissions/links/${link.id}/archive`, { archived: arquivar }))

  const podeSacar = dados ? dados.balance.availableCents >= dados.minWithdrawCents : false
  const faltamCents = dados ? Math.max(0, dados.minWithdrawCents - dados.balance.availableCents) : 0
  const ativos = dados ? dados.links.filter((l) => !l.archivedAt) : []
  const arquivados = dados ? dados.links.filter((l) => l.archivedAt) : []

  const chartConfig: ChartConfig = { clicks: { label: t("com.cliques"), color: "var(--tone-indigo-ink)" } }

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("com.clienteTitulo")}>
      <PageHeader title={t("com.clienteTitulo")} description={t("com.linksDescricao")} />

      {!dados ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-status-posted">{info}</p>}

          <Card className="border-primary/25 bg-primary/[0.04]">
            <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-start sm:justify-between">
              <div className="flex items-start gap-3">
                <IconGift className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-heading text-base font-semibold">{t("com.clienteIncentivoTitulo")}</p>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("com.clienteIncentivoTexto")}</p>
                  {/* Os dois percentuais dele, ditos na cara: é a informação que
                      decide se vale a pena divulgar, e ela mudava por afiliado
                      sem aparecer em lugar nenhum. */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <TonePill tone="violet" dot={false}>
                      {t("com.percentPrimeiraVenda", { percent: dados.percent.first })}
                    </TonePill>
                    <TonePill tone="cyan" dot={false}>
                      {t("com.percentRecorrencia", { percent: dados.percent.recurring })}
                    </TonePill>
                  </div>
                </div>
              </div>
              <div className="flex shrink-0 flex-col gap-2 sm:w-72">
                <Input readOnly value={dados.link.url} className="font-mono text-xs" onFocus={(e) => e.target.select()} />
                <Button variant={copiado ? "outline" : "default"} size="sm" onClick={copyLink} className="gap-1.5">
                  {copiado ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
                  {copiado ? t("com.linkCopiado") : t("com.copiarLink")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <DateRangeFilter value={range} onChange={setRange} />

          <Tabs defaultValue="desempenho">
            {/* As 4 abas não cabem em 320px. Rolam dentro da própria faixa, do
                mesmo jeito que o filtro de período — a página continua sem
                rolagem lateral, que é o que estraga a leitura no celular. */}
            <div className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <TabsList className="w-max">
                <TabsTrigger value="desempenho">{t("com.abaDesempenho")}</TabsTrigger>
                <TabsTrigger value="links">{t("com.abaLinks")}</TabsTrigger>
                <TabsTrigger value="indicacoes">{t("com.abaIndicacoes")}</TabsTrigger>
                <TabsTrigger value="saque">{t("com.abaSaque")}</TabsTrigger>
              </TabsList>
            </div>

            {/* ---------------- Desempenho ---------------- */}
            <TabsContent value="desempenho" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label={t("com.cliquesNoPeriodo")} value={dados.clicks.period} icon={<IconPointer />} />
                <StatCard label={t("com.assinaturasAtivas")} value={dados.subscriptions.active} icon={<IconUserCheck />} />
                <StatCard label={t("com.assinaturasCanceladas")} value={dados.subscriptions.canceled} icon={<IconUserOff />} />
                <StatCard label={t("com.indicacoes")} value={dados.referralCount} icon={<IconUsers />} />
              </div>

              {/* Venda nova e recorrência ficam em cartões separados de
                  propósito: somadas, escondem justamente o que diz se o
                  esforço de divulgação desse mês deu resultado. */}
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <Card>
                  <CardHeader className="gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="font-heading text-3xl font-semibold tabular-nums">
                          {formatCents(dados.sales.commissionCents)}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {t("com.vendasNoMes")} · {dados.sales.count}
                        </CardDescription>
                      </div>
                      <IconShoppingBag className="mt-1 size-4 text-muted-foreground/50" />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("com.vendasNoMesDica")}</p>
                  </CardHeader>
                </Card>
                <Card>
                  <CardHeader className="gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="font-heading text-3xl font-semibold tabular-nums">
                          {formatCents(dados.recurring.commissionCents)}
                        </CardTitle>
                        <CardDescription className="mt-1">
                          {t("com.recorrenciaNoMes")} · {dados.recurring.count}
                        </CardDescription>
                      </div>
                      <IconRepeat className="mt-1 size-4 text-muted-foreground/50" />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("com.recorrenciaNoMesDica")}</p>
                  </CardHeader>
                </Card>
                {/* O MRR previsto fica ao lado dos outros dois porque é a mesma
                    pergunta ("quanto isso me rende"), e leva a conta escrita:
                    um número sozinho chamado "previsto" não diz de onde saiu. */}
                <Card>
                  <CardHeader className="gap-1">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <CardTitle className="font-heading text-3xl font-semibold tabular-nums">
                          {formatCents(dados.subscriptions.mrrCents)}
                        </CardTitle>
                        <CardDescription className="mt-1">{t("com.mrrPrevisto")}</CardDescription>
                      </div>
                      <IconTrendingUp className="mt-1 size-4 text-muted-foreground/50" />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {t("com.mrrPrevistoDica", {
                        base: formatCents(dados.subscriptions.mrrBaseCents),
                        percent: dados.percent.recurring,
                      })}
                    </p>
                  </CardHeader>
                </Card>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label={t("com.comissaoTotal")} value={formatCents(dados.balance.totalEarnedCents)} icon={<IconCoins />} />
                <StatCard label={t("com.saldoDisponivel")} value={formatCents(dados.balance.availableCents)} icon={<IconWallet />} />
                <StatCard label={t("com.cliquesTotais")} value={dados.clicks.total} icon={<IconPointer />} />
              </div>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("com.cliquesPorDia")}</CardTitle>
                  <CardDescription>{t("com.cliquesPorDiaDica")}</CardDescription>
                </CardHeader>
                <CardContent>
                  {dados.clicks.byDay.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("com.semCliquesNoPeriodo")}</p>
                  ) : (
                    <ChartContainer config={chartConfig} className="aspect-auto h-56 w-full">
                      <BarChart
                        data={dados.clicks.byDay.map((d) => ({
                          dia: new Date(d.dia).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }),
                          clicks: d.clicks,
                        }))}
                      >
                        <CartesianGrid vertical={false} />
                        <XAxis dataKey="dia" tickLine={false} axisLine={false} minTickGap={24} />
                        <YAxis tickLine={false} axisLine={false} width={32} allowDecimals={false} />
                        <ChartTooltip content={<ChartTooltipContent />} />
                        <Bar dataKey="clicks" fill="var(--color-clicks)" radius={3} />
                      </BarChart>
                    </ChartContainer>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("com.extratoComissoes")}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {dados.recentCommissions.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("com.nenhumaComissaoNoPeriodo")}</p>
                  ) : (
                    dados.recentCommissions.map((c) => (
                      <div key={c.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                        <span className="text-muted-foreground">{c.referredBusinessName || c.referredEmail}</span>
                        <div className="flex items-center gap-3">
                          {/* Estornado ganha a pílula de aviso no lugar do tipo:
                              o que importa nessa linha deixou de ser "venda ou
                              recorrência" e passou a ser "esse dinheiro voltou". */}
                          {c.reversedAt ? (
                            <TonePill tone="danger" dot={false}>
                              {t("com.comissaoEstornada")}
                            </TonePill>
                          ) : (
                            <TonePill tone={c.kind === "primeira" ? "violet" : "cyan"} dot={false}>
                              {c.kind === "primeira" ? t("com.tipoPrimeira") : t("com.tipoRecorrencia")}
                            </TonePill>
                          )}
                          <span className="tabular-nums text-muted-foreground">{c.commissionPercent}%</span>
                          <span
                            className={`w-24 text-right tabular-nums font-medium ${c.reversedAt ? "text-muted-foreground line-through" : ""}`}
                          >
                            {formatCents(c.commissionCents)}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                  {/* O extrato mostra um recorte. Sem dizer isso, quem somar as
                      linhas encontra menos que o cartão do período e conclui
                      que um dos dois está errado. */}
                  {dados.recentCommissions.length >= 30 && (
                    <p className="pt-1 text-xs text-muted-foreground">
                      {t("com.extratoRecorte", { n: dados.recentCommissions.length })}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---------------- Meus links ---------------- */}
            <TabsContent value="links" className="flex flex-col gap-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("com.linksTitulo")}</CardTitle>
                  <CardDescription>{t("com.linksDescricao")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <Field className="flex-1">
                      <FieldLabel htmlFor="novoLink">{t("com.nomeDoLink")}</FieldLabel>
                      <Input
                        id="novoLink"
                        value={novoLink}
                        maxLength={60}
                        placeholder={t("com.nomeDoLinkDica")}
                        onChange={(e) => setNovoLink(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && novoLink.trim()) criarLink()
                        }}
                      />
                    </Field>
                    <Button className="gap-1.5" disabled={busyKey === "novoLink" || !novoLink.trim()} onClick={criarLink}>
                      <IconPlus className="size-4" />
                      {busyKey === "novoLink" ? t("com.criandoLink") : t("com.criarLink")}
                    </Button>
                  </div>

                  <div className="flex flex-col gap-3">
                    {ativos.map((l) => (
                      <LinhaDoLink
                        key={l.id}
                        link={l}
                        t={t}
                        onRename={renomearLink}
                        onArchive={arquivarLink}
                        busy={busyKey !== null}
                      />
                    ))}
                  </div>

                  {arquivados.length > 0 && (
                    <div className="flex flex-col gap-3">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="w-fit"
                        onClick={() => setMostrarArquivados((v) => !v)}
                      >
                        {mostrarArquivados
                          ? t("com.esconderArquivados")
                          : t("com.verArquivados", { n: arquivados.length })}
                      </Button>
                      {mostrarArquivados && (
                        <>
                          <p className="text-xs text-muted-foreground">{t("com.linkArquivadoExplica")}</p>
                          {arquivados.map((l) => (
                            <LinhaDoLink
                              key={l.id}
                              link={l}
                              t={t}
                              onRename={renomearLink}
                              onArchive={arquivarLink}
                              busy={busyKey !== null}
                            />
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---------------- Indicações ---------------- */}
            <TabsContent value="indicacoes" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <StatCard label={t("com.indicacoes")} value={dados.referralCount} icon={<IconUsers />} />
                <StatCard label={t("com.assinaturasAtivas")} value={dados.subscriptions.active} icon={<IconUserCheck />} />
                <StatCard label={t("com.assinaturasCanceladas")} value={dados.subscriptions.canceled} icon={<IconUserOff />} />
                <StatCard label={t("com.semPlanoIndicados")} value={dados.subscriptions.withoutPlan} icon={<IconUsers />} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("com.ultimasIndicacoes")}</CardTitle>
                </CardHeader>
                <CardContent>
                  {dados.recentReferrals.length === 0 ? (
                    <p className="text-sm text-muted-foreground">{t("com.nenhumaIndicacaoAinda")}</p>
                  ) : (
                    <div className="overflow-x-auto">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead>{t("tabela.cliente")}</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>{t("com.plano")}</TableHead>
                            <TableHead>{t("com.origemDoCadastro")}</TableHead>
                            <TableHead>{t("adm.cadastradoEm")}</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {dados.recentReferrals.map((r) => {
                            const st = STATUS_INDICADO[r.subscriptionStatus ?? "sem_plano"] ?? STATUS_INDICADO.sem_plano
                            return (
                              <TableRow key={r.id}>
                                <TableCell className="font-medium">{r.businessName || r.email}</TableCell>
                                <TableCell>
                                  <TonePill tone={st.tone}>{t(st.label)}</TonePill>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{r.planName ?? "—"}</TableCell>
                                <TableCell className="text-muted-foreground">
                                  {r.linkLabel ?? t("com.linkPrincipal")}
                                </TableCell>
                                <TableCell className="whitespace-nowrap text-muted-foreground">
                                  {formatarData(r.createdAt)}
                                </TableCell>
                              </TableRow>
                            )
                          })}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* ---------------- Saque ---------------- */}
            <TabsContent value="saque" className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-3">
                <StatCard label={t("com.saldoDisponivel")} value={formatCents(dados.balance.availableCents)} icon={<IconWallet />} />
                <StatCard label={t("com.comissaoTotal")} value={formatCents(dados.balance.totalEarnedCents)} icon={<IconCoins />} />
                <StatCard label={t("com.mrrPrevisto")} value={formatCents(dados.subscriptions.mrrCents)} icon={<IconTrendingUp />} />
              </div>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("com.saqueTitulo")}</CardTitle>
                  <CardDescription>{t("com.saqueDescricao")}</CardDescription>
                </CardHeader>
                <CardContent className="flex flex-col gap-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field>
                      <FieldLabel htmlFor="pixType">{t("com.tipoChavePix")}</FieldLabel>
                      <Select value={pixTypeDraft || undefined} onValueChange={(v) => setPixTypeDraft(v as PixKeyType)}>
                        <SelectTrigger id="pixType" size="sm">
                          <SelectValue placeholder={t("com.escolhaTipo")} />
                        </SelectTrigger>
                        <SelectContent>
                          {PIX_TYPES.map((p) => (
                            <SelectItem key={p.value} value={p.value}>
                              {t(p.label)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="pixKey">{t("com.chavePix")}</FieldLabel>
                      <Input id="pixKey" value={pixKeyDraft} onChange={(e) => setPixKeyDraft(e.target.value)} />
                    </Field>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busyKey === "pix" || !pixKeyDraft || !pixTypeDraft}
                      onClick={savePixKey}
                    >
                      {t("com.salvarChavePix")}
                    </Button>

                    {podeSacar ? (
                      <Button size="sm" disabled={busyKey === "saque" || !dados.pix.key} onClick={requestWithdrawal}>
                        {busyKey === "saque" ? t("com.solicitandoSaque") : t("com.solicitarSaque")}
                      </Button>
                    ) : (
                      <TonePill tone="neutral">
                        {t("com.faltamParaSaque", {
                          valor: formatCents(faltamCents),
                          minimo: formatCents(dados.minWithdrawCents),
                        })}
                      </TonePill>
                    )}
                  </div>
                  {podeSacar && !dados.pix.key && (
                    <p className="text-xs text-muted-foreground">{t("com.cadastreChaveAntes")}</p>
                  )}

                  <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
                    <p className="text-xs font-medium text-muted-foreground">{t("com.ultimosSaques")}</p>
                    {dados.recentWithdrawals.length === 0 ? (
                      <p className="text-sm text-muted-foreground">{t("com.nenhumSaqueAinda")}</p>
                    ) : (
                      dados.recentWithdrawals.map((w) => (
                        <div key={w.id} className="flex items-center justify-between text-sm">
                          <span className="text-muted-foreground">{formatarData(w.requestedAt)}</span>
                          <span className="tabular-nums">{formatCents(w.amountCents)}</span>
                          <TonePill tone={WITHDRAWAL_TONE[w.status]}>{t(WITHDRAWAL_LABEL[w.status])}</TonePill>
                        </div>
                      ))
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </>
      )}
    </DashboardLayout>
  )
}
