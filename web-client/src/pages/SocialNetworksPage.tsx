import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { IconAlertTriangle, IconCheck, IconPlus, IconTrash } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { AccountDetailPanel } from "@/pages/TikTokAccountPage"
import { PainelDaContaSocial, quando, type CanalDestino, type ContaSocial } from "@/components/redes/PainelDaContaSocial"
import { MiniRegua, ReguaDoDia } from "@/components/redes/ReguaDoDia"
import { useAuth } from "@/hooks/useAuth"
import { useT } from "@/i18n"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { data } from "@/lib/formatoLocal"
import { ORDEM_DAS_REDES, REDES, type Rede } from "@/lib/redes"
import type { PostingQueueItem, PostingScheduleResponse, TikTokAccountSummary } from "@/types/api"

/**
 * Redes sociais: todas as contas onde os cortes saem, de todas as redes, numa
 * lista só - e, ao escolher uma, a fila dela com a "régua do dia" (quando cada
 * corte vai sair).
 *
 * Cada conta é identificada por "rede-id": os ids do TikTok e das outras redes
 * vêm de tabelas diferentes e se repetem.
 */
type Conta =
  | { chave: string; rede: "tiktok"; id: number; nome: string; avatar: string | null; tiktok: TikTokAccountSummary }
  | { chave: string; rede: Exclude<Rede, "tiktok">; id: number; nome: string; avatar: string | null; social: ContaSocial }

type Pagina = { id: string; name: string; username: string | null; pictureUrl: string | null; category: string | null }

const ERROS: Record<string, string> = {
  sessao: "A autorização demorou demais ou foi aberta em outra janela. Clique em conectar de novo.",
  cancelada: "A conexão foi cancelada antes de terminar.",
  conta: "Não conseguimos confirmar a conta que voltou da autorização. Tente conectar de novo.",
  outro_cliente: "Essa conta já está conectada a outro usuário do Post Flow.",
  servico: "O serviço de conexão não respondeu. Tente de novo em instantes.",
}

function lerUrl() {
  const p = new URLSearchParams(window.location.search)
  const rede = p.get("rede") as Rede | null
  return {
    conta: p.get("conta"),
    rede: rede && rede in REDES ? rede : null,
    tiktokConectada: p.get("tiktok_connected") === "1",
    tiktokErro: p.get("tiktok_error"),
    conectada: p.get("conectada") === "1",
    erro: p.get("erro"),
    motivo: p.get("motivo"),
    escolher: p.get("escolher") === "1",
  }
}

function SeloDaRede({ rede, className }: { rede: Rede; className?: string }) {
  const { Icone, fundo } = REDES[rede]
  return (
    <span className={cn("flex items-center justify-center rounded-full text-white ring-2 ring-card", className)} style={{ background: fundo }}>
      <Icone className="size-[60%]" />
    </span>
  )
}

