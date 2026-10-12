import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
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
import { ReguaDoDia } from "@/components/redes/ReguaDoDia"
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
  limite: "Seu plano não permite mais contas nessa rede. Para conectar mais, troque de plano em Plano e uso.",
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
    ver: p.get("ver"),
  }
}

type Filtro = Rede | "todas"

/** Limite do plano nas redes (Instagram, Facebook...): vale pra CADA rede. O TikTok tem o limite próprio. */
type LimitesDasRedes = { semPlano: boolean; contasPorRede: number | null; plano: string | null }

/** Quantas contas ainda cabem nesta rede (null = sem limite; TikTok: o servidor decide na volta). */
function vagasNaRede(rede: Rede, limites: LimitesDasRedes | null, jaTem: number): number | null {
  if (rede === "tiktok" || !limites) return null
  if (limites.semPlano) return 0
  if (limites.contasPorRede === null) return null
  return Math.max(0, limites.contasPorRede - jaTem)
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
  const [limites, setLimites] = useState<LimitesDasRedes | null>(null)
  const [canais, setCanais] = useState<CanalDestino[] | null>(null)
  const [selecionada, setSelecionada] = useState<string | null>(inicial.conta)
  const [conectar, setConectar] = useState<Rede | null>(null)
  const [escolhendoRede, setEscolhendoRede] = useState(false)
  // Filtro por rede. Voltando de conectar uma rede, abre direto nela.
  const [filtro, setFiltro] = useState<Filtro>(() => {
    if (inicial.ver && inicial.ver in REDES) return inicial.ver as Rede
    if (inicial.conectada && inicial.rede) return inicial.rede
    if (inicial.tiktokConectada) return "tiktok"
    return "todas"
  })
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
      api.get<{ disponivel: boolean; contas: ContaSocial[]; limites?: LimitesDasRedes }>("/api/client/social-accounts"),
      api.get<{ canais: CanalDestino[] }>("/api/client/social-accounts/canais"),
    ])
    setTiktok(tk.accounts.map((a) => ({ ...a, id: Number(a.id) })))
    setSociais(s.contas)
    setDisponivel(s.disponivel)
    setLimites(s.limites ?? null)
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

  // As contas que aparecem com o filtro atual.
  const visiveis = useMemo(() => (contas ? (filtro === "todas" ? contas : contas.filter((c) => c.rede === filtro)) : null), [contas, filtro])

  // Filtro numa rede sem conta (ela foi desconectada): volta pra "todas".
  useEffect(() => {
    if (contas && filtro !== "todas" && !contas.some((c) => c.rede === filtro)) setFiltro("todas")
  }, [contas, filtro])

  // Sem seleção válida no filtro atual: a última da rede que acabou de
  // conectar, senão a primeira que aparece.
  useEffect(() => {
    if (!visiveis || visiveis.length === 0) return
    if (selecionada && visiveis.some((c) => c.chave === selecionada)) return
    const daRede = inicial.rede ? [...visiveis].reverse().find((c) => c.rede === inicial.rede) : null
    setSelecionada((daRede ?? visiveis[0]).chave)
  }, [visiveis, selecionada, inicial.rede])

  useEffect(() => {
    const q = new URLSearchParams()
    if (filtro !== "todas") q.set("ver", filtro)
    if (selecionada) q.set("conta", selecionada)
    const qs = q.toString()
    window.history.replaceState(null, "", `/client/social${qs ? `?${qs}` : ""}`)
  }, [selecionada, filtro])

  if (authLoading || !user) return null

  const conta = contas?.find((c) => c.chave === selecionada) ?? null
  const porRede = (r: Rede) => contas?.filter((c) => c.rede === r).length ?? 0
  const naFila =
    (tiktok?.reduce((s, a) => s + a.pendingCount, 0) ?? 0) + (sociais?.reduce((s, a) => s + a.fila.naFila, 0) ?? 0)

  return (
    <DashboardLayout user={user} onLogout={logout} title="Redes sociais">
      <header className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
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
        <Button onClick={() => setEscolhendoRede(true)} className="gap-1.5">
          <IconPlus className="size-4" />
          Conectar rede
        </Button>
      </header>

      {contas && contas.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <FiltroDeRedes
            contas={contas}
            filtro={filtro}
            onFiltro={(f) => {
              setFiltro(f)
              setSelecionada(null)
            }}
          />
          {filtro !== "todas" && (
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" onClick={() => setConectar(filtro)}>
              <IconPlus className="size-3.5" />
              Conectar outra conta do {REDES[filtro].nome}
            </Button>
          )}
        </div>
      )}

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
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Skeleton className="h-32 rounded-xl" />
            <Skeleton className="h-32 rounded-xl" />
          </div>
          <Skeleton className="h-96 rounded-xl" />
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
        <>
          {/* As contas: em "Todas", uma linha por rede; numa rede, só as dela. */}
          <div className="flex flex-col gap-5">
            {(filtro === "todas" ? ORDEM_DAS_REDES.filter((r) => contas.some((c) => c.rede === r)) : [filtro]).map((r) => {
              const daRede = contas.filter((c) => c.rede === r)
              return (
                <section key={r} aria-label={`Contas do ${REDES[r].nome}`} className="flex flex-col gap-2.5">
                  {filtro === "todas" && <RotuloDaRede rede={r} contas={daRede} />}
                  <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-1 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 xl:grid-cols-4">
                    {daRede.map((c) => (
                      <CartaoDaConta key={c.chave} conta={c} ativa={c.chave === selecionada} onClick={() => setSelecionada(c.chave)} />
                    ))}
                  </div>
                </section>
              )
            })}
          </div>

          {conta && (
            <section aria-label={`Conta ${conta.nome}`} className="flex min-w-0 flex-col gap-4">
              <PainelDaConta
                conta={conta}
                disponivel={disponivel}
                onMudou={load}
                onErro={(texto) => setAviso({ tipo: "erro", texto })}
                onDesconectada={async () => {
                  setSelecionada(null)
                  await load()
                }}
              />
              {conta.rede === "tiktok" ? (
                <EspacoDoTiktok key={conta.chave} conta={conta.tiktok} onMudou={load} onAplicarEmTodas={() => setAplicarDe(conta)} />
              ) : (
                <PainelDaContaSocial key={conta.chave} conta={conta.social} canais={canais} onMudou={load} onAplicarEmTodas={() => setAplicarDe(conta)} />
              )}
            </section>
          )}
        </>
      )}

      <EscolherRedeDialog
        aberto={escolhendoRede}
        porRede={porRede}
        limites={limites}
        onFechar={() => setEscolhendoRede(false)}
        onEscolher={(r) => {
          setEscolhendoRede(false)
          setConectar(r)
        }}
      />
      <ConectarRedeDialog
        rede={conectar}
        jaTem={conectar ? porRede(conectar) : 0}
        limites={limites}
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

