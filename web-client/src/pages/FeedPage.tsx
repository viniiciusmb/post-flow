import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconCarouselVertical,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconClock,
  IconDownload,
  IconHeart,
  IconHeartFilled,
  IconMusic,
  IconPlayerPlayFilled,
  IconSend,
  IconUpload,
  IconVolume,
  IconVolumeOff,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { dataHora } from "@/lib/formatoLocal"

type Postagem = { accountId: number; status: string; scheduledFor: string | null; postedAt: string | null }
type Corte = {
  id: number
  titulo: string
  legenda: string | null
  duracaoSegundos: number
  criadoEm: string
  videoUrl: string
  capaUrl: string | null
  origem: { videoId: number; titulo: string; canalId: number | null; canalNome: string | null; canalAvatar: string | null; canalUrl: string | null }
  gostei: boolean
  postagens: Postagem[]
}
type Conta = { id: number; rede: "tiktok" | "instagram" | "facebook"; nome: string; avatar: string | null; publicaSozinho: boolean; disponivel: boolean }
type Canal = { id: number; nome: string; avatar: string | null }
type Contexto = { canais: Canal[]; contas: Conta[]; totalGostei: number }
type Aba = "todos" | "gostei"
type Resultado = { accountId: number; nome: string; resultado: "enfileirado" | "ja_na_fila" | "ja_publicado" | "ja_existia"; scheduledFor: string | null }

// Cores de ação do feed. O vermelho do "gostei" é o mesmo coração de rede
// social que todo mundo reconhece; o resto da tela fica escura de propósito,
// pra quem olha ver o corte como ele aparece no celular de quem assiste.
const CORACAO = "#FE2C55"
const REDE_FUNDO: Record<Conta["rede"], string> = {
  tiktok: "linear-gradient(135deg, #111 0%, #111 55%, #25F4EE 140%)",
  instagram: "linear-gradient(45deg, #F58529 0%, #DD2A7B 45%, #8134AF 75%, #515BD4 100%)",
  facebook: "#1877F2",
}
const REDE_ICONE = { tiktok: IconBrandTiktok, instagram: IconBrandInstagram, facebook: IconBrandFacebook }

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
}

function lerUrl(): { aba: Aba; canal: string } {
  const p = new URLSearchParams(window.location.search)
  return { aba: p.get("aba") === "gostei" ? "gostei" : "todos", canal: p.get("canal") || "todos" }
}