function AvatarDaConta({ conta, tamanho = "size-10" }: { conta: Conta; tamanho?: string }) {
  return (
    <span className="relative shrink-0">
      <Avatar className={tamanho}>
        {conta.avatar && <AvatarImage src={conta.avatar} alt="" />}
        <AvatarFallback className="text-[11px]">{(conta.nome || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
      </Avatar>
      <SeloDaRede rede={conta.rede} className="absolute -bottom-1 -right-1 size-[18px]" />
    </span>
  )
}

export function SocialNetworksPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const inicial = useMemo(lerUrl, [])
  const [tiktok, setTiktok] = useState<TikTokAccountSummary[] | null>(null)
  const [sociais, setSociais] = useState<ContaSocial[] | null>(null)
  const [disponivel, setDisponivel] = useState(true)
  const [canais, setCanais] = useState<CanalDestino[] | null>(null)
  const [selecionada, setSelecionada] = useState<string | null>(inicial.conta)
  const [conectar, setConectar] = useState<Rede | null>(null)
  const [escolher, setEscolher] = useState(inicial.escolher)
  const [aplicarDe, setAplicarDe] = useState<Conta | null>(null)
  const [aviso, setAviso] = useState<{ tipo: "ok" | "erro"; texto: string } | null>(() => {
    if (inicial.tiktokErro) return { tipo: "erro", texto: `Não foi possível conectar o TikTok: ${inicial.tiktokErro}` }
    if (inicial.tiktokConectada) return { tipo: "ok", texto: "Conta do TikTok conectada." }
    if (inicial.erro)
      return { tipo: "erro", texto: `${ERROS[inicial.erro] ?? ERROS.servico}${inicial.motivo ? ` Mensagem recebida: "${inicial.motivo}".` : ""}` }
    if (inicial.conectada && inicial.rede) return { tipo: "ok", texto: `${REDES[inicial.rede].nome} conectado.` }
    return null
  })

  const load = useCallback(async () => {
    const [tk, s, c] = await Promise.all([
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
      api.get<{ disponivel: boolean; contas: ContaSocial[] }>("/api/client/social-accounts"),
      api.get<{ canais: CanalDestino[] }>("/api/client/social-accounts/canais"),
    ])
    setTiktok(tk.accounts.map((a) => ({ ...a, id: Number(a.id) })))
    setSociais(s.contas)
    setDisponivel(s.disponivel)
    setCanais(c.canais)
  }, [])

  useEffect(() => {
    if (user) void load()
  }, [user, load])

  const contas: Conta[] | null = useMemo(() => {
    if (!tiktok || !sociais) return null
    const lista: Conta[] = [
      ...tiktok.map((a) => ({ chave: `tiktok-${a.id}`, rede: "tiktok" as const, id: a.id, nome: a.displayName, avatar: a.avatarUrl, tiktok: a })),
      ...sociais.map((s) => ({ chave: `${s.network}-${s.id}`, rede: s.network, id: s.id, nome: s.displayName || s.username || "Conta", avatar: s.avatarUrl, social: s })),
    ]
    return lista.sort((a, b) => ORDEM_DAS_REDES.indexOf(a.rede) - ORDEM_DAS_REDES.indexOf(b.rede))
  }, [tiktok, sociais])

  // Sem seleção válida: a primeira da rede que acabou de conectar, senão a primeira.
  useEffect(() => {
    if (!contas || contas.length === 0) return
    if (selecionada && contas.some((c) => c.chave === selecionada)) return
    const daRede = inicial.rede ? [...contas].reverse().find((c) => c.rede === inicial.rede) : null
    setSelecionada((daRede ?? contas[0]).chave)
  }, [contas, selecionada, inicial.rede])

  useEffect(() => {
    window.history.replaceState(null, "", `/client/social${selecionada ? `?conta=${selecionada}` : ""}`)
  }, [selecionada])

  // No celular a lista é uma faixa que rola de lado: a conta aberta fica à vista.
  const faixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = faixa.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const ativo = el.querySelector<HTMLElement>('[aria-current="true"]')
    if (ativo) el.scrollTo({ left: ativo.offsetLeft - 16 })
  }, [selecionada, contas])

  if (authLoading || !user) return null

  const conta = contas?.find((c) => c.chave === selecionada) ?? null
  const porRede = (r: Rede) => contas?.filter((c) => c.rede === r).length ?? 0
  const naFila =
    (tiktok?.reduce((s, a) => s + a.pendingCount, 0) ?? 0) + (sociais?.reduce((s, a) => s + a.fila.naFila, 0) ?? 0)

  return (
    <DashboardLayout user={user} onLogout={logout} title="Redes sociais">
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-[1.65rem] font-semibold leading-tight tracking-[-0.03em]">Redes sociais</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {contas === null
              ? "Carregando suas contas…"
              : contas.length === 0
                ? "Conecte as redes onde os seus cortes vão ser publicados."
                : `${contas.length} ${contas.length === 1 ? "conta conectada" : "contas conectadas"} · ${naFila} ${naFila === 1 ? "corte na fila" : "cortes na fila"}`}
          </p>
        </div>
      </header>

      {/* As redes: as conectadas mostram quantas contas; as outras convidam. */}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
        {ORDEM_DAS_REDES.map((r) => {
          const n = porRede(r)
          const { nome, Icone, fundo } = REDES[r]
          return (
            <button
              key={r}
              type="button"
              onClick={() => setConectar(r)}
              className={cn(
                "group flex shrink-0 items-center gap-1.5 rounded-full border py-[3px] pl-[3px] pr-2.5 text-[13px] transition-colors",
                n > 0 ? "border-border bg-card shadow-[var(--shadow-flat)] hover:border-foreground/30" : "border-dashed border-border text-muted-foreground hover:border-foreground/40 hover:text-foreground",
              )}
            >
              <span className={cn("flex size-6 items-center justify-center rounded-full text-white", n === 0 && "opacity-60 grayscale group-hover:opacity-100 group-hover:grayscale-0")} style={{ background: fundo }}>
                <Icone className="size-3.5" />
              </span>
              <span className={cn(n > 0 && "font-medium")}>{nome}</span>
              {n > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground">{n}</span>
              ) : (
                <IconPlus className="size-3.5" />
              )}
            </button>
          )
        })}
      </div>

      {aviso && (
        <p
          className={cn(
            "rounded-md border px-3 py-2 text-sm",
            aviso.tipo === "ok" ? "border-status-posted/30 bg-status-posted/10 text-status-posted" : "border-destructive/30 bg-destructive/10 text-destructive",
          )}
        >
          {aviso.texto}
        </p>
      )}

      {!contas ? (
        <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <Skeleton className="h-72" />
          <Skeleton className="h-96" />
        </div>
      ) : contas.length === 0 ? (
        <Card className="items-center gap-0 px-6 py-14 text-center">
          <p className="font-medium">Nenhuma rede conectada</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">Comece pela rede onde você mais publica. Dá pra conectar quantas quiser, e cada uma tem a própria fila.</p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            {(["tiktok", "instagram", "youtube"] as Rede[]).map((r) => (
              <Button key={r} variant="outline" className="gap-1.5" onClick={() => setConectar(r)}>
                <SeloDaRede rede={r} className="size-5 ring-0" />
                {REDES[r].nome}
              </Button>
            ))}
          </div>
        </Card>
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
          <nav aria-label="Contas" className="min-w-0 lg:sticky lg:top-4">
            <div ref={faixa} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0 lg:pb-0">
              {contas.map((c) => (
                <LinhaDaConta key={c.chave} conta={c} ativa={c.chave === selecionada} onClick={() => setSelecionada(c.chave)} />
              ))}
            </div>
          </nav>

          <section className="flex min-w-0 flex-col gap-4">
            {conta && (
              <>
                <CabecalhoDaConta
                  conta={conta}
                  onDesconectada={async () => {
                    setSelecionada(null)
                    await load()
                  }}
                />
                {conta.rede !== "tiktok" && (
                  <SaudeDaConta key={`saude-${conta.chave}`} conta={conta.social} disponivel={disponivel} onMudou={load} onErro={(texto) => setAviso({ tipo: "erro", texto })} />
                )}
                {conta.rede === "tiktok" ? (
                  <EspacoDoTiktok key={conta.chave} conta={conta.tiktok} onMudou={load} onAplicarEmTodas={() => setAplicarDe(conta)} />
                ) : (
                  <PainelDaContaSocial key={conta.chave} conta={conta.social} canais={canais} onMudou={load} onAplicarEmTodas={() => setAplicarDe(conta)} />
                )}
              </>
            )}
          </section>
        </div>
      )}

      <ConectarRedeDialog
        rede={conectar}
        jaTem={conectar ? porRede(conectar) : 0}
        disponivel={disponivel}
        onFechar={() => setConectar(null)}
        onErro={(texto) => setAviso({ tipo: "erro", texto })}
      />
      <EscolherPaginaDialog
        aberto={escolher}
        onFechar={() => setEscolher(false)}
        onConectado={async (n, rede) => {
          setEscolher(false)
          setAviso({ tipo: "ok", texto: n === 1 ? "Conta conectada." : `${n} contas conectadas.` })
          await load()
          if (rede) setSelecionada(null)
        }}
      />
      <AplicarEmTodasDialog
        de={aplicarDe}
        total={contas?.length ?? 0}
        onFechar={() => setAplicarDe(null)}
        onAplicado={async (n) => {
          setAplicarDe(null)
          setAviso({ tipo: "ok", texto: `Horários copiados pra ${n} contas. As filas foram reorganizadas.` })
          await load()
        }}
      />
    </DashboardLayout>
  )
}

