import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBrandTiktok,
  IconBrandYoutubeFilled,
  IconClockPause,
  IconLink,
  IconLoader2,
  IconMovie,
  IconPalette,
  IconPlus,
  IconRadar,
  IconScissors,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { MonitoramentoDoCanal } from "@/components/youtube/MonitoramentoDoCanal"
import type { CanalDestino, ContaSocial } from "@/components/redes/PainelDaContaSocial"
import { REDES } from "@/lib/redes"
import { UltimoVideoDialog, type PedidoDeUltimoVideo } from "@/components/youtube/UltimoVideoDialog"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { dataHora } from "@/lib/formatoLocal"
import { ACTIVE_STATUSES } from "@/lib/videoProgress"
import {
  AddManualVideoCard,
  PENDING_STATUSES,
  STAGE_PRIORITY,
  UploadVideoCard,
  VideoRow,
} from "@/pages/VideosClipsPage"
import type { ClientVideoSettingsResponse, DriveStatusResponse, LatestChannelVideo, SourceVideo, TikTokAccountSummary, YoutubeChannel } from "@/types/api"

// Vermelho do YouTube: a única cor de marca da tela, usada pra dizer "isto é
// sobre o YouTube" (ícone, aba ativa, canal selecionado). O resto da cor vem
// do estado de cada coisa (verde ligado, âmbar atenção, azul andando).
const YT = "#FF0033"

type Selecao = number | "avulsos"
type Aba = "videos" | "estilo" | "monitoramento"

function lerUrl(): { canal: Selecao | null; aba: Aba } {
  const p = new URLSearchParams(window.location.search)
  const canal = p.get("canal")
  const aba = p.get("aba")
  return {
    canal: canal === "avulsos" ? "avulsos" : canal && Number.isFinite(Number(canal)) ? Number(canal) : null,
    aba: aba === "estilo" || aba === "monitoramento" ? aba : "videos",
  }
}

// A seleção vai pra barra de endereço: recarregar a página (ou voltar de outra
// tela) cai no mesmo canal e na mesma aba, em vez de voltar pro primeiro.
function gravarUrl(canal: Selecao | null, aba: Aba) {
  const p = new URLSearchParams()
  if (canal !== null) p.set("canal", String(canal))
  if (aba !== "videos") p.set("aba", aba)
  const q = p.toString()
  window.history.replaceState(null, "", `/client/youtube${q ? `?${q}` : ""}`)
}

function iniciais(nome: string) {
  return nome.slice(0, 2).toUpperCase()
}

