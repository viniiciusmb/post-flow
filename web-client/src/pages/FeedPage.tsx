import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  IconArrowsSort,
  IconBrandFacebook,
  IconBrandInstagram,
  IconBrandTiktok,
  IconBrandTwitch,
  IconBrandYoutubeFilled,
  IconBroadcast,
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
  chave: string
  tipo: "youtube" | "live"
  id: number
  titulo: string | null
  legenda: string | null
  duracaoSegundos: number
  criadoEm: string
  videoUrl: string
  capaUrl: string | null
  downloadUrl: string
  origem: { titulo: string | null; canalId: number | null; canalNome: string | null; canalAvatar: string | null; plataforma: string | null }
  gostei: boolean
  postagens: Postagem[]
}
type Conta = { id: number; rede: "tiktok" | "instagram" | "facebook"; nome: string; avatar: string | null; publicaSozinho: boolean; disponivel: boolean }
type Canal = { chave: string; tipo: "youtube" | "live"; id: number; nome: string; avatar: string | null; plataforma: string | null }
type Contexto = { canais: Canal[]; contas: Conta[]; totalGostei: number }
type Aba = "todos" | "gostei"
type Origem = "todos" | "youtube" | "lives"
type Ordem = "recentes" | "antigos"
type Resultado = { accountId: number; nome: string; resultado: "enfileirado" | "ja_na_fila" | "ja_publicado" | "ja_existia"; scheduledFor: string | null }

// Cores de ação do feed. O vermelho do "gostei" é o mesmo coração de rede
// social que todo mundo reconhece; o resto da tela fica escura de propósito,
// pra quem olha ver o corte como ele aparece no celular de quem assiste.
const CORACAO = "#FE2C55"
const YT = "#FF0033"
const TWITCH = "#9146FF"
const REDE_FUNDO: Record<Conta["rede"], string> = {
  tiktok: "linear-gradient(135deg, #111 0%, #111 55%, #25F4EE 140%)",
  instagram: "linear-gradient(45deg, #F58529 0%, #DD2A7B 45%, #8134AF 75%, #515BD4 100%)",
  facebook: "#1877F2",
}
const REDE_ICONE = { tiktok: IconBrandTiktok, instagram: IconBrandInstagram, facebook: IconBrandFacebook }

function mmss(s: number) {
  return `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`
}

function lerUrl(): { aba: Aba; canal: string; origem: Origem; ordem: Ordem } {
  const p = new URLSearchParams(window.location.search)
  const origem = p.get("origem")
  return {
    aba: p.get("aba") === "gostei" ? "gostei" : "todos",
    canal: p.get("canal") || "todos",
    origem: origem === "youtube" || origem === "lives" ? origem : "todos",
    ordem: p.get("ordem") === "antigos" ? "antigos" : "recentes",
  }
}