function resumoDaConta(c: Conta) {
  if (c.rede === "tiktok") {
    const a = c.tiktok
    return {
      naFila: a.pendingCount,
      erros: a.errorCount,
      proxima: a.nextInQueue?.scheduledFor ?? null,
      parada: !a.autoPostEnabled || a.paused === true,
      motivo: !a.autoPostEnabled ? "publicação automática desligada" : a.paused ? "fila pausada" : null,
    }
  }
  const f = c.social.fila
  return {
    naFila: f.naFila,
    erros: f.erros,
    proxima: f.proxima,
    parada: f.pausada || !f.publicaSozinho || c.social.precisaReconectar === true,
    motivo: c.social.precisaReconectar
      ? "precisa reconectar"
      : f.pausada
        ? "fila pausada"
        : !f.publicaSozinho
          ? "publicação automática desligada"
          : null,
  }
}

function LinhaDaConta({ conta, ativa, onClick }: { conta: Conta; ativa: boolean; onClick: () => void }) {
  const r = resumoDaConta(conta)
  const info = REDES[conta.rede]
  const horarios = conta.rede === "tiktok" ? (conta.tiktok.horarios ?? []) : conta.social.fila.horarios
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? "true" : undefined}
      className={cn(
        "relative flex w-[15.5rem] shrink-0 flex-col gap-2 overflow-hidden rounded-xl border px-3 py-2.5 text-left transition-colors lg:w-auto",
        ativa ? "bg-card shadow-[var(--shadow-raised)]" : "border-border bg-card/60 hover:bg-card lg:border-transparent lg:bg-transparent",
      )}
      style={ativa ? { borderColor: `${info.cor}55` } : undefined}
    >
      {ativa && <span aria-hidden className="absolute inset-y-2 left-0 w-[3px] rounded-r-full" style={{ background: info.cor }} />}
      <span className="flex items-center gap-3">
        <AvatarDaConta conta={conta} tamanho="size-9" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{conta.nome}</span>
          <span className="mt-0.5 block truncate font-mono text-[10.5px] text-muted-foreground">
            {r.motivo ? (
              <span className={r.motivo === "precisa reconectar" ? "font-semibold text-tone-danger-ink" : "text-amber-700 dark:text-amber-400"}>
                {r.motivo}
              </span>
            ) : r.proxima ? (
              <>próx. {quando(r.proxima).toLowerCase()}</>
            ) : (
              "fila vazia"
            )}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-0.5">
          <span className="font-mono text-sm font-semibold tabular-nums">{r.naFila}</span>
          {r.erros > 0 && <span className="font-mono text-[10px] text-tone-danger-ink">{r.erros} ✕</span>}
        </span>
      </span>
      {horarios.length > 0 && <MiniRegua horarios={horarios} cor={info.cor} apagada={r.parada} />}
    </button>
  )
}