/**
 * Filtro por rede, no mesmo desenho dos outros filtros do painel (trilho
 * cinza, escolhido em branco). Antes as pílulas do topo pareciam filtro mas
 * abriam "conectar outra conta" - aqui filtrar é filtrar.
 */
function FiltroDeRedes({ contas, filtro, onFiltro }: { contas: Conta[]; filtro: Filtro; onFiltro: (f: Filtro) => void }) {
  const redes = ORDEM_DAS_REDES.filter((r) => contas.some((c) => c.rede === r))
  // No celular o trilho rola de lado: a opção escolhida fica sempre à vista.
  const trilho = useRef<HTMLDivElement>(null)
  useEffect(() => {
    trilho.current?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }, [filtro])
  const opcao = (f: Filtro, rotulo: ReactNode, n: number) => (
    <button
      key={f}
      type="button"
      role="tab"
      aria-selected={filtro === f}
      onClick={() => onFiltro(f)}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-lg px-3 py-1.5 text-[13px] transition-colors",
        filtro === f ? "bg-card font-medium text-foreground shadow-[var(--shadow-flat)]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {rotulo}
      <span className="tabular-nums text-muted-foreground">{n}</span>
    </button>
  )
  return (
    <div ref={trilho} role="tablist" aria-label="Filtrar por rede" className="flex max-w-full gap-1 overflow-x-auto rounded-xl bg-muted/80 p-1 dark:bg-muted/50">
      {opcao("todas", "Todas", contas.length)}
      {redes.map((r) => {
        const { nome, Icone, fundo } = REDES[r]
        return opcao(
          r,
          <>
            <span className="flex size-5 items-center justify-center rounded-full text-white" style={{ background: fundo }}>
              <Icone className="size-3" />
            </span>
            {nome}
          </>,
          contas.filter((c) => c.rede === r).length,
        )
      })}
    </div>
  )
}