export function FeedPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const inicial = useMemo(lerUrl, [])
  const [aba, setAba] = useState<Aba>(inicial.aba)
  const [canal, setCanal] = useState(inicial.canal)
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [cortes, setCortes] = useState<Corte[] | null>(null)
  const [proximo, setProximo] = useState<number | null>(null)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [ativo, setAtivo] = useState(0)
  const [mudo, setMudo] = useState(true)
  const [enviando, setEnviando] = useState<Corte | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const palco = useRef<HTMLDivElement>(null)

  const consulta = useCallback(
    (antes?: number | null) => {
      const p = new URLSearchParams()
      if (canal !== "todos") p.set("canal", canal)
      if (aba === "gostei") p.set("aba", "gostei")
      if (antes) p.set("antes", String(antes))
      return `/api/client/feed${p.toString() ? `?${p}` : ""}`
    },
    [aba, canal],
  )

  useEffect(() => {
    if (!user) return
    api.get<Contexto>("/api/client/feed/contexto").then(setCtx).catch(() => {})
  }, [user])

  // Trocar de aba ou de canal recomeça o feed do topo.
  useEffect(() => {
    if (!user) return
    setCortes(null)
    setErro(null)
    setAtivo(0)
    palco.current?.scrollTo({ top: 0 })
    const p = new URLSearchParams()
    if (canal !== "todos") p.set("canal", canal)
    if (aba === "gostei") p.set("aba", "gostei")
    window.history.replaceState(null, "", `/client/feed${p.toString() ? `?${p}` : ""}`)
    api
      .get<{ cortes: Corte[]; proximo: number | null }>(consulta())
      .then((d) => {
        setCortes(d.cortes)
        setProximo(d.proximo)
      })
      .catch((err) => {
        setCortes([])
        setErro(err instanceof ApiError ? err.message : "Não foi possível carregar o feed.")
      })
  }, [user, consulta, aba, canal])

  // Busca a próxima página quando faltam 3 cortes pro fim.
  useEffect(() => {
    if (!cortes || !proximo || carregandoMais || ativo < cortes.length - 3) return
    setCarregandoMais(true)
    api
      .get<{ cortes: Corte[]; proximo: number | null }>(consulta(proximo))
      .then((d) => {
        setCortes((atual) => [...(atual ?? []), ...d.cortes.filter((c) => !(atual ?? []).some((x) => x.id === c.id))])
        setProximo(d.proximo)
      })
      .finally(() => setCarregandoMais(false))
  }, [ativo, cortes, proximo, carregandoMais, consulta])

  // Qual corte está na tela: o que ocupa a maior parte do palco.
  useEffect(() => {
    const raiz = palco.current
    if (!raiz || !cortes?.length) return
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) {
          if (e.isIntersecting) setAtivo(Number((e.target as HTMLElement).dataset.indice))
        }
      },
      { root: raiz, threshold: 0.65 },
    )
    raiz.querySelectorAll("[data-indice]").forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [cortes])

  // No celular o palco ocupa exatamente o que sobra da tela abaixo dos
  // filtros. Uma altura fixa em CSS sobrava ou faltava conforme o aparelho
  // (o vídeo ficava cortado embaixo, ou a página rolava junto com o feed).
  const [alturaMovel, setAlturaMovel] = useState<number | null>(null)
  useLayoutEffect(() => {
    function medir() {
      const el = palco.current
      if (!el || window.innerWidth >= 1024) return setAlturaMovel(null)
      const topo = el.getBoundingClientRect().top + window.scrollY
      setAlturaMovel(Math.max(380, Math.round(window.innerHeight - topo - 16)))
    }
    medir()
    window.addEventListener("resize", medir)
    return () => window.removeEventListener("resize", medir)
  }, [ctx, user])

  function irPara(i: number) {
    const raiz = palco.current
    if (!raiz || !cortes) return
    const alvo = Math.max(0, Math.min(cortes.length - 1, i))
    raiz.querySelector<HTMLElement>(`[data-indice="${alvo}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Setas do teclado (e J/K) passam de um corte pro outro, como no feed do app.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (enviando) return
      const alvo = e.target as HTMLElement
      if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        irPara(ativo + 1)
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        irPara(ativo - 1)
      } else if (e.key === "m") {
        setMudo((m) => !m)
      }
    }
    window.addEventListener("keydown", tecla)
    return () => window.removeEventListener("keydown", tecla)
  })

  async function alternarGostei(c: Corte, valor = !c.gostei) {
    setCortes((l) => l?.map((x) => (x.id === c.id ? { ...x, gostei: valor } : x)) ?? null)
    try {
      const r = await api.put<{ gostei: boolean; totalGostei: number }>(`/api/client/feed/cortes/${c.id}/gostei`, { gostei: valor })
      setCtx((x) => (x ? { ...x, totalGostei: r.totalGostei } : x))
    } catch {
      setCortes((l) => l?.map((x) => (x.id === c.id ? { ...x, gostei: !valor } : x)) ?? null)
    }
  }

  if (authLoading || !user) return null

  const canais = ctx?.canais ?? []

  return (
    <DashboardLayout user={user} onLogout={logout} title="Feed de cortes">
      <div className="-mb-12 flex min-w-0 flex-col gap-3 lg:mb-0 lg:flex-row lg:items-start lg:gap-6">
        {/* Controles: no celular ficam em cima; no computador, numa coluna ao lado do palco. */}
        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-4 lg:w-72 lg:shrink-0">
          <div className="flex items-start gap-3">
            <span
              className="flex size-11 shrink-0 items-center justify-center rounded-xl text-white shadow-sm"
              style={{ background: `linear-gradient(135deg, ${CORACAO}, #8134AF)` }}
            >
              <IconCarouselVertical className="size-6" />
            </span>
            <div className="min-w-0">
              <h1 className="font-heading text-[1.4rem] font-semibold leading-tight tracking-[-0.03em]">Feed de cortes</h1>
              <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">Veja cada corte como ele aparece no celular. Gostou? Mande pra postar.</p>
            </div>
          </div>

          <div className="grid grid-cols-2 rounded-xl bg-muted p-1 text-sm font-medium">
            {(
              [
                ["todos", "Para você", null],
                ["gostei", "Gostei", ctx?.totalGostei ?? 0],
              ] as const
            ).map(([v, r, n]) => (
              <button
                key={v}
                type="button"
                onClick={() => setAba(v)}
                className={cn(
                  "inline-flex items-center justify-center gap-1.5 rounded-lg py-2 transition-colors",
                  aba === v ? "bg-card text-foreground shadow-[var(--shadow-flat)]" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {v === "gostei" && <IconHeartFilled className="size-4" style={{ color: CORACAO }} />}
                {r}
                {n !== null && <span className="font-mono text-xs text-muted-foreground">{n}</span>}
              </button>
            ))}
          </div>

          <div>
            <p className="mb-2 hidden px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">Canais</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:flex-col lg:gap-1 lg:overflow-visible lg:px-0">
              <FiltroCanal ativo={canal === "todos"} onClick={() => setCanal("todos")} nome="Todos os canais" />
              {canais.map((c) => (
                <FiltroCanal key={c.id} ativo={canal === String(c.id)} onClick={() => setCanal(String(c.id))} nome={c.nome} avatar={c.avatar} />
              ))}
              <FiltroCanal ativo={canal === "avulsos"} onClick={() => setCanal("avulsos")} nome="Envios avulsos" avulso />
            </div>
          </div>

          <p className="hidden items-center gap-2 px-1 text-xs text-muted-foreground lg:flex">
            <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">↑</kbd>
            <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">↓</kbd>
            passa de corte · <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">M</kbd> som
          </p>
        </aside>

        {/* O palco: rolagem vertical que para sempre num corte inteiro. */}
        <section className="relative min-w-0 flex-1">
          <div
            ref={palco}
            style={alturaMovel ? { height: alturaMovel } : undefined}
            className="h-[calc(100dvh-14rem)] min-h-[380px] snap-y snap-mandatory overflow-y-auto overscroll-contain rounded-2xl bg-[#0b0b0f] [scrollbar-width:none] lg:h-[calc(100dvh-7.5rem)] [&::-webkit-scrollbar]:hidden"
          >
            {!cortes ? (
              <div className="flex h-full items-center justify-center p-4">
                <Skeleton className="aspect-[9/16] h-full max-h-full bg-white/10" />
              </div>
            ) : cortes.length === 0 ? (
              <FeedVazio aba={aba} erro={erro} />
            ) : (
              cortes.map((c, i) => (
                <div key={c.id} data-indice={i} className="flex h-full snap-start snap-always items-center justify-center gap-4 p-2 sm:p-4">
                  <ItemDoFeed
                    corte={c}
                    ativo={i === ativo}
                    perto={Math.abs(i - ativo) <= 1}
                    mudo={mudo}
                    contas={ctx?.contas ?? []}
                    onMudo={() => setMudo((m) => !m)}
                    onGostei={(v) => void alternarGostei(c, v)}
                    onEnviar={() => setEnviando(c)}
                  />
                </div>
              ))
            )}
            {carregandoMais && (
              <div className="flex h-16 snap-start items-center justify-center text-xs text-white/60">Carregando mais cortes...</div>
            )}
          </div>

          {/* Setas no computador, fora do vídeo. */}
          {cortes && cortes.length > 1 && (
            <div className="absolute right-3 top-1/2 hidden -translate-y-1/2 flex-col gap-2 xl:flex">
              <button
                type="button"
                aria-label="Corte anterior"
                disabled={ativo === 0}
                onClick={() => irPara(ativo - 1)}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-30"
              >
                <IconChevronUp className="size-5" />
              </button>
              <button
                type="button"
                aria-label="Próximo corte"
                disabled={ativo >= cortes.length - 1}
                onClick={() => irPara(ativo + 1)}
                className="flex size-10 items-center justify-center rounded-full bg-white/10 text-white backdrop-blur transition hover:bg-white/20 disabled:opacity-30"
              >
                <IconChevronDown className="size-5" />
              </button>
            </div>
          )}
        </section>
      </div>

      <EnviarCorteDialog
        corte={enviando}
        contas={ctx?.contas ?? []}
        onFechar={() => setEnviando(null)}
        onEnviado={(id, resultados) =>
          setCortes(
            (l) =>
              l?.map((x) =>
                x.id === id
                  ? {
                      ...x,
                      postagens: [
                        ...x.postagens.filter((p) => !resultados.some((r) => r.accountId === p.accountId)),
                        ...resultados.map((r) => ({
                          accountId: r.accountId,
                          status: r.resultado === "ja_publicado" ? "posted" : "pending",
                          scheduledFor: r.scheduledFor,
                          postedAt: null,
                        })),
                      ],
                    }
                  : x,
              ) ?? null,
          )
        }
      />
    </DashboardLayout>
  )
}

function FiltroCanal({ ativo, onClick, nome, avatar, avulso }: { ativo: boolean; onClick: () => void; nome: string; avatar?: string | null; avulso?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "flex shrink-0 items-center gap-2 rounded-full border py-1 pl-1 pr-3 text-sm transition-colors lg:rounded-lg lg:py-1.5",
        ativo ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted",
      )}
    >
      {avulso ? (
        <span className="flex size-6 items-center justify-center rounded-full bg-tone-cyan-wash text-tone-cyan-ink">
          <IconUpload className="size-3.5" />
        </span>
      ) : avatar !== undefined ? (
        <Avatar className="size-6">
          {avatar && <AvatarImage src={avatar} alt="" />}
          <AvatarFallback className="text-[9px] text-foreground">{nome.slice(0, 2).toUpperCase()}</AvatarFallback>
        </Avatar>
      ) : (
        <span
          className="flex size-6 items-center justify-center rounded-full text-white"
          style={{ background: `linear-gradient(135deg, ${CORACAO}, #8134AF)` }}
        >
          <IconCarouselVertical className="size-3.5" />
        </span>
      )}
      <span className="max-w-[10rem] truncate lg:max-w-none">{nome}</span>
    </button>
  )
}

function FeedVazio({ aba, erro }: { aba: Aba; erro: string | null }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center text-white">
      <span className="flex size-14 items-center justify-center rounded-2xl bg-white/10">
        {aba === "gostei" ? <IconHeart className="size-7" /> : <IconCarouselVertical className="size-7" />}
      </span>
      <p className="font-medium">{erro ?? (aba === "gostei" ? "Nenhum corte marcado ainda" : "Nenhum corte pronto por aqui")}</p>
      <p className="max-w-xs text-sm text-white/60">
        {aba === "gostei"
          ? "Toque no coração (ou dê dois toques no vídeo) nos cortes que você gostar. Eles ficam guardados aqui."
          : "Os cortes aparecem aqui assim que ficam prontos. Conecte um canal ou envie um vídeo em Vídeos do YouTube."}
      </p>
      {aba !== "gostei" && (
        <Button asChild size="sm" className="mt-1 bg-white text-black hover:bg-white/90">
          <a href="/client/youtube">Ir para Vídeos do YouTube</a>
        </Button>
      )}
    </div>
  )
}