function CabecalhoDaConta({ conta, onDesconectada }: { conta: Conta; onDesconectada: () => void }) {
  const [confirmando, setConfirmando] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const info = REDES[conta.rede]
  const usuario = conta.rede === "tiktok" ? null : conta.social.username
  const desde = conta.rede === "tiktok" ? conta.tiktok.connectedAt : conta.social.connectedAt

  useEffect(() => setConfirmando(false), [conta.chave])

  async function desconectar() {
    setSaindo(true)
    setErro(null)
    try {
      if (conta.rede === "tiktok") await api.post(`/api/client/tiktok-accounts/${conta.id}/deactivate`, {})
      else await api.delete(`/api/client/social-accounts/${conta.id}`)
      onDesconectada()
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível desconectar.")
      setSaindo(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
      <AvatarDaConta conta={conta} tamanho="size-14" />
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">{conta.nome}</h2>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {usuario && conta.rede !== "facebook" ? `@${usuario} · ` : ""}
          {info.nome} · {info.formato} · conectada em {data(desde)}
        </p>
        {erro && <p className="mt-1 text-xs text-destructive">{erro}</p>}
      </div>
      {confirmando ? (
        <div className="flex gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => setConfirmando(false)}>
            Manter
          </Button>
          <Button size="sm" variant="destructive" disabled={saindo} onClick={desconectar}>
            {saindo ? "Desconectando..." : "Desconectar"}
          </Button>
        </div>
      ) : (
        <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setConfirmando(true)}>
          <IconTrash className="size-3.5" />
          Desconectar
        </Button>
      )}
    </div>
  )
}

/**
 * O login da conta ainda vale? Em 09/10/2026 o Instagram cancelou a
 * autorização de uma conta e a tela continuou dizendo "conectada" - só se
 * descobriu na hora de publicar. Agora o sistema confere de 6 em 6 horas, e
 * aqui dá pra conferir na hora e reconectar sem precisar desconectar antes.
 */
function SaudeDaConta({
  conta,
  disponivel,
  onMudou,
  onErro,
}: {
  conta: ContaSocial
  disponivel: boolean
  onMudou: () => Promise<void>
  onErro: (texto: string) => void
}) {
  const [testando, setTestando] = useState(false)
  const [resultado, setResultado] = useState<"ok" | "reconectar" | "indefinido" | null>(null)
  const [indo, setIndo] = useState(false)
  const nome = REDES[conta.network].nome

  async function testar() {
    setTestando(true)
    setResultado(null)
    try {
      const r = await api.post<{ resultado: "ok" | "reconectar" | "indefinido" }>(`/api/client/social-accounts/${conta.id}/testar`, {})
      setResultado(r.resultado)
      await onMudou()
    } catch (err) {
      onErro(err instanceof ApiError ? err.message : "Não foi possível testar a conexão agora.")
    } finally {
      setTestando(false)
    }
  }

  async function reconectar() {
    setIndo(true)
    try {
      const { url } = await api.post<{ url: string }>(`/api/client/social-accounts/${conta.network}/conectar`, {})
      window.location.href = url
    } catch (err) {
      onErro(err instanceof ApiError ? err.message : "Não foi possível iniciar a reconexão.")
      setIndo(false)
    }
  }

  if (conta.precisaReconectar) {
    return (
      <div className="flex flex-col gap-3 rounded-xl border border-tone-danger-ink/30 bg-tone-danger-wash px-4 py-3 sm:flex-row sm:items-center">
        <IconAlertTriangle className="size-5 shrink-0 text-tone-danger-ink" />
        <div className="min-w-0 flex-1 text-sm">
          <p className="font-semibold text-tone-danger-ink">O {nome} cancelou o acesso a esta conta</p>
          <p className="mt-0.5 text-xs text-foreground/80">
            Acontece quando a senha é trocada ou a rede encerra as sessões por segurança. A fila desta conta está esperando: reconecte e os cortes
            voltam a sair nos horários.
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button size="sm" variant="ghost" disabled={testando} onClick={testar}>
            {testando ? "Testando..." : "Testar de novo"}
          </Button>
          <Button size="sm" disabled={indo || !disponivel} onClick={reconectar}>
            {indo ? "Abrindo..." : "Reconectar"}
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
      <span className="flex items-center gap-1.5">
        <span className="size-1.5 rounded-full bg-status-posted" />
        {resultado === "ok"
          ? "Conexão funcionando agora."
          : resultado === "indefinido"
            ? `O ${nome} não respondeu agora; a conexão não foi alterada.`
            : conta.conferidaEm
              ? `Conexão conferida em ${new Date(conta.conferidaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}`
              : "Conexão ainda não conferida"}
      </span>
      <button type="button" disabled={testando} onClick={testar} className="font-medium text-foreground underline underline-offset-2 disabled:opacity-60">
        {testando ? "Testando..." : "Testar conexão"}
      </button>
    </div>
  )
}

/** A conta do TikTok no layout novo: régua do dia + o painel de sempre. */
function EspacoDoTiktok({ conta, onMudou, onAplicarEmTodas }: { conta: TikTokAccountSummary; onMudou: () => Promise<void>; onAplicarEmTodas: () => void }) {
  const t = useT()
  const [horario, setHorario] = useState<PostingScheduleResponse | null>(null)
  const [fila, setFila] = useState<PostingQueueItem[]>([])
  const [corrigindo, setCorrigindo] = useState(false)
  const [avisoFila, setAvisoFila] = useState<string | null>(null)

  useEffect(() => {
    void api.get<PostingScheduleResponse>(`/api/client/tiktok-accounts/${conta.id}/schedule`).then(setHorario)
    void api.get<{ postings: PostingQueueItem[] }>(`/api/client/postings/queue?accountId=${conta.id}`).then((d) => setFila(d.postings))
  }, [conta.id, conta.pendingCount])

  const faltaOpcoes = conta.publishMode === "direct" && !conta.hasPublishDefaults
  const horarios = horario ? (horario.mode === "manual" && horario.manualTimes.length ? horario.manualTimes : horario.defaultTimes) : []

  return (
    <div className="flex flex-col gap-4">
      <Card className="gap-4 px-5 py-5">
        <ReguaDoDia
          horarios={horarios}
          cor={REDES.tiktok.cor}
          pausada={!conta.autoPostEnabled || horario?.paused}
          itens={fila.map((p) => ({ id: Number(p.id), horario: p.scheduledFor, capaUrl: p.thumbnailUrl, titulo: p.clipTitle }))}
        />
        {(faltaOpcoes || !conta.autoPostEnabled) && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              <strong>{faltaOpcoes ? t("pub.avisoNadaSeraPublicado") : t("pub.avisoNaoEstaPublicando")}</strong>{" "}
              {faltaOpcoes ? t("pub.avisoConfigureOpcoes") : t("pub.avisoLigueAutomatico")}
            </span>
          </p>
        )}
        {conta.readyOutOfQueueCount > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs">
            <span>{t("pub.prontosForaDaFila", { n: conta.readyOutOfQueueCount })}</span>
            <Button
              size="xs"
              variant="outline"
              disabled={corrigindo}
              onClick={async () => {
                setCorrigindo(true)
                try {
                  const r = await api.post<{ enfileirados?: number }>("/api/client/postings/enfileirar-prontos", { accountId: conta.id })
                  setAvisoFila(t("pub.cortesNaFila", { n: r.enfileirados ?? 0 }))
                  await onMudou()
                } finally {
                  setCorrigindo(false)
                }
              }}
            >
              Colocar na fila
            </Button>
          </div>
        )}
        {avisoFila && <p className="text-xs text-muted-foreground">{avisoFila}</p>}
        <div>
          <Button variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left" onClick={onAplicarEmTodas}>
            Usar estes horários em todas as contas
          </Button>
        </div>
      </Card>
      <AccountDetailPanel account={conta} onChanged={() => void onMudou()} />
    </div>
  )
}