/** Em "Todas": o nome da rede em cima das contas dela. */
function RotuloDaRede({ rede, contas }: { rede: Rede; contas: Conta[] }) {
  const info = REDES[rede]
  const naFila = contas.reduce((s, c) => s + resumoDaConta(c).naFila, 0)
  return (
    <div className="flex items-center gap-2">
      <span className="flex size-6 items-center justify-center rounded-md text-white" style={{ background: info.fundo }}>
        <info.Icone className="size-3.5" />
      </span>
      <h2 className="text-sm font-semibold">{info.nome}</h2>
      <span className="text-xs text-muted-foreground">
        {contas.length} {contas.length === 1 ? "conta" : "contas"} · {naFila} na fila
      </span>
    </div>
  )
}

/** "Conectar rede": todas as redes, com quantas contas cada uma já tem. */
function EscolherRedeDialog({
  aberto,
  porRede,
  limites,
  onFechar,
  onEscolher,
}: {
  aberto: boolean
  porRede: (r: Rede) => number
  limites: LimitesDasRedes | null
  onFechar: () => void
  onEscolher: (r: Rede) => void
}) {
  const porRedeNoPlano = limites && !limites.semPlano ? limites.contasPorRede : null
  return (
    <Dialog open={aberto} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Conectar uma rede</DialogTitle>
          <DialogDescription>
            Cada conta conectada ganha a própria fila e os próprios horários.
            {porRedeNoPlano !== null &&
              ` Seu plano${limites?.plano ? ` ${limites.plano}` : ""} permite ${porRedeNoPlano} ${porRedeNoPlano === 1 ? "conta" : "contas"} em cada rede.`}
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {ORDEM_DAS_REDES.map((r) => {
            const { nome, Icone, fundo, formato } = REDES[r]
            const n = porRede(r)
            const vagas = vagasNaRede(r, limites, n)
            const cheia = vagas === 0
            return (
              <button
                key={r}
                type="button"
                onClick={() => onEscolher(r)}
                className="flex items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white" style={{ background: fundo }}>
                  <Icone className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{nome}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {cheia
                      ? limites?.semPlano
                        ? "Precisa de um plano"
                        : `${n} de ${limites?.contasPorRede} no seu plano`
                      : n > 0
                        ? `${n} ${n === 1 ? "conta conectada" : "contas conectadas"}${vagas !== null ? ` de ${n + vagas}` : ""}`
                        : formato}
                  </span>
                </span>
                {cheia ? (
                  <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">Cheia</span>
                ) : n > 0 ? (
                  <IconCheck className="size-4 shrink-0 text-status-posted" />
                ) : (
                  <IconPlus className="size-4 shrink-0 text-muted-foreground" />
                )}
              </button>
            )
          })}
        </div>
      </DialogContent>
    </Dialog>
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
    parada: f.pausada || !f.publicaSozinho || c.social.precisaReconectar === true || c.social.foraDoPlano === true,
    motivo: c.social.foraDoPlano
      ? "fora do plano"
      : c.social.precisaReconectar
      ? "precisa reconectar"
      : f.pausada
        ? "fila pausada"
        : !f.publicaSozinho
          ? "publicação automática desligada"
          : null,
  }
}

/** O estado da conta em palavras, com a cor do que significa. */
function estadoDaConta(c: Conta): { texto: string; tom: "ok" | "atencao" | "erro" } {
  const r = resumoDaConta(c)
  if (r.motivo === "fora do plano") return { texto: "Fora do seu plano", tom: "erro" }
  if (r.motivo === "precisa reconectar") return { texto: "Precisa reconectar", tom: "erro" }
  if (r.motivo === "fila pausada") return { texto: "Fila pausada", tom: "atencao" }
  if (r.motivo) return { texto: "Não publica sozinha", tom: "atencao" }
  return { texto: "Publicando sozinha", tom: "ok" }
}