function handleDoCanal(url: string) {
  const m = url.match(/youtube\.com\/(@[^/?#]+|channel\/[^/?#]+|c\/[^/?#]+|user\/[^/?#]+)/i)
  return m ? m[1] : url.replace(/^https?:\/\/(www\.)?/, "")
}

/** Estado do canal em uma palavra, com a cor do sinal. */
function estadoDoCanal(c: YoutubeChannel): { rotulo: string; cor: string } {
  if (!c.isActive) return { rotulo: "pausado", cor: "bg-muted-foreground/50" }
  if (c.lastCheckOk === false) return { rotulo: "falhando", cor: "bg-status-processing" }
  return { rotulo: "monitorando", cor: "bg-status-posted" }
}

export function YoutubeVideosPage() {
  const { user, loading: authLoading, logout, mostrarTunel } = useAuth()
  const inicial = useMemo(lerUrl, [])
  const [channels, setChannels] = useState<YoutubeChannel[] | null>(null)
  const [videos, setVideos] = useState<SourceVideo[]>([])
  const [avgSeconds, setAvgSeconds] = useState(480)
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccountSummary[]>([])
  const [drive, setDrive] = useState<DriveStatusResponse | null>(null)
  const [selecao, setSelecao] = useState<Selecao | null>(inicial.canal)
  const [aba, setAba] = useState<Aba>(inicial.aba)
  const [, setTick] = useState(0)
  // Canais com estilo próprio (o resto segue o padrão). Vem da tela de estilo.
  const [comEstiloProprio, setComEstiloProprio] = useState<Set<number>>(new Set())
  // Contas das outras redes (Instagram, Facebook...) e em quais delas cada
  // canal publica. Só no painel novo; falhar aqui não pode derrubar a tela.
  const [contasSociais, setContasSociais] = useState<ContaSocial[]>([])
  const [destinosSociais, setDestinosSociais] = useState<Map<number, number[]>>(new Map())

  async function load() {
    const [c, v, tk, d, estilo] = await Promise.all([
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
      api.get<{ videos: SourceVideo[]; avgProcessingSeconds: number }>("/api/client/source-videos"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
      api.get<DriveStatusResponse>("/api/client/drive"),
      api.get<ClientVideoSettingsResponse>("/api/client/video-settings").catch(() => null),
    ])
    setComEstiloProprio(new Set((estilo?.channels ?? []).filter((x) => x.hasOwnStyle).map((x) => Number(x.id))))
    // Os ids chegam como texto (BIGINT do Postgres). Comparar texto com número
    // nunca bate, então tudo vira número aqui, num lugar só.
    const n = (x: unknown) => (x === null || x === undefined ? null : Number(x))
    setChannels(c.channels.map((ch) => ({ ...ch, id: Number(ch.id), tiktokAccountId: n(ch.tiktokAccountId) })))
    setVideos(
      v.videos.map((vd) => ({
        ...vd,
        id: Number(vd.id),
        channelId: n(vd.channelId),
        clipCount: Number(vd.clipCount),
        readyClipCount: Number(vd.readyClipCount),
      })),
    )
    setAvgSeconds(Number(v.avgProcessingSeconds))
    setTiktokAccounts(tk.accounts.map((a) => ({ ...a, id: Number(a.id) })))
    setDrive(d)
    const [sociais, destinos] = await Promise.all([
      api.get<{ contas: ContaSocial[] }>("/api/client/social-accounts").catch(() => null),
      api.get<{ canais: CanalDestino[] }>("/api/client/social-accounts/canais").catch(() => null),
    ])
    setContasSociais(sociais?.contas ?? [])
    setDestinosSociais(new Map((destinos?.canais ?? []).map((x) => [x.id, x.socialAccountIds])))
  }

  useEffect(() => {
    if (user) void load()
  }, [user])

  // Sem seleção (ou canal que sumiu): cai no primeiro canal, ou nos avulsos.
  useEffect(() => {
    if (!channels) return
    const existe = selecao === "avulsos" || channels.some((c) => c.id === selecao)
    if (existe) return
    // Abre no canal onde há algo acontecendo; sem isso, no que já tem vídeo;
    // por último, no primeiro da lista.
    const comAndamento = channels.find((c) => videos.some((v) => v.channelId === c.id && ACTIVE_STATUSES.includes(v.status)))
    const comVideo = channels.find((c) => videos.some((v) => v.channelId === c.id))
    setSelecao((comAndamento ?? comVideo ?? channels[0])?.id ?? (videos.some((v) => !v.channelId) ? "avulsos" : null))
  }, [channels, selecao, videos])

  useEffect(() => {
    if (channels) gravarUrl(selecao, aba)
  }, [selecao, aba, channels])

  // Mexer no estilo de um canal pode criar (ou desfazer) o estilo próprio
  // dele; ao trocar de aba o guia "pronto para rodar" relê isso.
  useEffect(() => {
    if (!user) return
    api
      .get<ClientVideoSettingsResponse>("/api/client/video-settings")
      .then((e) => setComEstiloProprio(new Set((e.channels ?? []).filter((x) => x.hasOwnStyle).map((x) => Number(x.id)))))
      .catch(() => {})
  }, [aba, user])

  // No celular a lista de canais é uma faixa que rola de lado: o canal aberto
  // tem que estar à vista, senão parece que nada está selecionado.
  const faixa = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = faixa.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const ativo = el.querySelector<HTMLElement>('[aria-current="page"]')
    if (ativo) el.scrollTo({ left: ativo.offsetLeft - 16 })
  }, [selecao, channels])

  const temPendente = videos.some((v) => PENDING_STATUSES.includes(v.status))
  useEffect(() => {
    if (!temPendente) return
    const refetch = setInterval(() => void load(), 8000)
    const tick = setInterval(() => setTick((x) => x + 1), 1000)
    return () => {
      clearInterval(refetch)
      clearInterval(tick)
    }
  }, [temPendente])

  // ---- Conectar canal -------------------------------------------------------
  const [link, setLink] = useState("")
  const [conectando, setConectando] = useState(false)
  const [erroConectar, setErroConectar] = useState<string | null>(null)
  const [semTiktok, setSemTiktok] = useState(false)
  const [pedidoUltimo, setPedidoUltimo] = useState<PedidoDeUltimoVideo | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)

  function enviarLink(e: FormEvent) {
    e.preventDefault()
    if (!link.trim()) return
    if (tiktokAccounts.length === 0) {
      setSemTiktok(true)
      return
    }
    void conectarCanal()
  }

  async function conectarCanal() {
    setErroConectar(null)
    setConectando(true)
    try {
      const r = await api.post<{ channel: YoutubeChannel; latestVideo: LatestChannelVideo | null }>(
        "/api/client/youtube-channels",
        { channelUrl: link },
      )
      setLink("")
      await load()
      setSelecao(r.channel.id)
      // O canal nasce pausado: vai direto pra aba onde se liga.
      setAba("monitoramento")
      if (r.latestVideo) setPedidoUltimo({ channelId: r.channel.id, video: r.latestVideo, recemConectado: true })
    } catch (err) {
      setErroConectar(err instanceof ApiError ? err.message : "Não foi possível conectar esse canal.")
    } finally {
      setConectando(false)
    }
  }

  if (authLoading || !user) return null

  const canal = typeof selecao === "number" ? (channels?.find((c) => c.id === selecao) ?? null) : null
  const avulsos = videos.filter((v) => !v.channelId)
  const doCanal = canal ? videos.filter((v) => v.channelId === canal.id) : avulsos
  const emAndamento = (cId: number | null) =>
    videos.filter((v) => (v.channelId ?? null) === cId && ACTIVE_STATUSES.includes(v.status)).length

  const totalAndamento = videos.filter((v) => ACTIVE_STATUSES.includes(v.status)).length
  const totalCortes = videos.reduce((s, v) => s + v.readyClipCount, 0)

  const resumo = [
    `${channels?.length ?? 0} ${channels?.length === 1 ? "canal" : "canais"}`,
    totalAndamento > 0 ? `${totalAndamento} ${totalAndamento === 1 ? "vídeo sendo cortado" : "vídeos sendo cortados"}` : null,
    `${totalCortes} ${totalCortes === 1 ? "corte pronto" : "cortes prontos"}`,
  ]
    .filter(Boolean)
    .join(" · ")

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeos do YouTube">
      {/* Cabeçalho: o que a tela é, o estado de relance, e a ação principal. */}
      <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: YT }}>
            <IconBrandYoutubeFilled className="size-6" />
          </span>
          <div className="min-w-0">
            <h1 className="font-heading text-[1.65rem] font-semibold leading-tight tracking-[-0.03em]">Vídeos do YouTube</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">{channels ? resumo : "Carregando…"}</p>
          </div>
        </div>
        <form onSubmit={enviarLink} className="flex w-full flex-col gap-1.5 lg:w-[25rem]">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <IconLink className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Link ou @ do canal"
                placeholder="Cole o link ou @ de um canal"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="h-10 bg-card pl-9"
                data-tour="canal-endereco"
              />
            </div>
            <Button
              type="submit"
              disabled={conectando || !link.trim()}
              className="h-10 shrink-0 gap-1.5 text-white hover:opacity-90"
              style={{ background: YT }}
              data-tour="canal-adicionar"
            >
              <IconPlus className="size-4" />
              <span className="hidden sm:inline">{conectando ? "Conectando..." : "Conectar canal"}</span>
              <span className="sm:hidden">{conectando ? "..." : "Conectar"}</span>
            </Button>
          </div>
          {erroConectar && <p className="text-xs text-destructive">{erroConectar}</p>}
        </form>
      </header>

      {aviso && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">{aviso}</p>
      )}

      {!channels ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-12" />
          <Skeleton className="h-96" />
        </div>
      ) : channels.length === 0 && avulsos.length === 0 ? (
        <PrimeiroCanal />
      ) : (
        <div className="flex min-w-0 flex-col gap-4">
          {/* Os canais como abas: o conteúdo do canal ganha a largura toda. */}
          <nav aria-label="Canais" className="min-w-0">
            <div ref={faixa} className="-mx-4 flex gap-1.5 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
              {channels.map((c) => {
                const st = estadoDoCanal(c)
                const andando = emAndamento(c.id)
                const ativo = selecao === c.id
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelecao(c.id)}
                    aria-current={ativo ? "page" : undefined}
                    className={cn(
                      "flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors",
                      ativo
                        ? "border-foreground bg-foreground text-background"
                        : "border-border bg-card text-foreground hover:border-foreground/40",
                    )}
                  >
                    <span className="relative">
                      <Avatar className="size-7">
                        {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                        <AvatarFallback className="text-[9px] text-foreground">{iniciais(c.channelName || "YT")}</AvatarFallback>
                      </Avatar>
                      <span className={cn("absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full ring-2", st.cor, ativo ? "ring-foreground" : "ring-card")} />
                    </span>
                    <span className="max-w-[11rem] truncate font-medium">{c.channelName || handleDoCanal(c.channelUrl)}</span>
                    {andando > 0 && (
                      <span className={cn("flex items-center gap-1 font-mono text-[10.5px]", ativo ? "text-background/80" : "text-tone-indigo-ink")}>
                        <IconLoader2 className="size-3 animate-spin" />
                        {andando}
                      </span>
                    )}
                  </button>
                )
              })}
              <button
                type="button"
                onClick={() => setSelecao("avulsos")}
                aria-current={selecao === "avulsos" ? "page" : undefined}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full border border-dashed py-1 pl-1 pr-3 text-sm transition-colors",
                  selecao === "avulsos" ? "border-foreground bg-foreground text-background" : "border-border text-muted-foreground hover:text-foreground",
                )}
              >
                <span className={cn("flex size-7 items-center justify-center rounded-full", selecao === "avulsos" ? "bg-background/15" : "bg-muted")}>
                  <IconUpload className="size-3.5" />
                </span>
                Envios avulsos
                <span className="font-mono text-[10.5px] opacity-70">{avulsos.length}</span>
              </button>
            </div>
          </nav>

          <section className="flex min-w-0 flex-col gap-4">
            {canal ? (
              <EspacoDoCanal
                key={canal.id}
                estiloProprio={comEstiloProprio.has(canal.id)}
                canal={canal}
                videos={doCanal}
                avgSeconds={avgSeconds}
                aba={aba}
                setAba={setAba}
                tiktokAccounts={tiktokAccounts}
                contasSociais={contasSociais}
                destinosSociais={destinosSociais.get(canal.id) ?? []}
                driveConectado={drive?.connected === true}
                mostrarTunel={mostrarTunel}
                onRecarregar={load}
                onCortarUltimo={setPedidoUltimo}
                onRemovido={async () => {
                  setSelecao(null)
                  await load()
                }}
              />
            ) : selecao === "avulsos" ? (
              <EnviosAvulsos
                videos={avulsos}
                avgSeconds={avgSeconds}
                tiktokAccounts={tiktokAccounts}
                mostrarTunel={mostrarTunel}
                onRecarregar={load}
              />
            ) : null}
          </section>
        </div>
      )}

      <UltimoVideoDialog
        pedido={pedidoUltimo}
        onFechar={() => setPedidoUltimo(null)}
        onProcessado={async () => {
          setPedidoUltimo(null)
          setAba("videos")
          setAviso("O vídeo entrou na fila. Acompanhe as etapas na aba Vídeos e cortes.")
          await load()
        }}
      />

      {/* Canal sem conta do TikTok vira canal que corta e não publica. Não é
          bloqueio: dá pra usar só pra receber os cortes no Drive. */}
      <Dialog open={semTiktok} onOpenChange={setSemTiktok}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Conecte primeiro onde publicar</DialogTitle>
            <DialogDescription>
              Sem uma conta do TikTok, os cortes ficam prontos e parados aqui, sem destino. Conecte a conta em Redes sociais e
              volte pra conectar o canal.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setSemTiktok(false)
                void conectarCanal()
              }}
            >
              Conectar mesmo assim
            </Button>
            <Button asChild className="gap-1.5">
              <a href="/client/social?rede=tiktok">
                <IconBrandTiktok className="size-4" />
                Conectar TikTok
              </a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}

