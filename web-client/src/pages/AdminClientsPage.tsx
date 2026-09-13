import { useT } from "@/i18n"
import { data } from "@/lib/formatoLocal"
import { Fragment, useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { ChevronDown } from "lucide-react"
import type {
  AdminClient,
  AdminClientConnectionsResponse,
  AdminClientsResponse,
  DateRangeKey,
  OrdemDeCliente,
} from "@/types/api"

// Dólar com 2 casas some com custos pequenos: um cliente que gerou US$ 0,004
// apareceria como "US$ 0,00", indistinguível de quem não gerou nada. Abaixo de
// um centavo mostramos mais casas.
function dinheiro(usd: number) {
  if (usd === 0) return "US$ 0,00"
  const casas = usd < 0.01 ? 4 : 2
  return `US$ ${usd.toFixed(casas).replace(".", ",")}`
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

// Painel que abre embaixo da linha do cliente: o que ele acompanha no YouTube
// e onde isso é publicado no TikTok.
//
// A contagem "prontos fora da fila" tem destaque próprio de propósito: é o
// estado que faz um cliente escrever dizendo que "gerou os cortes e não postou
// nada", e ele não aparece em nenhuma outra contagem da tela.
function ConexoesDoCliente({ dados }: { dados?: AdminClientConnectionsResponse }) {
  const t = useT()
  if (!dados) return <Skeleton className="m-4 h-28" />

  return (
    // A tabela de clientes é larga e rola de lado. Sem prender o painel à área
    // visível, ele nasceria com a largura DELA - e metade do conteúdo ficaria
    // atrás de uma rolagem horizontal que ninguém adivinha que existe.
    <div className="sticky left-0 grid w-[calc(100vw-2rem)] max-w-full gap-6 p-4 md:w-auto md:grid-cols-2">
      <div className="min-w-0">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          {t("adm.canaisDoYoutube")}
        </div>
        {dados.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adm.nenhumCanalDoCliente")}</p>
        ) : (
          <ul className="space-y-2">
            {dados.channels.map((canal) => (
              <li key={canal.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{canal.name}</span>
                  {!canal.isActive && <TonePill tone="neutral">{t("adm.canalPausado")}</TonePill>}
                  {canal.lastCheckOk === false && <TonePill tone="danger">{t("adm.rotuloErro")}</TonePill>}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {canal.tiktokAccountName
                    ? `${t("adm.postaEm")} ${canal.tiktokAccountName}`
                    : t("adm.semContaVinculada")}
                </div>
                {canal.maxVideoMinutes != null && (
                  <div className="text-xs text-muted-foreground">
                    {t("adm.limiteDeDuracao", { min: String(canal.maxVideoMinutes) })}
                  </div>
                )}
                {canal.lastCheckAt && (
                  <div className="text-xs text-muted-foreground">
                    {t("adm.ultimaChecagem")}: {data(canal.lastCheckAt)}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-2 text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
          {t("pub.contaTikTok")}
        </div>
        {dados.tiktokAccounts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("adm.nenhumaContaDoCliente")}</p>
        ) : (
          <ul className="space-y-2">
            {dados.tiktokAccounts.map((conta) => (
              <li key={conta.id} className="rounded-md border border-border bg-background p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 truncate font-medium">{conta.displayName}</span>
                  <TonePill tone={conta.autoPostEnabled ? "success" : "neutral"}>
                    {conta.autoPostEnabled ? t("adm.postagemAutomaticaOn") : t("adm.postagemAutomaticaOff")}
                  </TonePill>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {conta.channelNames.length > 0 ? conta.channelNames.join(", ") : t("adm.semCanalVinculado")}
                </div>
                <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs">
                  <span className="text-muted-foreground">
                    <b className="text-foreground">{conta.pendingCount}</b> {t("adm.itensNaFila")}
                  </span>
                  <span className="text-muted-foreground">
                    <b className="text-foreground">{conta.postedCount}</b> {t("adm.postados")}
                  </span>
                  {conta.errorCount > 0 && (
                    <span className="text-tone-danger-ink">
                      <b>{conta.errorCount}</b> {t("adm.comErro")}
                    </span>
                  )}
                  {conta.readyOutOfQueueCount > 0 && (
                    <span className="text-tone-danger-ink">
                      <b>{conta.readyOutOfQueueCount}</b> {t("adm.prontosForaDaFila")}
                    </span>
                  )}
                  {conta.cancelledCount > 0 && (
                    <span className="text-muted-foreground">
                      <b className="text-foreground">{conta.cancelledCount}</b> {t("adm.cancelados")}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

export function AdminClientsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [search, setSearch] = useState("")
  const [range, setRange] = useState<DateRangeKey>("all")
  const [ordem, setOrdem] = useState<OrdemDeCliente>("recentes")
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())
  // Qual cliente está aberto, e o que já foi carregado dele. As conexões só
  // são buscadas quando alguém abre: são 2 consultas por cliente mais uma
  // contagem por conta do TikTok, e trazer isso para a lista inteira faria a
  // tela demorar para todo mundo por causa de uma pergunta que se faz sobre
  // um cliente de cada vez.
  const [aberto, setAberto] = useState<number | null>(null)
  const [conexoes, setConexoes] = useState<Record<number, AdminClientConnectionsResponse>>({})

  function abrirOuFechar(id: number) {
    setAberto((atual) => (atual === id ? null : id))
    if (conexoes[id]) return
    api
      .get<AdminClientConnectionsResponse>(`/api/admin/clients/${id}/connections`)
      .then((d) => setConexoes((c) => ({ ...c, [id]: d })))
  }

  useEffect(() => {
    if (!user) return
    setClients(null)
    const params = new URLSearchParams({ range, ordem })
    if (range === "custom") {
      params.set("since", de)
      params.set("until", ate)
    }
    api.get<AdminClientsResponse>(`/api/admin/clients?${params}`).then((data) => setClients(data.clients))
  }, [user, range, ordem, de, ate])

  if (authLoading || !user) return null

  const filtered = clients?.filter((c) => {
    const q = search.toLowerCase()
    return (c.businessName ?? "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.clientes")}>
      <p className="text-sm text-muted-foreground">{t("adm.clientesDescricao")}</p>

      {/* Os filtros ficam numa faixa que quebra linha: no celular eles descem
          um sob o outro em vez de espremer ou empurrar a página de lado. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {t("adm.custoNoPeriodo")}
          </span>
          <DateRangeFilter value={range} onChange={setRange} extras={["all", "custom"]} />
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">{t("comum.ate")}</span>
            <Input type="date" value={ate} min={de} max={hoje()} onChange={(e) => setAte(e.target.value)} className="w-auto" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemDeCliente)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recentes">{t("adm.ordemRecentes")}</SelectItem>
              <SelectItem value="antigos">{t("adm.ordemAntigos")}</SelectItem>
              <SelectItem value="maior_custo">{t("adm.ordemMaiorCusto")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={t("adm.buscarCliente")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-60"
          />
        </div>
      </div>

      {!clients ? (
        <Skeleton className="h-64" />
      ) : filtered && filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {clients.length === 0
            ? t("adm.nenhumClienteCadastradoLongo")
            : t("adm.nenhumClienteEncontrado")}
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {/* Plano, custo e postados vêm logo depois do nome: são o
                    que se vem procurar aqui, e numa tabela larga a última
                    coluna fica fora da tela até alguém rolar de lado. */}
                <TableHead>{t("tabela.cliente")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right whitespace-nowrap">{t("adm.custoGerado")}</TableHead>
                <TableHead className="text-center whitespace-nowrap">{t("adm.cortesPostados")}</TableHead>
                <TableHead>{t("pub.contaTikTok")}</TableHead>
                <TableHead className="text-center">{t("adm.canaisDoYoutube")}</TableHead>
                <TableHead>{t("adm.cadastradoEm")}</TableHead>
                <TableHead>{t("adm.origem")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered?.map((c) => (
                <Fragment key={c.id}>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {/* A seta fica no nome, que é por onde se procura um
                          cliente - e não numa coluna própria no fim da
                          tabela, que no celular fica fora da tela. */}
                      <button
                        type="button"
                        onClick={() => abrirOuFechar(c.id)}
                        aria-expanded={aberto === c.id}
                        aria-label={t("adm.verConexoes")}
                        title={t("adm.verConexoes")}
                        className="flex items-center gap-3 text-left hover:opacity-80"
                      >
                        <ChevronDown
                          className={`size-4 shrink-0 text-muted-foreground transition-transform ${aberto === c.id ? "rotate-180" : ""}`}
                        />
                        <Avatar className="size-9">
                          <AvatarFallback>{initials(c.businessName || c.email)}</AvatarFallback>
                        </Avatar>
                        <div>
                          <div className="font-medium">{c.businessName || "—"}</div>
                          <div className="text-xs text-muted-foreground">{c.email}</div>
                        </div>
                      </button>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Plano primeiro: é o que o admin vem procurar aqui.
                          Sem assinatura ativa aparece "Free", não em branco. */}
                      <TonePill tone={c.plano.chave === "free" ? "neutral" : "success"}>
                        {c.plano.nome}
                      </TonePill>
                      {c.plano.status === "inadimplente" && (
                        <TonePill tone="danger">{t("adm.inadimplente")}</TonePill>
                      )}
                      {!c.isActive && <TonePill tone="neutral">Inativo</TonePill>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {dinheiro(c.custoUsd)}
                  </TableCell>
                  <TableCell className="text-center font-heading font-bold">
                    {c.clipsPosted}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        className={`size-1.5 rounded-full ${c.tiktokConnected ? "bg-status-posted" : "bg-muted-foreground/40"}`}
                      />
                      {c.tiktokConnected ? c.tiktokDisplayName : t("adm.naoConectado")}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <a href="/admin/queue" className="font-heading font-bold text-primary hover:underline">
                      {c.channelCount}
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {data(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.origin?.referrerName ? (
                      t("adm.indicadoPor", { nome: c.origin.referrerName })
                    ) : c.origin?.affiliateLinkLabel ? (
                      c.origin.affiliateLinkLabel
                    ) : c.origin?.utmSource ? (
                      c.origin.utmSource
                    ) : (
                      t("adm.origemDireta")
                    )}
                  </TableCell>

                </TableRow>
                {aberto === c.id && (
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={8} className="bg-muted/40 p-0">
                      <ConexoesDoCliente dados={conexoes[c.id]} />
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DashboardLayout>
  )
}