/** O que a rede exige, e o botão de conectar. */
function ConectarRedeDialog({
  rede,
  jaTem,
  disponivel,
  onFechar,
  onErro,
}: {
  rede: Rede | null
  jaTem: number
  disponivel: boolean
  onFechar: () => void
  onErro: (texto: string) => void
}) {
  const [indo, setIndo] = useState(false)
  useEffect(() => setIndo(false), [rede])
  if (!rede) return null
  const info = REDES[rede]

  async function conectar() {
    if (rede === "tiktok") {
      window.location.href = "/auth/tiktok/connect?from=/client/social"
      return
    }
    setIndo(true)
    try {
      const { url } = await api.post<{ url: string }>(`/api/client/social-accounts/${rede}/conectar`, {})
      window.location.href = url
    } catch (err) {
      onErro(err instanceof ApiError ? err.message : "Não foi possível iniciar a conexão.")
      setIndo(false)
      onFechar()
    }
  }

  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <div className="flex items-center gap-3 px-6 pb-4 pt-6" style={{ background: `linear-gradient(180deg, ${info.cor}14, transparent)` }}>
          <span className="flex size-11 items-center justify-center rounded-xl text-white shadow-sm" style={{ background: info.fundo }}>
            <info.Icone className="size-6" />
          </span>
          <DialogHeader className="text-left">
            <DialogTitle>{jaTem > 0 ? `Conectar outra conta do ${info.nome}` : `Conectar ${info.nome}`}</DialogTitle>
            <DialogDescription>Os cortes saem como {info.formato}.</DialogDescription>
          </DialogHeader>
        </div>
        <dl className="divide-y divide-border border-y border-border">
          {info.exigencias.map((e) => (
            <div key={e.chave} className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-3 px-6 py-2.5">
              <dt className="pt-px text-xs text-muted-foreground">{e.chave}</dt>
              <dd className="min-w-0 text-sm">
                <span className="font-medium">{e.valor}</span>
                {e.detalhe && <span className="mt-0.5 block text-xs text-muted-foreground">{e.detalhe}</span>}
              </dd>
            </div>
          ))}
        </dl>
        {(info.comoPreparar || info.aviso) && (
          <div className="flex flex-col gap-2 px-6 py-4 text-xs text-muted-foreground">
            {info.aviso && (
              <p className="flex gap-2 text-amber-800 dark:text-amber-300">
                <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
                {info.aviso}
              </p>
            )}
            {info.comoPreparar && (
              <ol className="list-decimal pl-4">
                {info.comoPreparar.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ol>
            )}
          </div>
        )}
        <DialogFooter className="px-6 pb-6 pt-2">
          <Button variant="ghost" onClick={onFechar}>
            Agora não
          </Button>
          <Button onClick={conectar} disabled={indo || (rede !== "tiktok" && !disponivel)} className="border-0 text-white hover:opacity-90" style={{ background: info.fundo }}>
            {indo ? "Abrindo..." : `Conectar ${info.nome}`}
          </Button>
        </DialogFooter>
        {rede !== "tiktok" && !disponivel && <p className="px-6 pb-4 text-xs text-muted-foreground">A conexão com {info.nome} ainda não está disponível.</p>}
      </DialogContent>
    </Dialog>
  )
}