function SegmentoBotao({ ativo, onClick, children }: { ativo: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={ativo}
      className={cn(
        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] transition-colors",
        ativo ? "bg-card font-medium text-foreground shadow-[var(--shadow-flat)]" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {children}
    </button>
  )
}

export function FeedPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const inicial = useMemo(lerUrl, [])
  const [aba, setAba] = useState<Aba>(inicial.aba)
  const [canal, setCanal] = useState(inicial.canal)
  const [origem, setOrigem] = useState<Origem>(inicial.origem)
  const [ordem, setOrdem] = useState<Ordem>(inicial.ordem)
  const [ctx, setCtx] = useState<Contexto | null>(null)
  const [cortes, setCortes] = useState<Corte[] | null>(null)
  const [proximo, setProximo] = useState<string | null>(null)
  const [carregandoMais, setCarregandoMais] = useState(false)
  const [ativo, setAtivo] = useState(0)
  // O navegador só deixa o vídeo tocar sozinho se começar MUDO. O som liga no
  // primeiro toque (no vídeo ou no botão de som) e vale pros próximos cortes.
  const [mudo, setMudo] = useState(true)
  const [enviando, setEnviando] = useState<Corte | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const palco = useRef<HTMLDivElement>(null)

  const consulta = useCallback(
    (depois?: string | null) => {
      const p = new URLSearchParams()
      if (origem !== "todos") p.set("origem", origem)
      if (canal !== "todos") p.set("canal", canal)
      if (ordem === "antigos") p.set("ordem", "antigos")
      if (aba === "gostei") p.set("aba", "gostei")
      if (depois) p.set("depois", depois)
      return `/api/client/feed${p.toString() ? `?${p}` : ""}`
    },
    [aba, canal, origem, ordem],
  )

  useEffect(() => {
    if (!user) return
    api.get<Contexto>("/api/client/feed/contexto").then(setCtx).catch(() => {})
  }, [user])

  // Trocar aba, origem, canal ou ordem recomeça a lista do topo.
  useEffect(() => {
    if (!user) return
    setCortes(null)
    setErro(null)
    setAtivo(0)
    palco.current?.scrollTo({ top: 0 })
    const url = consulta().replace("/api/client/feed", "/client/feed")
    window.history.replaceState(null, "", url)
    api
      .get<{ cortes: Corte[]; proximo: string | null }>(consulta())
      .then((d) => {
        setCortes(d.cortes)
        setProximo(d.proximo)
      })
      .catch((err) => {
        setCortes([])
        setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os cortes.")
      })
  }, [user, consulta])

  const carregarMais = useCallback(() => {
    if (!proximo || carregandoMais) return
    setCarregandoMais(true)
    api
      .get<{ cortes: Corte[]; proximo: string | null }>(consulta(proximo))
      .then((d) => {
        setCortes((atual) => [...(atual ?? []), ...d.cortes.filter((c) => !(atual ?? []).some((x) => x.chave === c.chave))])
        setProximo(d.proximo)
      })
      .finally(() => setCarregandoMais(false))
  }, [proximo, carregandoMais, consulta])

  // No feed, busca a próxima página quando faltam 3 cortes pro fim.
  useEffect(() => {
    if (aba !== "todos" || !cortes || ativo < cortes.length - 3) return
    carregarMais()
  }, [aba, ativo, cortes, carregarMais])

  // Qual corte está na tela: o que ocupa a maior parte do palco.
  useEffect(() => {
    const raiz = palco.current
    if (!raiz || !cortes?.length || aba !== "todos") return
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
  }, [cortes, aba])

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
  }, [ctx, user, aba, origem])

  function irPara(i: number) {
    const raiz = palco.current
    if (!raiz || !cortes) return
    const alvo = Math.max(0, Math.min(cortes.length - 1, i))
    raiz.querySelector<HTMLElement>(`[data-indice="${alvo}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  // Ligar/desligar o som mexe direto nos <video> AINDA DENTRO do clique: o
  // navegador só aceita som num gesto da pessoa, e uma mudança aplicada depois
  // (num efeito do React) às vezes chega tarde demais pra contar como gesto.
  function definirSom(ligado: boolean) {
    setMudo(!ligado)
    palco.current?.querySelectorAll("video").forEach((v) => {
      v.muted = !ligado
    })
  }

  // Setas do teclado (e J/K) passam de um corte pro outro, como no feed do app.
  useEffect(() => {
    function tecla(e: KeyboardEvent) {
      if (enviando || aba !== "todos") return
      const alvo = e.target as HTMLElement
      if (alvo && ["INPUT", "TEXTAREA", "SELECT"].includes(alvo.tagName)) return
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault()
        irPara(ativo + 1)
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault()
        irPara(ativo - 1)
      } else if (e.key === "m") {
        definirSom(mudo)
      }
    }
    window.addEventListener("keydown", tecla)
    return () => window.removeEventListener("keydown", tecla)
  })

  async function alternarGostei(c: Corte, valor = !c.gostei) {
    setCortes((l) => l?.map((x) => (x.chave === c.chave ? { ...x, gostei: valor } : x)) ?? null)
    try {
      const r = await api.put<{ gostei: boolean; totalGostei: number }>(`/api/client/feed/cortes/${c.tipo}/${c.id}/gostei`, { gostei: valor })
      setCtx((x) => (x ? { ...x, totalGostei: r.totalGostei } : x))
    } catch {
      setCortes((l) => l?.map((x) => (x.chave === c.chave ? { ...x, gostei: !valor } : x)) ?? null)
    }
  }

  if (authLoading || !user) return null

  // Os canais oferecidos seguem a origem escolhida: em "Lives" não faz
  // sentido listar canal do YouTube (e vice-versa).
  const canais = (ctx?.canais ?? []).filter((c) => origem === "todos" || (origem === "youtube" ? c.tipo === "youtube" : c.tipo === "live"))
  const escolherOrigem = (o: Origem) => {
    setOrigem(o)
    const atual = (ctx?.canais ?? []).find((c) => c.chave === canal)
    if ((canal === "avulsos" && o === "lives") || (atual && o !== "todos" && (o === "youtube") !== (atual.tipo === "youtube"))) setCanal("todos")
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title="Feed de cortes">
      <div className={cn("flex min-w-0 flex-col gap-3 lg:mb-0 lg:flex-row lg:items-start lg:gap-6", aba === "todos" && "-mb-12")}>
        {/* Controles: no celular ficam em cima; no computador, numa coluna ao lado. */}
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
              <p className="mt-0.5 hidden text-sm text-muted-foreground sm:block">
                Veja cada corte como ele aparece no celular. Gostou? Mande pra postar.
              </p>
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

          {/* Origem e ordem: lado a lado no celular, cada um no seu bloco no computador. */}
          <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 lg:grid-cols-1 lg:gap-3">
            <div className="min-w-0">
              <p className="mb-1.5 hidden px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">Origem</p>
              <div className="grid grid-cols-3 rounded-xl bg-muted p-1">
                <SegmentoBotao ativo={origem === "todos"} onClick={() => escolherOrigem("todos")}>
                  Todos
                </SegmentoBotao>
                <SegmentoBotao ativo={origem === "youtube"} onClick={() => escolherOrigem("youtube")}>
                  <IconBrandYoutubeFilled className="size-4 shrink-0" style={{ color: YT }} />
                  <span className="truncate">YouTube</span>
                </SegmentoBotao>
                <SegmentoBotao ativo={origem === "lives"} onClick={() => escolherOrigem("lives")}>
                  <IconBroadcast className="size-4 shrink-0" style={{ color: TWITCH }} />
                  <span className="truncate">Lives</span>
                </SegmentoBotao>
              </div>
            </div>
            <div>
              <p className="mb-1.5 hidden px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">Ordem</p>
              {/* No celular é um botão que alterna; no computador, as duas opções à vista. */}
              <button
                type="button"
                onClick={() => setOrdem((o) => (o === "recentes" ? "antigos" : "recentes"))}
                className="inline-flex h-full items-center gap-1.5 rounded-xl bg-muted px-2.5 text-[13px] font-medium lg:hidden"
                aria-label={ordem === "recentes" ? "Mostrando os mais recentes. Trocar para os mais antigos" : "Mostrando os mais antigos. Trocar para os mais recentes"}
              >
                <IconArrowsSort className="size-4" />
                {/* Só o ícone nas telas estreitas: a origem precisa do espaço. */}
                <span className="hidden min-[400px]:inline">{ordem === "recentes" ? "Recentes" : "Antigos"}</span>
              </button>
              <div className="hidden grid-cols-2 rounded-xl bg-muted p-1 lg:grid">
                <SegmentoBotao ativo={ordem === "recentes"} onClick={() => setOrdem("recentes")}>
                  Mais recentes
                </SegmentoBotao>
                <SegmentoBotao ativo={ordem === "antigos"} onClick={() => setOrdem("antigos")}>
                  Mais antigos
                </SegmentoBotao>
              </div>
            </div>
          </div>

          <div>
            <p className="mb-1.5 hidden px-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground lg:block">Canais</p>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 lg:mx-0 lg:max-h-[38vh] lg:flex-col lg:gap-1 lg:overflow-y-auto lg:overflow-x-visible lg:px-0">
              <FiltroCanal ativo={canal === "todos"} onClick={() => setCanal("todos")} nome="Todos os canais" />
              {canais.map((c) => (
                <FiltroCanal key={c.chave} ativo={canal === c.chave} onClick={() => setCanal(c.chave)} nome={c.nome} avatar={c.avatar} tipo={c.tipo} />
              ))}
              {origem !== "lives" && <FiltroCanal ativo={canal === "avulsos"} onClick={() => setCanal("avulsos")} nome="Envios avulsos" avulso />}
            </div>
          </div>

          {aba === "todos" && (
            <p className="hidden items-center gap-2 px-1 text-xs text-muted-foreground lg:flex">
              <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">↑</kbd>
              <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">↓</kbd>
              passa de corte · <kbd className="rounded border border-border bg-card px-1.5 font-mono text-[10px]">M</kbd> som
            </p>
          )}
        </aside>

        {aba === "gostei" ? (
          <GradeGostei
            cortes={cortes}
            erro={erro}
            temMais={!!proximo}
            carregandoMais={carregandoMais}
            onMais={carregarMais}
            contas={ctx?.contas ?? []}
            onGostei={(c, v) => void alternarGostei(c, v)}
            onEnviar={setEnviando}
          />
        ) : (
          /* O palco: rolagem vertical que para sempre num corte inteiro. */
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
                  <div key={c.chave} data-indice={i} className="flex h-full snap-start snap-always items-center justify-center gap-4 p-2 sm:p-4">
                    <ItemDoFeed
                      corte={c}
                      ativo={i === ativo}
                      perto={Math.abs(i - ativo) <= 1}
                      mudo={mudo}
                      contas={ctx?.contas ?? []}
                      onSom={definirSom}
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
        )}
      </div>

      <EnviarCorteDialog
        corte={enviando}
        contas={ctx?.contas ?? []}
        onFechar={() => setEnviando(null)}
        onEnviado={(chave, resultados) =>
          setCortes(
            (l) =>
              l?.map((x) =>
                x.chave === chave
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

function FiltroCanal({
  ativo,
  onClick,
  nome,
  avatar,
  avulso,
  tipo,
}: {
  ativo: boolean
  onClick: () => void
  nome: string
  avatar?: string | null
  avulso?: boolean
  tipo?: "youtube" | "live"
}) {
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
        <span className="relative shrink-0">
          <Avatar className="size-6">
            {avatar && <AvatarImage src={avatar} alt="" />}
            <AvatarFallback className="text-[9px] text-foreground">{nome.slice(0, 2).toUpperCase()}</AvatarFallback>
          </Avatar>
          {/* Selo da origem do canal: YouTube ou live da Twitch. */}
          <span
            className="absolute -bottom-0.5 -right-1 flex size-3.5 items-center justify-center rounded-full text-white ring-2 ring-card"
            style={{ background: tipo === "live" ? TWITCH : YT }}
          >
            {tipo === "live" ? <IconBrandTwitch className="size-2" /> : <IconBrandYoutubeFilled className="size-2" />}
          </span>
        </span>
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
      <p className="font-medium">{erro ?? (aba === "gostei" ? "Nenhum corte marcado ainda" : "Nenhum corte por aqui")}</p>
      <p className="max-w-xs text-sm text-white/60">
        {aba === "gostei"
          ? "Toque no coração (ou dê dois toques no vídeo) nos cortes que você gostar. Eles ficam guardados aqui."
          : "Os cortes aparecem aqui assim que ficam prontos. Troque a origem ou o canal nos filtros, ou conecte um canal em Vídeos do YouTube."}
      </p>
    </div>
  )
}

/** Nome do canal e de onde o corte veio, iguais no feed e na grade. */
function deOnde(c: Corte) {
  const canal = c.origem.canalNome ?? (c.tipo === "live" ? "Live" : "Envio avulso")
  const linha = c.tipo === "live" ? `Da live de ${canal}` : `Do vídeo: ${c.origem.titulo ?? ""}`
  return { canal, linha }
}

function SeloDeOrigem({ tipo, claro = false }: { tipo: Corte["tipo"]; claro?: boolean }) {
  return tipo === "live" ? (
    <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-white" style={{ background: TWITCH }}>
      <IconBroadcast className="size-3" /> Live
    </span>
  ) : (
    <span
      className={cn("inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold", claro ? "bg-white/15 text-white" : "bg-[#FF0033]/10 text-[#E0002D]")}
      title="Corte de vídeo do YouTube"
    >
      <IconBrandYoutubeFilled className="size-3" style={{ color: claro ? "#fff" : YT }} />
      {/* Só o ícone no celular, onde o nome do canal precisa do espaço. */}
      <span className="hidden sm:inline">YouTube</span>
    </span>
  )
}

function ItemDoFeed({
  corte,
  ativo,
  perto,
  mudo,
  contas,
  onSom,
  onGostei,
  onEnviar,
}: {
  corte: Corte
  ativo: boolean
  perto: boolean
  mudo: boolean
  contas: Conta[]
  onSom: (ligado: boolean) => void
  onGostei: (v?: boolean) => void
  onEnviar: () => void
}) {
  const video = useRef<HTMLVideoElement>(null)
  const [pausado, setPausado] = useState(false)
  const [progresso, setProgresso] = useState(0)
  const [coracao, setCoracao] = useState(0)
  const [legendaAberta, setLegendaAberta] = useState(false)

  // O atributo `muted` do React só vale na primeira pintura; depois disso
  // quem manda é a propriedade do elemento. Sem isto, o vídeo que entra na
  // tela depois de o som ser ligado continuaria mudo.
  useEffect(() => {
    if (video.current) video.current.muted = mudo
  }, [mudo, perto])

  useEffect(() => {
    const v = video.current
    if (!v) return
    if (ativo) {
      v.muted = mudo
      v.play().then(() => setPausado(false)).catch(() => setPausado(true))
    } else {
      v.pause()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Um toque: se ainda está mudo, LIGA O SOM (é o que a pessoa quer quando
  // toca no primeiro vídeo); depois disso, pausa e continua. Dois toques
  // curtem. O toque único espera um instante pra ver se vem o segundo.
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
    if (mudo) {
      // Ligar o som tem que acontecer AGORA, dentro do toque - adiar faria o
      // navegador recusar o som (não contaria mais como gesto da pessoa).
      onSom(true)
      if (video.current?.paused) void video.current.play()
      setPausado(false)
      return
    }
    esperaDoToque.current = window.setTimeout(tocarOuPausar, 320)
  }
  useEffect(() => () => window.clearTimeout(esperaDoToque.current), [])

  const naFila = corte.postagens.filter((p) => ["pending", "queued", "processing"].includes(p.status))
  const publicadas = corte.postagens.filter((p) => p.status === "posted")
  const nomeConta = (id: number) => contas.find((c) => c.rede === "tiktok" && c.id === id)?.nome ?? "conta"
  const { canal: canalNome, linha } = deOnde(corte)

  const acoes = (dentro: boolean) => (
    <div className="flex flex-col items-center gap-4">
      <BotaoDeAcao
        rotulo={corte.gostei ? "Gostei" : "Gostar"}
        dentro={dentro}
        onClick={() => onGostei()}
        destaque={corte.gostei}
        icone={corte.gostei ? <IconHeartFilled className="size-6" style={{ color: CORACAO }} /> : <IconHeart className="size-6" />}
      />
      <BotaoDeAcao rotulo="Postar" dentro={dentro} onClick={onEnviar} icone={<IconSend className="size-6" />} cor />
      <BotaoDeAcao rotulo="Baixar" dentro={dentro} href={corte.downloadUrl} icone={<IconDownload className="size-6" />} />
      <BotaoDeAcao
        rotulo={mudo ? "Sem som" : "Som"}
        dentro={dentro}
        onClick={() => onSom(mudo)}
        icone={mudo ? <IconVolumeOff className="size-6" /> : <IconVolume className="size-6" />}
      />
    </div>
  )

  return (
    <>
      <div className="relative aspect-[9/16] h-full max-h-full max-w-full touch-manipulation select-none overflow-hidden rounded-2xl bg-black shadow-2xl ring-1 ring-white/10">
        <video
          ref={video}
          src={perto ? corte.videoUrl : undefined}
          poster={corte.capaUrl ?? undefined}
          muted
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

        {/* Enquanto estiver mudo, avisa onde tocar pra ouvir. */}
        {ativo && mudo && !pausado && (
          <button
            type="button"
            onClick={() => onSom(true)}
            className="absolute left-1/2 top-[38%] flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-full bg-black/60 px-3.5 py-2 text-xs font-semibold text-white backdrop-blur sm:gap-2 sm:px-4 sm:py-2.5 sm:text-sm"
          >
            <IconVolumeOff className="size-5" /> Toque para ouvir
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
            <div className="flex min-w-0 items-center gap-2">
              <Avatar className="size-8 shrink-0 ring-2 ring-white/80">
                {corte.origem.canalAvatar && <AvatarImage src={corte.origem.canalAvatar} alt="" />}
                <AvatarFallback className="bg-white/20 text-[10px] text-white">{canalNome.slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <span className="min-w-0 truncate text-sm font-semibold">{canalNome}</span>
              <SeloDeOrigem tipo={corte.tipo} claro />
              <span className="shrink-0 rounded bg-white/15 px-1.5 py-0.5 font-mono text-[10.5px]">{mmss(corte.duracaoSegundos)}</span>
            </div>
            {corte.titulo && <p className="mt-2 line-clamp-2 text-[15px] font-semibold leading-snug">{corte.titulo}</p>}
            {corte.legenda && corte.legenda !== corte.titulo && (
              <button
                type="button"
                onClick={() => setLegendaAberta((v) => !v)}
                className={cn("mt-1 block text-left text-[13px] leading-snug text-white/85", legendaAberta ? "" : "line-clamp-2")}
              >
                {corte.legenda}
              </button>
            )}
            <p className="mt-2 flex items-center gap-1.5 text-xs text-white/70">
              {corte.tipo === "live" ? <IconBroadcast className="size-3.5 shrink-0" /> : <IconMusic className="size-3.5 shrink-0" />}
              <span className="truncate">{linha}</span>
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

/**
 * "Gostei" como lista normal de cortes, não como feed: quem abre essa aba quer
 * ver tudo que separou de uma vez e decidir o que postar, não rolar um por um.
 */
function GradeGostei({
  cortes,
  erro,
  temMais,
  carregandoMais,
  onMais,
  contas,
  onGostei,
  onEnviar,
}: {
  cortes: Corte[] | null
  erro: string | null
  temMais: boolean
  carregandoMais: boolean
  onMais: () => void
  contas: Conta[]
  onGostei: (c: Corte, v: boolean) => void
  onEnviar: (c: Corte) => void
}) {
  const [aberto, setAberto] = useState<Corte | null>(null)
  const nomeConta = (id: number) => contas.find((c) => c.rede === "tiktok" && c.id === id)?.nome ?? "conta"

  if (!cortes) {
    return (
      <section className="grid min-w-0 flex-1 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="aspect-[9/16] rounded-xl" />
        ))}
      </section>
    )
  }
  if (cortes.length === 0) {
    return (
      <section className="min-w-0 flex-1 rounded-2xl bg-[#0b0b0f] py-10">
        <FeedVazio aba="gostei" erro={erro} />
      </section>
    )
  }

  return (
    <section className="flex min-w-0 flex-1 flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">
        {cortes.map((c) => {
          const { canal } = deOnde(c)
          const naFila = c.postagens.filter((p) => ["pending", "queued", "processing"].includes(p.status))
          const publicadas = c.postagens.filter((p) => p.status === "posted")
          return (
            <article key={c.chave} className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-[var(--shadow-flat)]">
              <button type="button" onClick={() => setAberto(c)} className="group relative aspect-[9/16] w-full overflow-hidden bg-black" aria-label={`Assistir ${c.titulo ?? "corte"}`}>
                {c.capaUrl ? (
                  <img src={c.capaUrl} alt="" loading="lazy" className="h-full w-full object-cover transition group-hover:scale-[1.02]" />
                ) : (
                  <video src={`${c.videoUrl}#t=1`} muted playsInline preload="metadata" className="h-full w-full object-cover" />
                )}
                <span className="absolute inset-0 flex items-center justify-center opacity-0 transition group-hover:opacity-100">
                  <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
                    <IconPlayerPlayFilled className="size-6" />
                  </span>
                </span>
                <span className="absolute left-2 top-2">
                  <SeloDeOrigem tipo={c.tipo} claro />
                </span>
                <span className="absolute right-2 top-2 rounded bg-black/60 px-1.5 py-0.5 font-mono text-[10.5px] text-white">{mmss(c.duracaoSegundos)}</span>
                {(publicadas.length > 0 || naFila.length > 0) && (
                  <span
                    className={cn(
                      "absolute bottom-2 left-2 right-2 truncate rounded-full px-2 py-1 text-left text-[10.5px] font-semibold text-white backdrop-blur",
                      publicadas.length ? "bg-tone-success-ink/90" : "bg-black/60",
                    )}
                  >
                    {publicadas.length ? `Publicado em ${nomeConta(publicadas[0].accountId)}` : `Na fila de ${nomeConta(naFila[0].accountId)}`}
                  </span>
                )}
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-1 p-2.5">
                <p className="line-clamp-2 text-[13px] font-semibold leading-snug">{c.titulo ?? "Corte"}</p>
                <p className="truncate text-[11px] text-muted-foreground">{canal}</p>
                <div className="mt-auto flex items-center gap-1 pt-1.5">
                  <button
                    type="button"
                    onClick={() => onGostei(c, !c.gostei)}
                    aria-label={c.gostei ? "Tirar dos que gostei" : "Gostar"}
                    aria-pressed={c.gostei}
                    className="flex size-8 items-center justify-center rounded-lg hover:bg-muted"
                  >
                    {c.gostei ? <IconHeartFilled className="size-4.5" style={{ color: CORACAO }} /> : <IconHeart className="size-4.5" />}
                  </button>
                  <a href={c.downloadUrl} download aria-label="Baixar" className="flex size-8 items-center justify-center rounded-lg hover:bg-muted">
                    <IconDownload className="size-4.5" />
                  </a>
                  <Button
                    size="sm"
                    onClick={() => onEnviar(c)}
                    className="ml-auto h-8 gap-1 border-0 px-2.5 text-xs text-white hover:opacity-90"
                    style={{ background: `linear-gradient(135deg, ${CORACAO}, #8134AF)` }}
                  >
                    <IconSend className="size-3.5" /> Postar
                  </Button>
                </div>
              </div>
            </article>
          )
        })}
      </div>
      {temMais && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={onMais} disabled={carregandoMais}>
            {carregandoMais ? "Carregando..." : "Carregar mais"}
          </Button>
        </div>
      )}

      <Dialog open={aberto !== null} onOpenChange={(a) => !a && setAberto(null)}>
        <DialogContent className="max-w-[min(26rem,calc(100vw-2rem))] gap-3 p-3 sm:p-4">
          <DialogHeader className="px-1">
            <DialogTitle className="line-clamp-2 pr-6 text-base">{aberto?.titulo ?? "Corte"}</DialogTitle>
            <DialogDescription className="truncate">{aberto ? deOnde(aberto).linha : ""}</DialogDescription>
          </DialogHeader>
          {aberto && (
            <video
              key={aberto.chave}
              src={aberto.videoUrl}
              poster={aberto.capaUrl ?? undefined}
              controls
              autoPlay
              playsInline
              className="mx-auto aspect-[9/16] max-h-[70vh] w-full rounded-xl bg-black object-contain"
            />
          )}
          {aberto && (
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" className="gap-1.5" onClick={() => { onGostei(aberto, !aberto.gostei); setAberto({ ...aberto, gostei: !aberto.gostei }) }}>
                {aberto.gostei ? <IconHeartFilled className="size-4" style={{ color: CORACAO }} /> : <IconHeart className="size-4" />}
                {aberto.gostei ? "Gostei" : "Gostar"}
              </Button>
              <Button asChild variant="outline" size="sm" className="gap-1.5">
                <a href={aberto.downloadUrl} download>
                  <IconDownload className="size-4" /> Baixar
                </a>
              </Button>
              <Button
                size="sm"
                className="ml-auto gap-1.5 border-0 text-white hover:opacity-90"
                style={{ background: `linear-gradient(135deg, ${CORACAO}, #8134AF)` }}
                onClick={() => {
                  const c = aberto
                  setAberto(null)
                  onEnviar(c)
                }}
              >
                <IconSend className="size-4" /> Postar
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
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
  return (
    <div className="flex flex-col items-center gap-1">
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
    </div>
  )
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
  onEnviado: (chave: string, resultados: Resultado[]) => void
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
      const r = await api.post<{ resultados: Resultado[] }>(`/api/client/feed/cortes/${corte.tipo}/${corte.id}/enviar`, {
        tiktokAccountIds: [...marcadas],
      })
      setResultados(r.resultados)
      onEnviado(corte.chave, r.resultados)
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
