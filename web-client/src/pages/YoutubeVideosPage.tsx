import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react"
import {
  IconAlertTriangle,
  IconArrowUpRight,
  IconBrandTiktok,
  IconClockPause,
  IconLink,
  IconPlus,
  IconScissors,
  IconTrash,
  IconUpload,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
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
import type { DriveStatusResponse, LatestChannelVideo, SourceVideo, TikTokAccountSummary, YoutubeChannel } from "@/types/api"

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

  async function load() {
    const [c, v, tk, d] = await Promise.all([
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
      api.get<{ videos: SourceVideo[]; avgProcessingSeconds: number }>("/api/client/source-videos"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
      api.get<DriveStatusResponse>("/api/client/drive"),
    ])
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
  const monitorando = channels?.filter((c) => c.isActive).length ?? 0

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeos do YouTube">
      {/* Cabeçalho: o que a tela faz + a ação principal (conectar canal). */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <h1 className="font-heading text-[1.65rem] font-semibold leading-tight tracking-[-0.03em]">Vídeos do YouTube</h1>
          <p className="mt-1.5 max-w-xl text-sm text-muted-foreground">
            Conecte um canal e cada vídeo novo vira cortes prontos pra publicar. O estilo do corte e o acompanhamento ficam
            aqui, canal por canal.
          </p>
        </div>
        <form onSubmit={enviarLink} className="flex w-full flex-col gap-1.5 lg:w-[27rem]">
          <div className="flex gap-2">
            <div className="relative min-w-0 flex-1">
              <IconLink className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                aria-label="Link ou @ do canal"
                placeholder="youtube.com/@canal"
                value={link}
                onChange={(e) => setLink(e.target.value)}
                className="h-10 bg-card pl-9"
                data-tour="canal-endereco"
              />
            </div>
            <Button type="submit" disabled={conectando || !link.trim()} className="h-10 gap-1.5" data-tour="canal-adicionar">
              <IconPlus className="size-4" />
              {conectando ? "Conectando..." : "Conectar canal"}
            </Button>
          </div>
          {erroConectar && <p className="text-xs text-destructive">{erroConectar}</p>}
        </form>
      </div>

      {/* Linha de números: o estado de tudo de relance. Mono porque é o que o
          sistema contou, não texto escrito. */}
      {channels && channels.length > 0 && (
        <div className="flex flex-wrap gap-x-6 gap-y-1 border-y border-border/70 py-2.5 font-mono text-xs text-muted-foreground">
          <span>
            <span className="text-foreground">{channels.length}</span> {channels.length === 1 ? "canal" : "canais"}
          </span>
          <span>
            <span className="text-foreground">{monitorando}</span> monitorando
          </span>
          <span>
            <span className="text-foreground">{totalAndamento}</span> em processamento
          </span>
          <span>
            <span className="text-foreground">{totalCortes}</span> cortes prontos
          </span>
        </div>
      )}

      {aviso && (
        <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">{aviso}</p>
      )}

      {!channels ? (
        <div className="grid gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          <Skeleton className="h-64" />
          <Skeleton className="h-96" />
        </div>
      ) : channels.length === 0 && avulsos.length === 0 ? (
        <PrimeiroCanal />
      ) : (
        <div className="grid items-start gap-5 lg:grid-cols-[17rem_minmax(0,1fr)]">
          {/* Lista de canais. No celular vira uma faixa que rola de lado. */}
          <nav aria-label="Canais" className="min-w-0 lg:sticky lg:top-4">
            <p className="mb-2 hidden px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">
              Canais
            </p>
            <div ref={faixa} className="relative -mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-0.5 lg:overflow-visible lg:px-0 lg:pb-0">
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
                      "flex min-w-[13rem] shrink-0 items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors lg:min-w-0 lg:border-transparent",
                      ativo
                        ? "border-border bg-card shadow-[var(--shadow-flat)] lg:border-border"
                        : "border-border bg-card/50 hover:bg-card lg:bg-transparent",
                    )}
                  >
                    <Avatar className="size-8 shrink-0">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                      <AvatarFallback className="text-[10px]">{iniciais(c.channelName || "YT")}</AvatarFallback>
                    </Avatar>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.channelName || handleDoCanal(c.channelUrl)}</span>
                      <span className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
                        <span className={cn("size-1.5 shrink-0 rounded-full", st.cor)} />
                        {st.rotulo}
                        {andando > 0 && <span className="text-foreground">· {andando} em curso</span>}
                      </span>
                    </span>
                  </button>
                )
              })}
              <div className="hidden lg:my-2 lg:block lg:border-t lg:border-border/70" />
              <button
                type="button"
                onClick={() => setSelecao("avulsos")}
                aria-current={selecao === "avulsos" ? "page" : undefined}
                className={cn(
                  "flex min-w-[13rem] shrink-0 items-center gap-3 rounded-lg border px-2.5 py-2 text-left transition-colors lg:min-w-0 lg:border-transparent",
                  selecao === "avulsos"
                    ? "border-border bg-card shadow-[var(--shadow-flat)] lg:border-border"
                    : "border-border bg-card/50 hover:bg-card lg:bg-transparent",
                )}
              >
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-dashed border-border text-muted-foreground">
                  <IconUpload className="size-3.5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">Envios avulsos</span>
                  <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                    link ou arquivo · {avulsos.length}
                  </span>
                </span>
              </button>
            </div>
          </nav>

          <section className="flex min-w-0 flex-col gap-4">
            {canal ? (
              <EspacoDoCanal
                key={canal.id}
                canal={canal}
                videos={doCanal}
                avgSeconds={avgSeconds}
                aba={aba}
                setAba={setAba}
                tiktokAccounts={tiktokAccounts}
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

/** Primeira visita: o caminho em três passos, na ordem em que acontece. */
function PrimeiroCanal() {
  const passos: { titulo: string; texto: string }[] = [
    { titulo: "Conecte o canal", texto: "Cole o link ou o @ no campo acima. Pode ser seu ou de quem você corta." },
    { titulo: "Ajuste o corte", texto: "Legenda, título, enquadramento e quantos cortes cada vídeo vira." },
    { titulo: "Acompanhe", texto: "Cada vídeo novo aparece aqui com a etapa em que está, até virar corte." },
  ]
  return (
    <Card className="py-0">
      <CardContent className="grid gap-0 p-0 sm:grid-cols-3 sm:divide-x sm:divide-border">
        {passos.map((p, i) => (
          <div key={p.titulo} className="border-b border-border p-6 last:border-b-0 sm:border-b-0">
            <span className="font-mono text-xs text-muted-foreground">passo {i + 1}</span>
            <p className="mt-2 font-medium">{p.titulo}</p>
            <p className="mt-1 text-sm text-muted-foreground">{p.texto}</p>
          </div>
        ))}
      </CardContent>
    </Card>
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
        "relative -mb-px shrink-0 border-b-2 px-1 pb-2.5 pt-1 text-sm transition-colors",
        ativa ? "border-foreground font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
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
  driveConectado,
  mostrarTunel,
  onRecarregar,
  onCortarUltimo,
  onRemovido,
}: {
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
      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center">
          <Avatar className="size-14 shrink-0 ring-1 ring-border">
            {canal.avatarUrl && <AvatarImage src={canal.avatarUrl} alt="" />}
            <AvatarFallback>{iniciais(canal.channelName || "YT")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="truncate text-lg font-semibold tracking-[-0.02em]">{canal.channelName || handleDoCanal(canal.channelUrl)}</h2>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-mono text-[10.5px] text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", st.cor)} />
                {st.rotulo}
              </span>
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 font-mono text-[11px] text-muted-foreground">
              <a href={canal.channelUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-0.5 hover:text-foreground">
                {handleDoCanal(canal.channelUrl)}
                <IconArrowUpRight className="size-3" />
              </a>
              {canal.lastPolledAt && <span>· conferido {dataHora(canal.lastPolledAt)}</span>}
              <span className="inline-flex items-center gap-1">
                · <IconBrandTiktok className="size-3" /> {conta ? conta.displayName : "sem conta de destino"}
              </span>
            </p>
          </div>
          <Button variant="outline" className="shrink-0 gap-1.5" disabled={buscando} onClick={cortarUltimo}>
            <IconScissors className="size-4" />
            {buscando ? "Buscando..." : "Cortar último vídeo"}
          </Button>
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

        <div role="tablist" className="flex gap-6 overflow-x-auto border-t border-border px-5 pt-2">
          <AbaBotao ativa={aba === "videos"} onClick={() => setAba("videos")}>
            Vídeos e cortes <span className="ml-1 font-mono text-xs text-muted-foreground">{videos.length}</span>
          </AbaBotao>
          <AbaBotao ativa={aba === "estilo"} onClick={() => setAba("estilo")}>
            Estilo do corte
          </AbaBotao>
          <AbaBotao ativa={aba === "monitoramento"} onClick={() => setAba("monitoramento")}>
            Monitoramento
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
      {aba === "estilo" && <ClipStyleEditorCard channelId={canal.id} />}
      {aba === "monitoramento" && (
        <MonitoramentoDoCanal
          channel={canal}
          tiktokAccounts={tiktokAccounts}
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
            <ClipStyleEditorCard sourceVideoId={ajustando.id} />
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