/** Segunda etapa do Facebook e do LinkedIn: um login traz várias Páginas/perfis, e a pessoa escolhe. */
function EscolherPaginaDialog({ aberto, onFechar, onConectado }: { aberto: boolean; onFechar: () => void; onConectado: (n: number, rede: Rede | null) => void }) {
  const [paginas, setPaginas] = useState<Pagina[] | null>(null)
  const [rede, setRede] = useState<Rede | null>(null)
  const [marcadas, setMarcadas] = useState<Set<string>>(new Set())
  const [erro, setErro] = useState<string | null>(null)
  const [enviando, setEnviando] = useState(false)

  useEffect(() => {
    if (!aberto) return
    api
      .get<{ rede: Rede; paginas: Pagina[] }>("/api/client/social-accounts/pendente")
      .then((d) => {
        setRede(d.rede)
        setPaginas(d.paginas)
        if (d.paginas.length === 1) setMarcadas(new Set([d.paginas[0].id]))
      })
      .catch((err) => setErro(err instanceof ApiError ? err.message : "Não foi possível listar as opções."))
  }, [aberto])

  async function confirmar() {
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.post<{ conectadas: number }>("/api/client/social-accounts/pendente", { pageIds: [...marcadas] })
      onConectado(r.conectadas, rede)
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível conectar.")
    } finally {
      setEnviando(false)
    }
  }

  const nomeDaRede = rede ? REDES[rede].nome : ""
  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{rede === "linkedin" ? "Onde publicar no LinkedIn?" : "Em quais Páginas publicar?"}</DialogTitle>
          <DialogDescription>
            {rede === "linkedin"
              ? "Escolha o seu perfil, as páginas de empresa que você administra, ou os dois."
              : `Estas são as Páginas que o seu perfil administra no ${nomeDaRede || "Facebook"}. Marque as que vão receber os cortes.`}
          </DialogDescription>
        </DialogHeader>
        {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}
        {!paginas && !erro && <Skeleton className="h-28" />}
        {paginas && paginas.length === 0 && <p className="text-sm text-muted-foreground">Nada encontrado nesta conta. Confira se você é administrador e conecte de novo.</p>}
        {paginas && paginas.length > 0 && (
          <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
            {paginas.map((p) => {
              const on = marcadas.has(p.id)
              return (
                <label key={p.id} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors", on ? "border-foreground bg-muted/40" : "border-border hover:bg-muted/30")}>
                  <Checkbox
                    checked={on}
                    onCheckedChange={(c) =>
                      setMarcadas((prev) => {
                        const n = new Set(prev)
                        if (c === true) n.add(p.id)
                        else n.delete(p.id)
                        return n
                      })
                    }
                  />
                  <Avatar className="size-8">
                    {p.pictureUrl && <AvatarImage src={p.pictureUrl} alt="" />}
                    <AvatarFallback className="text-[10px]">{p.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{p.name}</span>
                    {p.category && <span className="block truncate text-xs text-muted-foreground">{p.category}</span>}
                  </span>
                  {on && <IconCheck className="size-4 shrink-0" />}
                </label>
              )
            })}
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button onClick={confirmar} disabled={enviando || marcadas.size === 0}>
            {enviando ? "Conectando..." : marcadas.size > 1 ? `Conectar ${marcadas.size}` : "Conectar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function AplicarEmTodasDialog({
  de,
  total,
  onFechar,
  onAplicado,
}: {
  de: Conta | null
  total: number
  onFechar: () => void
  onAplicado: (n: number) => void
}) {
  const [indo, setIndo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  useEffect(() => {
    setErro(null)
    setIndo(false)
  }, [de])
  if (!de) return null
  return (
    <Dialog open onOpenChange={(a) => !a && onFechar()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Usar os horários de {de.nome} em todas as contas?</DialogTitle>
          <DialogDescription>
            As outras {total - 1} contas passam a publicar nos mesmos horários, na mesma quantidade por dia e com o mesmo “publicar sozinho”.
            As filas são reorganizadas pros horários novos. Opções próprias de cada rede (como a visibilidade do YouTube) não mudam.
          </DialogDescription>
        </DialogHeader>
        {erro && <p className="text-sm text-destructive">{erro}</p>}
        <DialogFooter>
          <Button variant="outline" onClick={onFechar}>
            Cancelar
          </Button>
          <Button
            disabled={indo}
            onClick={async () => {
              setIndo(true)
              try {
                const r = await api.post<{ contas: number }>("/api/client/social-accounts/aplicar-em-todas", {
                  origem: { rede: de.rede === "tiktok" ? "tiktok" : "social", id: de.id },
                })
                onAplicado(r.contas)
              } catch (err) {
                setErro(err instanceof ApiError ? err.message : "Não foi possível aplicar.")
                setIndo(false)
              }
            }}
          >
            {indo ? "Aplicando..." : "Usar em todas"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