const CORES = {
  red: { wash: "bg-[#FF0033]/10", ink: "text-[#E0002D] dark:text-[#FF5470]" },
  green: { wash: "bg-tone-success-wash", ink: "text-tone-success-ink" },
  blue: { wash: "bg-tone-indigo-wash", ink: "text-tone-indigo-ink" },
  violet: { wash: "bg-tone-violet-wash", ink: "text-tone-violet-ink" },
  amber: { wash: "bg-amber-500/12", ink: "text-amber-700 dark:text-amber-400" },
} as const

/** Primeira visita: o caminho em três passos, na ordem em que acontece. */
function PrimeiroCanal() {
  const passos: { titulo: string; texto: string; icone: ReactNode; cor: keyof typeof CORES }[] = [
    { titulo: "Conecte o canal", texto: "Cole o link ou o @ no campo acima. Pode ser seu ou de quem você corta.", icone: <IconLink className="size-5" />, cor: "red" },
    { titulo: "Escolha o estilo", texto: "Pegue um modelo pronto ou monte o seu: legenda, título, fundo e quantos cortes.", icone: <IconPalette className="size-5" />, cor: "violet" },
    { titulo: "Acompanhe", texto: "Cada vídeo novo aparece aqui com a etapa em que está, até virar corte.", icone: <IconRadar className="size-5" />, cor: "green" },
  ]
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {passos.map((p, i) => (
        <Card key={p.titulo} className="gap-0 p-5">
          <div className="flex items-center gap-3">
            <span className={cn("flex size-10 items-center justify-center rounded-xl", CORES[p.cor].wash, CORES[p.cor].ink)}>{p.icone}</span>
            <span className="font-mono text-xs text-muted-foreground">passo {i + 1}</span>
          </div>
          <p className="mt-3 font-medium">{p.titulo}</p>
          <p className="mt-1 text-sm text-muted-foreground">{p.texto}</p>
        </Card>
      ))}
    </div>
  )
}