const COR_DO_TOM = { ok: "bg-status-posted", atencao: "bg-amber-500", erro: "bg-destructive" } as const
const TEXTO_DO_TOM = { ok: "text-tone-success-ink", atencao: "text-amber-700 dark:text-amber-400", erro: "text-tone-danger-ink" } as const

function CartaoDaConta({ conta, ativa, onClick }: { conta: Conta; ativa: boolean; onClick: () => void }) {
  const r = resumoDaConta(conta)
  const e = estadoDaConta(conta)
  const info = REDES[conta.rede]
  const usuario = conta.rede === "tiktok" ? null : conta.social.username
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={ativa ? "true" : undefined}
      className={cn(
        "relative flex w-[16.5rem] shrink-0 snap-start flex-col overflow-hidden rounded-xl bg-card text-left shadow-[var(--shadow-flat)] transition-shadow hover:shadow-[var(--shadow-raised)] sm:w-auto dark:border dark:border-border",
      )}
      style={ativa ? { boxShadow: `0 0 0 2px ${info.cor}, var(--shadow-raised)` } : undefined}
    >
      <span className="flex items-center gap-3 px-3.5 pt-3.5">
        <AvatarDaConta conta={conta} tamanho="size-11" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold">{conta.nome}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {usuario && conta.rede !== "facebook" ? `@${usuario.replace(/^@/, "")} · ` : ""}
            {info.nome}
          </span>
        </span>
      </span>
      <span className={cn("mt-2.5 flex items-center gap-1.5 px-3.5 text-xs font-medium", TEXTO_DO_TOM[e.tom])}>
        <span className={cn("size-1.5 rounded-full", COR_DO_TOM[e.tom])} />
        {e.texto}
      </span>
      <span className="mt-3 flex items-center justify-between gap-2 border-t border-border/70 px-3.5 py-2.5 text-xs">
        <span>
          <span className="font-semibold tabular-nums">{r.naFila}</span> <span className="text-muted-foreground">na fila</span>
          {r.erros > 0 && <span className="text-tone-danger-ink"> · {r.erros} com erro</span>}
        </span>
        <span className="truncate text-muted-foreground">{r.proxima ? `Próximo ${quando(r.proxima).toLowerCase()}` : "Fila vazia"}</span>
      </span>
    </button>
  )
}

/**
 * O topo da conta escolhida: quem é, os números que importam e a conexão.
 * A fila e as configurações vêm logo abaixo (EspacoDoTiktok / PainelDaContaSocial).
 */