function ItemDoFeed({
  corte,
  ativo,
  perto,
  mudo,
  contas,
  onMudo,
  onGostei,
  onEnviar,
}: {
  corte: Corte
  ativo: boolean
  perto: boolean
  mudo: boolean
  contas: Conta[]
  onMudo: () => void
  onGostei: (v?: boolean) => void
  onEnviar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [pausado, setPausado] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [coracao, setCoracao] = useState(0)
  const [legendaAberta, setLegendaAberta] = useState(false)

  useEffect(() => {
    const v = video.current
    if (!v) return
    if (ativo) {
      v.play().then(() => setPausado(false)).catch(() => setPausado(true))
    } else {
      v.pause()
    }
  }, [ativo])

  function tocarOuPausar() {
    const v = video.current
    if (!v) return
    if (v.paused) {
      void v.play()
      setPausado(false)
    } else {
      v.pause()
      setPausado(true)
    }
  }

  // Dois toques = gostei, como nos apps. Sempre MARCA (nunca desmarca): é o
  // gesto de "amei", e desmarcar sem querer seria pior que marcar duas vezes.
  function doisToques() {
    onGostei(true)
    setCoracao((n) => n + 1)
  }

  // Um toque pausa, dois toques curtem. O toque único espera um instante pra
  // ver se vem o segundo: pausar na hora faria o botão de "tocar" aparecer
  // por cima do vídeo e o segundo toque cairia nele, nunca virando "gostei".
  const ultimoToque = useRef(0)
  const esperaDoToque = useRef<number | undefined>(undefined)
  function toque() {
    const agora = Date.now()
    if (agora - ultimoToque.current < 320) {
      window.clearTimeout(esperaDoToque.current)
      ultimoToque.current = 0
      doisToques()
      return
    }
    ultimoToque.current = agora
    esperaDoToque.current = window.setTimeout(tocarOuPausar, 320)
  }
  useEffect(() => () => window.clearTimeout(esperaDoToque.current), [])

  const naFila = corte.postagens.filter((p) => ["pending", "queued", "processing"].includes(p.status))
  const publicadas = corte.postagens.filter((p) => p.status === "posted")
  const nomeConta = (id: number) => contas.find((c) => c.rede === "tiktok" && c.id === id)?.nome ?? "conta"
  const canalNome = corte.origem.canalNome ?? "Envio avulso"

  const acoes = (dentro: boolean) => (
    <div className={cn("flex flex-col items-center gap-4", dentro ? "text-white" : "text-foreground")}>
      <BotaoDeAcao
        rotulo={corte.gostei ? "Gostei" : "Gostar"}
        dentro={dentro}
        onClick={() => onGostei()}
        destaque={corte.gostei}
        icone={corte.gostei ? <IconHeartFilled className="size-6" style={{ color: CORACAO }} /> : <IconHeart className="size-6" />}
      />
      <BotaoDeAcao rotulo="Postar" dentro={dentro} onClick={onEnviar} icone={<IconSend className="size-6" />} cor />
      <BotaoDeAcao
        rotulo="Baixar"
        dentro={dentro}
        href={corte.videoUrl}
        icone={<IconDownload className="size-6" />}
      />
      <BotaoDeAcao rotulo={mudo ? "Sem som" : "Som"} dentro={dentro} onClick={onMudo} icone={mudo ? <IconVolumeOff className="size-6" /> : <IconVolume className="size-6" />} />
    </div>
  )

  return (
    <>
      <div
        className="relative aspect-[9/16] h-full max-h-full max-w-full touch-manipulation select-none overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10"
      >
        <video
          ref={video}
          src={perto ? corte.videoUrl : undefined}
          poster={corte.capaUrl ?? undefined}
          muted={mudo}
          loop
          playsInline
          preload={ativo ? "auto" : "metadata"}
          onClick={toque}
          onTimeUpdate={(e) => {
            const v = e.currentTarget
            if (v.duration) setProgresso(v.currentTime / v.duration)
          }}
          className="h-full w-full cursor-pointer object-cover"
        />

        {pausado && (
          <button type="button" aria-label="Tocar" onClick={toque} className="absolute inset-0 flex items-center justify-center">
            <span className="flex size-16 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur">
              <IconPlayerPlayFilled className="size-8" />
            </span>
          </button>
        )}

        {coracao > 0 && (
          <span key={coracao} aria-hidden className="feed-coracao pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <IconHeartFilled className="size-24 drop-shadow-lg" style={{ color: CORACAO }} />
          </span>
        )}

        {/* Onde o corte já está: na fila ou publicado. */}
        {(naFila.length > 0 || publicadas.length > 0) && (
          <div className="absolute left-3 right-3 top-3 flex flex-wrap gap-1.5">
            {publicadas.map((p) => (
              <span key={`p${p.accountId}`} className="inline-flex items-center gap-1 rounded-full bg-tone-success-ink/90 px-2 py-1 text-[11px] font-semibold text-white backdrop-blur">
                <IconCheck className="size-3" /> Publicado em {nomeConta(p.accountId)}
              </span>
            ))}
            {naFila.map((p) => (
              <span key={`f${p.accountId}`} className="inline-flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[11px] font-medium text-white backdrop-blur">
                <IconClock className="size-3" /> Na fila de {nomeConta(p.accountId)}
                {p.scheduledFor ? ` · ${dataHora(p.scheduledFor)}` : ""}
              </span>
            ))}
          </div>
        )}

        {/* Informações por cima do vídeo, como no app. */}
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 via-black/40 to-transparent px-3.5 pb-4 pt-24 text-white">
          <div className="pointer-events-auto pr-14 lg:pr-0">
            <div className="flex items-center gap-2">
              <Avatar className="size-8 ring-2 ring-white/80">
                {corte.origem.canalAvatar && <AvatarImage src={corte.origem.canalAvatar} alt="" />}
                <AvatarFallback className="bg-white/20 text-[10px] text-white">{canalNome.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="truncate text-sm font-semibold">{canalNome}</span>
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10.5px]">{mmss(corte.duracaoSegundos)}</span>
            </div>
            <p className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">{corte.titulo}</p>
            {corte.legenda && (
              <button
                type="button"
                onClick={() => setLegendaAberta((v) => !v)}
                className={cn("mt-1 block text-left text-[13px] leading-snug text-white/85", legendaAberta ? "" : "line-clamp-2")}
              >
                {corte.legenda}
              </button>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70">
              <IconMusic className="size-3.5 shrink-0" />
              <span className="truncate">Do vídeo: {corte.origem.titulo}</span>
            </p>
          </div>
        </div>

        {/* Ações dentro do vídeo no celular; no computador elas ficam ao lado. */}
        <div className="absolute bottom-24 right-2 lg:hidden">{acoes(true)}</div>

        <div className="absolute inset-x-0 bottom-0 h-[3px] bg-white/15">
          <div className="h-full bg-white" style={{ width: `${progresso * 100}%` }} />
        </div>
      </div>
      <div className="hidden self-end pb-6 lg:block">{acoes(false)}</div>
    </>
  )
}

function BotaoDeAcao({
  rotulo,
  icone,
  onClick,
  href,
  dentro,
  destaque,
  cor,
}: {
  rotulo: string
  icone: ReactNode
  onClick?: () => void
  href?: string
  dentro: boolean
  destaque?: boolean
  cor?: boolean
}) {
  const classe = cn(
    "flex size-12 items-center justify-center rounded-full transition active:scale-90",
    cor
      ? "text-white shadow-lg"
      : dentro
        ? "bg-black/35 text-white backdrop-blur hover:bg-black/50"
        : destaque
          ? "bg-[#FE2C55]/12"
          : "bg-white/10 text-white hover:bg-white/20",
  )
  const estilo = cor ? { background: "linear-gradient(135deg, #FE2C55, #8134AF)" } : undefined
  const conteudo = (
    <>
      {href ? (
        <a href={href} download className={classe} style={estilo} aria-label={rotulo}>
          {icone}
        </a>
      ) : (
        <button type="button" onClick={onClick} className={classe} style={estilo} aria-label={rotulo} aria-pressed={destaque}>
          {icone}
        </button>
      )}
      <span className={cn("text-[11px] font-medium", dentro ? "text-white drop-shadow" : "text-white/80")}>{rotulo}</span>
    </>
  )
  return <div className="flex flex-col items-center gap-1">{conteudo}</div>
}

function EnviarCorteDialog({
  corte,
  contas,
  onFechar,
  onEnviado,
}: {
  corte: Corte | null
  contas: Conta[]
  onFechar: () => void
  onEnviado: (id: number, resultados: Resultado[]) => void
}) {
  const [marcadas, setMarcadas] = useState<Set<number>>(new Set())
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [resultados, setResultados] = useState<Resultado[] | null>(null)

  useEffect(() => {
    if (!corte) return
    setErro(null)
    setResultados(null)
    // Já marca as contas onde o corte ainda não está: é o que a pessoa quer na
    // maioria das vezes ("manda pra minhas redes").
    const tiktok = contas.filter((c) => c.rede === "tiktok" && c.disponivel)
    const livres = tiktok.filter((c) => !corte.postagens.some((p) => p.accountId === c.id && p.status !== "skipped"))
    setMarcadas(new Set((tiktok.length === 1 ? tiktok : livres).map((c) => c.id)))
  }, [corte, contas])

  async function enviar() {
    if (!corte) return
    setEnviando(true)
    setErro(null)
    try {
      const r = await api.post<{ resultados: Resultado[] }>(`/api/client/feed/cortes/${corte.id}/enviar`, {
        tiktokAccountIds: [...marcadas],
      })
      setResultados(r.resultados)
      onEnviado(corte.id, r.resultados)
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível enviar o corte.")
    } finally {
      setEnviando(false)
    }
  }

  const grupos: { rede: Conta["rede"]; nome: string }[] = [
    { rede: "tiktok", nome: "TikTok" },
    { rede: "instagram", nome: "Instagram" },
    { rede: "facebook", nome: "Facebook" },
  ]
  const semConta = contas.length === 0

  return (
    <Dialog open={corte !== null} onOpenChange={(a) => !a && onFechar()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{resultados ? "Enviado para a fila" : "Postar este corte"}</DialogTitle>
          <DialogDescription className="line-clamp-2">{corte?.titulo}</DialogDescription>
        </DialogHeader>

        {resultados ? (
          <div className="flex flex-col gap-2">
            {resultados.map((r) => (
              <div key={r.accountId} className="flex items-start gap-3 rounded-lg border border-border p-3">
                <span
                  className={cn(
                    "mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full text-white",
                    r.resultado === "enfileirado" ? "bg-tone-success-ink" : "bg-muted-foreground/60",
                  )}
                >
                  <IconCheck className="size-3.5" />
                </span>
                <div className="min-w-0 text-sm">
                  <p className="font-medium">{r.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {r.resultado === "enfileirado"
                      ? `Entrou na fila${r.scheduledFor ? `, previsto para ${dataHora(r.scheduledFor)}` : ""}.`
                      : r.resultado === "ja_publicado"
                        ? "Este corte já foi publicado nesta conta."
                        : `Já estava na fila${r.scheduledFor ? ` (${dataHora(r.scheduledFor)})` : ""}.`}
                  </p>
                </div>
              </div>
            ))}
            <p className="text-xs text-muted-foreground">
              A ordem e os horários da fila você ajusta em{" "}
              <a href="/client/social?rede=tiktok" className="font-medium text-foreground underline underline-offset-2">
                Redes sociais
              </a>
              .
            </p>
          </div>
        ) : semConta ? (
          <div className="rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-sm font-medium">Nenhuma rede conectada</p>
            <p className="mt-1 text-xs text-muted-foreground">Conecte uma conta pra mandar seus cortes pra fila de publicação.</p>
            <Button asChild size="sm" className="mt-3">
              <a href="/client/social">Conectar redes sociais</a>
            </Button>
          </div>
        ) : (
          <div className="flex max-h-[55vh] flex-col gap-4 overflow-y-auto">
            {grupos.map((g) => {
              const doGrupo = contas.filter((c) => c.rede === g.rede)
              if (doGrupo.length === 0) return null
              const Icone = REDE_ICONE[g.rede]
              return (
                <div key={g.rede} className="flex flex-col gap-1.5">
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
                    <span className="flex size-5 items-center justify-center rounded-md text-white" style={{ background: REDE_FUNDO[g.rede] }}>
                      <Icone className="size-3" />
                    </span>
                    {g.nome}
                    {!doGrupo[0].disponivel && <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium">publicação em breve</span>}
                  </p>
                  {doGrupo.map((c) => {
                    const ja = corte?.postagens.find((p) => p.accountId === c.id && c.rede === "tiktok" && p.status !== "skipped")
                    const marcada = marcadas.has(c.id) && c.disponivel
                    return (
                      <label
                        key={`${c.rede}${c.id}`}
                        className={cn(
                          "flex items-center gap-3 rounded-lg border px-3 py-2.5 transition-colors",
                          !c.disponivel ? "cursor-not-allowed opacity-55" : "cursor-pointer",
                          marcada ? "border-foreground bg-muted/50" : "border-border",
                        )}
                      >
                        <Checkbox
                          checked={marcada}
                          disabled={!c.disponivel}
                          onCheckedChange={(v) =>
                            setMarcadas((prev) => {
                              const n = new Set(prev)
                              if (v === true) n.add(c.id)
                              else n.delete(c.id)
                              return n
                            })
                          }
                        />
                        <Avatar className="size-8">
                          {c.avatar && <AvatarImage src={c.avatar} alt="" />}
                          <AvatarFallback className="text-[10px]">{(c.nome || "?").slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{c.nome}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">
                            {!c.disponivel
                              ? "A publicação nesta rede chega na próxima atualização."
                              : ja
                                ? ja.status === "posted"
                                  ? "Já publicado nesta conta"
                                  : `Já está na fila${ja.scheduledFor ? ` · ${dataHora(ja.scheduledFor)}` : ""}`
                                : c.publicaSozinho
                                  ? "Entra na fila e sai no próximo horário livre"
                                  : "Entra na fila; a publicação automática desta conta está desligada"}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )
            })}
          </div>
        )}

        {erro && <p className="rounded-md bg-tone-danger-wash px-3 py-2 text-sm text-tone-danger-ink">{erro}</p>}

        <DialogFooter>
          {resultados || semConta ? (
            <Button onClick={onFechar}>Fechar</Button>
          ) : (
            <>
              <Button variant="outline" onClick={onFechar}>
                Cancelar
              </Button>
              <Button
                disabled={enviando || marcadas.size === 0}
                onClick={enviar}
                className="gap-1.5 border-0 text-white hover:opacity-90"
                style={{ background: "linear-gradient(135deg, #FE2C55, #8134AF)" }}
              >
                <IconSend className="size-4" />
                {enviando ? "Enviando..." : marcadas.size > 1 ? `Enviar para ${marcadas.size} contas` : "Enviar para a fila"}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