function AbaBotao({ ativa, onClick, children }: { ativa: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors",
        ativa ? "border-[#FF0033] font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

function EspacoDoCanal({
  canal,
  videos,
  avgSeconds,
  aba,
  setAba,
  tiktokAccounts,
  contasSociais,
  destinosSociais,
  driveConectado,
  mostrarTunel,
  onRecarregar,
  onCortarUltimo,
  onRemovido,
  estiloProprio,
}: {
  estiloProprio: boolean
  contasSociais: ContaSocial[]
  destinosSociais: number[]
  canal: YoutubeChannel
  videos: SourceVideo[]
  avgSeconds: number
  aba: Aba
  setAba: (a: Aba) => void
  tiktokAccounts: TikTokAccountSummary[]
  driveConectado: boolean
  mostrarTunel: boolean
  onRecarregar: () => Promise<void>
  onCortarUltimo: (p: PedidoDeUltimoVideo) => void
  onRemovido: () => void
}) {
  const [buscando, setBuscando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const st = estadoDoCanal(canal)
  const conta = tiktokAccounts.find((a) => a.id === canal.tiktokAccountId) ?? null
  const destinos = [
    ...(conta ? [{ chave: `tiktok-${conta.id}`, rede: "tiktok" as const, nome: conta.displayName, avatar: conta.avatarUrl }] : []),
    ...contasSociais
      .filter((c) => destinosSociais.includes(c.id))
      .map((c) => ({ chave: `${c.network}-${c.id}`, rede: c.network, nome: c.displayName || c.username || "Conta", avatar: c.avatarUrl })),
  ]

  async function cortarUltimo() {
    setErro(null)
    setBuscando(true)
    try {
      const { video } = await api.get<{ video: LatestChannelVideo }>(`/api/client/youtube-channels/${canal.id}/latest-video`)
      onCortarUltimo({ channelId: canal.id, video })
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível buscar o último vídeo.")
    } finally {
      setBuscando(false)
    }
  }

  return (
    <>
      <Card className="gap-0 overflow-hidden py-0">
        <div className="flex flex-col gap-4 px-5 pb-4 pt-5 sm:flex-row sm:items-center">
          <Avatar className="size-14 shrink-0">
            {canal.avatarUrl && <AvatarImage src={canal.avatarUrl} alt="" />}
            <AvatarFallback className="text-base">{iniciais(canal.channelName || "YT")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-semibold tracking-[-0.02em]">{canal.channelName || handleDoCanal(canal.channelUrl)}</h2>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              <a href={canal.channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
                {handleDoCanal(canal.channelUrl)}
                <IconArrowUpRight className="size-3" />
              </a>
              {canal.lastPolledAt && <span>· conferido {dataHora(canal.lastPolledAt)}</span>}
            </p>
          </div>
          <Button variant="outline" className="shrink-0 gap-1.5" disabled={buscando} onClick={cortarUltimo}>
            <IconScissors className="size-4" />
            {buscando ? "Buscando..." : "Cortar último vídeo"}
          </Button>
        </div>

        {/* O caminho do canal numa linha: entra -> corta no estilo -> sai nas
            contas. Cada parte leva pra aba onde se muda. */}
        <div className="flex flex-col gap-2 border-t border-border bg-muted/30 px-5 py-3 text-xs sm:flex-row sm:flex-wrap sm:items-center sm:gap-x-5">
          <button type="button" onClick={() => setAba("monitoramento")} className="flex items-center gap-2 text-left hover:text-foreground">
            <span className={cn("size-2 shrink-0 rounded-full", st.cor)} />
            <span>
              <span className="font-medium text-foreground">{canal.isActive ? "Pegando vídeos novos" : "Monitoramento desligado"}</span>
              <span className="text-muted-foreground"> {canal.isActive ? "a cada 20 min" : "· ligue pra entrar sozinho"}</span>
            </span>
          </button>
          <button type="button" onClick={() => setAba("estilo")} className="flex items-center gap-2 text-left hover:text-foreground">
            <IconPalette className="size-3.5 shrink-0 text-tone-violet-ink" />
            <span className="font-medium text-foreground">{estiloProprio ? "Estilo próprio" : "Estilo padrão"}</span>
          </button>
          <button type="button" onClick={() => setAba("monitoramento")} className="flex min-w-0 items-center gap-2 text-left">
            <span className="text-muted-foreground">Publica em</span>
            {destinos.length === 0 ? (
              <span className="font-medium text-amber-700 dark:text-amber-400">nenhuma conta — escolher</span>
            ) : (
              <span className="flex min-w-0 items-center -space-x-1.5">
                {destinos.slice(0, 6).map((d) => {
                  const r = REDES[d.rede]
                  return (
                    <span key={d.chave} title={`${d.nome} · ${r.nome}`} className="relative">
                      <Avatar className="size-6 ring-2 ring-card">
                        {d.avatar && <AvatarImage src={d.avatar} alt="" />}
                        <AvatarFallback className="text-[8px]">{d.nome.slice(0, 2).toUpperCase()}</AvatarFallback>
                      </Avatar>
                      <span className="absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full text-white ring-1 ring-card" style={{ background: r.fundo }}>
                        <r.Icone className="size-2" />
                      </span>
                    </span>
                  )
                })}
                {destinos.length > 6 && <span className="pl-2.5 font-mono text-[10.5px] text-muted-foreground">+{destinos.length - 6}</span>}
              </span>
            )}
          </button>
        </div>

        {/* Avisos do canal: só o que explica uma dúvida real ("por que esse
            canal parou de trazer vídeo?"). */}
        {(erro || (canal.isActive && canal.lastCheckOk === false) || canal.skippedByDurationCount > 0 || canal.membersOnlyCount > 0) && (
          <div className="flex flex-col gap-1.5 border-t border-border px-5 py-3 text-xs">
            {erro && <p className="text-destructive">{erro}</p>}
            {canal.isActive && canal.lastCheckOk === false && (
              <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-500">
                <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
                A última conferência do canal falhou{canal.checkFailCount > 1 ? ` (${canal.checkFailCount} seguidas)` : ""}. Vamos tentar de
                novo em 20 minutos.
              </p>
            )}
            {canal.skippedByDurationCount > 0 && (
              <p className="flex items-start gap-1.5 text-muted-foreground">
                <IconClockPause className="mt-px size-3.5 shrink-0" />
                {canal.skippedByDurationCount === 1
                  ? "1 vídeo ficou de fora por passar do limite de duração."
                  : `${canal.skippedByDurationCount} vídeos ficaram de fora por passar do limite de duração.`}
              </p>
            )}
            {canal.membersOnlyCount > 0 && (
              <p className="text-tone-success-ink">
                Há vídeo exclusivo de membros esperando o canal abrir pra todo mundo. Ele entra sozinho quando abrir.
              </p>
            )}
          </div>
        )}

        <div role="tablist" data-tour="abas-do-canal" className="flex gap-5 overflow-x-auto border-t border-border px-5 pt-2 sm:gap-6">
          <AbaBotao ativa={aba === "videos"} onClick={() => setAba("videos")}>
            <IconMovie className="size-4" /> Vídeos e cortes
            <span className="rounded-full bg-muted px-1.5 font-mono text-[10.5px] text-muted-foreground">{videos.length}</span>
          </AbaBotao>
          <AbaBotao ativa={aba === "estilo"} onClick={() => setAba("estilo")}>
            <IconPalette className="size-4" /> Estilo do corte
          </AbaBotao>
          <AbaBotao ativa={aba === "monitoramento"} onClick={() => setAba("monitoramento")}>
            <IconRadar className="size-4" /> Monitoramento e destinos
          </AbaBotao>
        </div>
      </Card>

      {aba === "videos" && (
        <ListaDeVideos
          videos={videos}
          avgSeconds={avgSeconds}
          canal={canal}
          mostrarTunel={mostrarTunel}
          onRecarregar={onRecarregar}
          vazio={
            <>
              <p className="font-medium">Nenhum vídeo deste canal ainda</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {canal.isActive
                  ? "O próximo vídeo publicado entra sozinho. Pra começar agora, corte o último vídeo do canal."
                  : "O canal está pausado. Ligue em Monitoramento ou corte o último vídeo do canal na mão."}
              </p>
              <Button size="sm" className="mt-4 gap-1.5" disabled={buscando} onClick={cortarUltimo}>
                <IconScissors className="size-4" />
                Cortar último vídeo
              </Button>
            </>
          }
        />
      )}
      {aba === "estilo" && <ClipStyleEditorCard channelId={canal.id} comModelos />}
      {aba === "monitoramento" && (
        <MonitoramentoDoCanal
          channel={canal}
          tiktokAccounts={tiktokAccounts}
          contasSociais={contasSociais}
          destinosSociais={destinosSociais}
          driveConectado={driveConectado}
          onMudou={onRecarregar}
          onRemovido={onRemovido}
        />
      )}
    </>
  )
}

function ListaDeVideos({
  videos,
  avgSeconds,
  canal,
  mostrarTunel,
  onRecarregar,
  vazio,
}: {
  videos: SourceVideo[]
  avgSeconds: number
  canal: YoutubeChannel | null
  mostrarTunel: boolean
  onRecarregar: () => Promise<void>
  vazio: ReactNode
}) {
  const [selecionados, setSelecionados] = useState<Set<number>>(new Set())
  const [confirmando, setConfirmando] = useState(false)
  const [apagando, setApagando] = useState(false)

  const andamento = videos
    .filter((v) => PENDING_STATUSES.includes(v.status))
    .sort((a, b) => (STAGE_PRIORITY[a.status] ?? 9) - (STAGE_PRIORITY[b.status] ?? 9))
  const prontos = videos.filter((v) => !PENDING_STATUSES.includes(v.status))

  function alternar(id: number) {
    setSelecionados((prev) => {
      const n = new Set(prev)
      if (n.has(id)) n.delete(id)
      else n.add(id)
      return n
    })
  }

  async function apagarSelecionados() {
    if (!confirmando) {
      setConfirmando(true)
      setTimeout(() => setConfirmando(false), 4000)
      return
    }
    setConfirmando(false)
    setApagando(true)
    try {
      await api.post("/api/client/source-videos/bulk-delete", { ids: [...selecionados] })
      setSelecionados(new Set())
      await onRecarregar()
    } finally {
      setApagando(false)
    }
  }

  if (videos.length === 0) {
    return <div className="rounded-xl border border-dashed border-border px-6 py-12 text-center">{vazio}</div>
  }

  const linha = (v: SourceVideo) => (
    <VideoRow
      key={v.id}
      video={v}
      avgProcessingSeconds={avgSeconds}
      channel={canal}
      onChanged={onRecarregar}
      onDeleted={onRecarregar}
      selected={selecionados.has(v.id)}
      onToggleSelect={() => alternar(v.id)}
      mostrarTunel={mostrarTunel}
      pipeline
    />
  )

  return (
    <div className="flex flex-col gap-6">
      {selecionados.size > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card px-4 py-2.5 shadow-[var(--shadow-flat)]">
          <span className="font-mono text-xs text-muted-foreground">{selecionados.size} selecionado{selecionados.size > 1 ? "s" : ""}</span>
          <Button
            size="sm"
            variant={confirmando ? "destructive" : "outline"}
            disabled={apagando}
            onClick={apagarSelecionados}
            className="ml-auto gap-1.5"
          >
            <IconTrash className="size-3.5" />
            {apagando ? "Apagando..." : confirmando ? `Confirmar: apagar ${selecionados.size}` : "Apagar selecionados"}
          </Button>
        </div>
      )}
      {andamento.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <Rotulo>Em processamento · {andamento.length}</Rotulo>
          {andamento.map(linha)}
        </div>
      )}
      {prontos.length > 0 && (
        <div className="flex flex-col gap-2.5">
          <Rotulo>Concluídos · {prontos.length}</Rotulo>
          {prontos.map(linha)}
        </div>
      )}
    </div>
  )
}

function Rotulo({ children }: { children: ReactNode }) {
  return <h3 className="px-1 font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">{children}</h3>
}

function EnviosAvulsos({
  videos,
  avgSeconds,
  tiktokAccounts,
  mostrarTunel,
  onRecarregar,
}: {
  videos: SourceVideo[]
  avgSeconds: number
  tiktokAccounts: TikTokAccountSummary[]
  mostrarTunel: boolean
  onRecarregar: () => Promise<void>
}) {
  const [modo, setModo] = useState<"link" | "arquivo">("link")
  const [ajustando, setAjustando] = useState<{ id: number; title: string } | null>(null)
  const [comecando, setComecando] = useState(false)

  return (
    <>
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-1 p-5">
          <h2 className="text-lg font-semibold tracking-[-0.02em]">Envios avulsos</h2>
          <p className="text-sm text-muted-foreground">
            Um vídeo só, sem conectar o canal: cole o link de qualquer vídeo do YouTube ou envie o arquivo.
          </p>
        </div>
        <div role="tablist" className="flex gap-6 border-t border-border px-5 pt-2">
          <AbaBotao ativa={modo === "link"} onClick={() => setModo("link")}>
            Por link
          </AbaBotao>
          <AbaBotao ativa={modo === "arquivo"} onClick={() => setModo("arquivo")}>
            Por arquivo
          </AbaBotao>
        </div>
      </Card>

      {modo === "link" ? (
        <AddManualVideoCard onAdded={onRecarregar} tiktokAccounts={tiktokAccounts} onConfigurarEstilo={setAjustando} />
      ) : (
        <UploadVideoCard onAdded={onRecarregar} tiktokAccounts={tiktokAccounts} />
      )}

      {ajustando && (
        <Card className="gap-0 py-0">
          <div className="flex flex-col gap-1 border-b border-border p-5">
            <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">Estilo só deste vídeo</p>
            <p className="font-medium">{ajustando.title}</p>
          </div>
          <div className="flex flex-col gap-4 p-5">
            <ClipStyleEditorCard sourceVideoId={ajustando.id} comModelos />
            <div className="flex justify-end">
              <Button
                disabled={comecando}
                onClick={async () => {
                  setComecando(true)
                  try {
                    await api.post(`/api/client/source-videos/${ajustando.id}/enqueue`, {})
                    setAjustando(null)
                    await onRecarregar()
                  } finally {
                    setComecando(false)
                  }
                }}
              >
                {comecando ? "Começando..." : "Começar a cortar"}
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ListaDeVideos
        videos={videos}
        avgSeconds={avgSeconds}
        canal={null}
        mostrarTunel={mostrarTunel}
        onRecarregar={onRecarregar}
        vazio={
          <>
            <p className="font-medium">Nenhum envio avulso</p>
            <p className="mt-1 text-sm text-muted-foreground">Os vídeos que você mandar por link ou arquivo aparecem aqui.</p>
          </>
        }
      />
    </>
  )
}