function PainelDaConta({
  conta,
  disponivel,
  onMudou,
  onErro,
  onDesconectada,
}: {
  conta: Conta
  disponivel: boolean
  onMudou: () => Promise<void>
  onErro: (texto: string) => void
  onDesconectada: () => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  const [saindo, setSaindo] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const info = REDES[conta.rede]
  const r = resumoDaConta(conta)
  const e = estadoDaConta(conta)
  const usuario = conta.rede === "tiktok" ? null : conta.social.username
  const desde = conta.rede === "tiktok" ? conta.tiktok.connectedAt : conta.social.connectedAt
  const publicados = conta.rede === "tiktok" ? conta.tiktok.postedCount : conta.social.fila.publicados

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

  const numeros: { rotulo: string; valor: ReactNode; destaque?: boolean }[] = [
    { rotulo: "Na fila", valor: r.naFila },
    { rotulo: "Próximo corte", valor: r.proxima ? quando(r.proxima) : "—" },
    { rotulo: "Publicados", valor: publicados },
    { rotulo: "Não saíram", valor: r.erros, destaque: r.erros > 0 },
  ]

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <div className="px-5 pt-5 pb-4" style={{ background: `linear-gradient(180deg, ${info.cor}12, transparent 85%)` }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          <AvatarDaConta conta={conta} tamanho="size-11 sm:size-14" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">{conta.nome}</h2>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {usuario && conta.rede !== "facebook" ? `@${usuario.replace(/^@/, "")} · ` : ""}
              {info.nome} · {info.formato} · desde {data(desde)}
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
            <Button size="sm" variant="ghost" className="gap-1.5 text-muted-foreground" onClick={() => setConfirmando(true)} aria-label={`Desconectar ${conta.nome}`}>
              <IconTrash className="size-3.5" />
              <span className="hidden sm:inline">Desconectar</span>
            </Button>
          )}
        </div>

        <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
          {numeros.map((n) => (
            <div key={n.rotulo} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{n.rotulo}</dt>
              <dd className={cn("mt-0.5 truncate text-lg font-semibold tabular-nums tracking-[-0.01em]", n.destaque && "text-tone-danger-ink")}>{n.valor}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="flex flex-col gap-2 border-t border-border/70 px-5 py-3">
        <p className={cn("flex items-center gap-1.5 text-sm font-medium", TEXTO_DO_TOM[e.tom])}>
          <span className={cn("size-2 rounded-full", COR_DO_TOM[e.tom])} />
          {e.tom === "ok"
            ? "Publicando sozinha nos horários da fila"
            : r.motivo === "fila pausada"
              ? "Fila pausada: nada sai até você retomar"
              : r.motivo === "fora do plano"
                ? `Fila parada: seu plano permite menos contas do ${info.nome}. Desconecte outra conta desta rede ou troque de plano em Plano e uso.`
              : e.tom === "erro"
                ? "A rede cancelou o acesso a esta conta"
                : conta.rede === "tiktok"
                  ? "Não publica sozinha: ligue “Postar automaticamente” logo abaixo"
                  : "Não publica sozinha: ligue “Publicar sozinho” logo abaixo"}
        </p>
        {conta.rede !== "tiktok" && (
          <SaudeDaConta key={`saude-${conta.chave}`} conta={conta.social} disponivel={disponivel} onMudou={onMudou} onErro={onErro} />
        )}
      </div>
    </Card>
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
      // `reconectar`: é a MESMA conta voltando, não conta nova - não passa pelo
      // limite de contas por rede do plano.
      const { url } = await api.post<{ url: string }>(`/api/client/social-accounts/${conta.network}/conectar`, { reconectar: conta.id })
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
        {/* "Não publica sozinha" já está no topo da conta; aqui fica só o caso
            que ele não cobre: publicação direta sem as opções escolhidas. */}
        {faltaOpcoes && conta.autoPostEnabled && (
          <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
            <span>
              <strong>{t("pub.avisoNadaSeraPublicado")}</strong> {t("pub.avisoConfigureOpcoes")}
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
  limites,
  disponivel,
  onFechar,
  onErro,
}: {
  rede: Rede | null
  jaTem: number
  limites: LimitesDasRedes | null
  disponivel: boolean
  onFechar: () => void
  onErro: (texto: string) => void
}) {
  const [indo, setIndo] = useState(false)
  useEffect(() => setIndo(false), [rede])
  if (!rede) return null
  const info = REDES[rede]
  const vagas = vagasNaRede(rede, limites, jaTem)
  // Rede cheia: nem abre a autorização (o servidor recusaria de qualquer jeito,
  // mas depois de a pessoa já ter passado pela tela da rede).
  const cheia = vagas === 0

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
        {cheia && (
          <p className="mx-6 mt-4 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-300">
            {limites?.semPlano
              ? `Assine um plano para conectar o ${info.nome}.`
              : `Seu plano${limites?.plano ? ` ${limites.plano}` : ""} permite ${limites?.contasPorRede} ${limites?.contasPorRede === 1 ? "conta" : "contas"} do ${info.nome}, e você já ${jaTem === 1 ? "tem 1" : `tem ${jaTem}`}. Para conectar mais, troque de plano.`}
          </p>
        )}
        <DialogFooter className="px-6 pb-6 pt-4">
          <Button variant="ghost" onClick={onFechar}>
            Agora não
          </Button>
          {cheia ? (
            <Button asChild>
              <a href="/client/billing">Ver planos</a>
            </Button>
          ) : (
            <Button onClick={conectar} disabled={indo || (rede !== "tiktok" && !disponivel)} className="border-0 text-white hover:opacity-90" style={{ background: info.fundo }}>
              {indo ? "Abrindo..." : `Conectar ${info.nome}`}
            </Button>
          )}
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

