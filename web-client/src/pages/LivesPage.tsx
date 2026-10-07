import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import {
  IconAdjustmentsHorizontal,
  IconAlertTriangle,
  IconBroadcast,
  IconCheck,
  IconChevronRight,
  IconClock,
  IconDownload,
  IconExternalLink,
  IconEye,
  IconLoader2,
  IconPlayerPlayFilled,
  IconPlus,
  IconScissors,
  IconSettings,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader, SectionLabel } from "@/components/dashboard/PageHeader"
import { EmptyState } from "@/components/dashboard/EmptyState"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { BarraDeQualidade, IconePlataforma, type Nivel, type Plataforma } from "@/components/lives/comum"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { cn } from "@/lib/utils"

// Tela "Lives" - a que vai pros clientes. A "Lives Admin" continua sendo onde
// se liga o módulo, se mexe nos limites do servidor e se vê o custo.
const API = "/api/client/lives"

type Opcoes = {
  usarEstiloDosVideos: boolean
  qualidade: number
  cameraModo: "ia" | "auto" | "desligado"
  cameraPosicao: "top" | "bottom"
  cameraAlturaPercent: number
  categorias: string[] | null
}

type Categoria = { id: string; nome: string; descricao: string }

type Canal = {
  id: number
  plataforma: Plataforma
  url: string
  login: string
  nome: string
  imagem: string | null
  aoVivo: boolean
  tituloDaLive: string | null
  jogo: string | null
  espectadores: number | null
  ultimaVezAoVivo: string | null
  gravacao: { sessaoId: number; desde: string; segundosGravados: number; bytes: number } | null
  cortesProntos: number
  cortesEmAndamento: number
  autoClipar: boolean
  clipandoEstaLive: boolean
  recebendoCortes: boolean
  creditosNestaLive: number
  semCredito: boolean
}

type Estado = {
  servicoAtivo: boolean
  plataformas: { id: Plataforma; nome: string; disponivel: boolean }[]
  canais: Canal[]
  opcoes: Opcoes
  niveis: Record<string, Nivel>
  categorias: Categoria[]
  creditos: { disponiveis: number; isento: boolean; minutosDeLivePorCredito: number; cliparAgora: number }
}

type Corte = {
  id: number
  canal: { id: number; login: string; nome: string; imagem: string | null; plataforma: Plataforma }
  origem: "triagem" | "sinal" | "clipar_agora"
  duracao: number
  titulo: string | null
  gancho: string | null
  nota: number | null
  categoria: string | null
  revisao: { veredito: "aprovado" | "corrigido" | "descartar" } | null
  status: "na_fila" | "renderizando" | "pronto" | "erro"
  progresso: number
  erro: string | null
  criadoEm: string
  temArquivo: boolean
  temCapa: boolean
}

// Corte pedido no botão não tem categoria (ninguém classificou): ganha uma
// prateleira própria em vez de cair em "Outros".
const MANUAIS = "manuais"

// Cor e fundo de cada plataforma (as marcas: roxo da Twitch, verde da Kick).
const MARCA: Record<Plataforma, { nome: string; faixa: string; selo: string }> = {
  twitch: {
    nome: "Twitch",
    faixa: "from-[#9146FF]/35 via-[#9146FF]/10 to-transparent",
    selo: "bg-[#9146FF] text-white",
  },
  kick: {
    nome: "Kick",
    faixa: "from-[#53FC18]/35 via-[#53FC18]/10 to-transparent",
    selo: "bg-[#0b0e0f] text-[#53FC18]",
  },
}

// ---------------------------------------------------------------- formatos

function duracaoCurta(segundos: number) {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h${String(m).padStart(2, "0")}`
  if (m) return `${m} min`
  return `${s}s`
}

function relogio(segundos: number) {
  const s = Math.max(0, Math.round(segundos))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

const compacto = new Intl.NumberFormat("pt-BR", { notation: "compact", maximumFractionDigits: 1 })
const relativo = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" })

function haQuanto(iso: string | null) {
  if (!iso) return null
  const seg = (new Date(iso).getTime() - Date.now()) / 1000
  const passos: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
  ]
  let divisor = 1
  for (const [limite, unidade] of passos) {
    if (Math.abs(seg) < limite) return relativo.format(Math.round(seg / divisor), unidade)
    divisor = limite
  }
  return relativo.format(Math.round(seg / 31557600), "year")
}

function nota(n: number) {
  return n.toLocaleString("pt-BR", { maximumFractionDigits: 1 })
}

// Nota alta em verde, média em âmbar, baixa neutra - a mesma leitura de um
// semáforo, sem precisar de legenda.
function corDaNota(n: number) {
  if (n >= 8) return "bg-emerald-500 text-white"
  if (n >= 6) return "bg-amber-400 text-black"
  return "bg-white/90 text-black"
}

function mensagem(e: unknown, padrao: string) {
  return e instanceof Error ? e.message : padrao
}

// ---------------------------------------------------------------- peças

function Avatar({ canal, className }: { canal: { nome: string; imagem: string | null }; className?: string }) {
  const [quebrou, setQuebrou] = useState(false)
  if (canal.imagem && !quebrou) {
    return (
      <img
        src={canal.imagem}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setQuebrou(true)}
        className={cn("shrink-0 rounded-full bg-muted object-cover", className)}
      />
    )
  }
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-muted font-semibold uppercase text-muted-foreground",
        className,
      )}
    >
      {canal.nome.slice(0, 1)}
    </span>
  )
}

function SeloAoVivo({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-md bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white shadow-sm",
        className,
      )}
    >
      <span className="relative flex size-1.5">
        <span className="absolute inline-flex size-full animate-ping rounded-full bg-white opacity-75 motion-reduce:animate-none" />
        <span className="relative inline-flex size-1.5 rounded-full bg-white" />
      </span>
      Ao vivo
    </span>
  )
}

// Interruptor liga/desliga. O painel não tem um pronto; o checkbox não
// comunica "isto fica valendo daqui pra frente" tão bem quanto uma chave.
function Interruptor({
  ligado,
  onChange,
  disabled,
  rotulo,
}: {
  ligado: boolean
  onChange: (v: boolean) => void
  disabled?: boolean
  rotulo: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={ligado}
      aria-label={rotulo}
      disabled={disabled}
      onClick={() => onChange(!ligado)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        ligado ? "bg-emerald-500" : "bg-input",
      )}
    >
      <span
        className={cn(
          "inline-block size-5 rounded-full bg-white shadow-sm transition-transform",
          ligado ? "translate-x-[22px]" : "translate-x-0.5",
        )}
      />
    </button>
  )
}

// O que está acontecendo com o canal, em uma linha.
function situacao(c: Canal, servicoAtivo: boolean): { texto: string; tom: "vermelho" | "ambar" | "verde" | "neutro" } {
  if (c.aoVivo && c.semCredito) return { texto: "Seus créditos acabaram — esta live parou de ser clipada", tom: "ambar" }
  if (c.aoVivo && c.recebendoCortes && c.gravacao) {
    const gasto = c.creditosNestaLive ? ` · ${c.creditosNestaLive} ${c.creditosNestaLive === 1 ? "crédito" : "créditos"}` : ""
    return {
      texto: `${c.clipandoEstaLive && !c.autoClipar ? "Clipando esta live" : "Clipando"} há ${duracaoCurta(c.gravacao.segundosGravados)}${gasto}`,
      tom: "vermelho",
    }
  }
  if (c.aoVivo && c.recebendoCortes) {
    return { texto: servicoAtivo ? "Preparando a gravação…" : "Aguardando o serviço voltar", tom: "ambar" }
  }
  if (c.aoVivo) return { texto: "Ao vivo · clipagem automática desligada", tom: "neutro" }
  if (c.autoClipar) return { texto: "Clipa sozinho quando entrar ao vivo", tom: "verde" }
  return { texto: "Clipagem automática desligada", tom: "neutro" }
}

const COR_SITUACAO = {
  vermelho: "bg-red-500",
  ambar: "bg-amber-500",
  verde: "bg-emerald-500",
  neutro: "bg-muted-foreground/40",
}

// Saldo no topo: os mesmos créditos dos cortes do YouTube, traduzidos em
// horas de live - "120 créditos" sozinho não diz quanto de live dá pra clipar.
function SaldoDeCreditos({ creditos }: { creditos: Estado["creditos"] }) {
  if (creditos.isento) {
    return (
      <span className="rounded-full border bg-card px-3 py-1.5 text-xs text-muted-foreground" title="Conta de administrador: as lives não consomem crédito">
        Créditos: isento (admin)
      </span>
    )
  }
  const minutos = creditos.disponiveis * creditos.minutosDeLivePorCredito
  const horas = minutos >= 60 ? `${(minutos / 60).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} h` : `${minutos} min`
  return (
    <a
      href="/client/billing"
      className="rounded-full border bg-card px-3 py-1.5 text-xs transition-colors hover:bg-muted"
      title={`Cada ${creditos.minutosDeLivePorCredito} minutos de live clipada usam 1 crédito — os mesmos créditos dos cortes do YouTube`}
    >
      <strong className="tabular-nums">{creditos.disponiveis}</strong> créditos
      <span className="text-muted-foreground"> · ≈ {horas} de live</span>
    </a>
  )
}

// ---------------------------------------------------------------- cartão do canal

function CartaoCanal({
  canal: c,
  servicoAtivo,
  ocupado,
  onClipar,
  onConfigurar,
  onVerCortes,
}: {
  canal: Canal
  servicoAtivo: boolean
  ocupado: boolean
  onClipar: () => void
  onConfigurar: () => void
  onVerCortes: () => void
}) {
  const sit = situacao(c, servicoAtivo)
  const marca = MARCA[c.plataforma]
  const clipandoAgora = c.aoVivo && c.recebendoCortes && Boolean(c.gravacao)
  const preparando = c.aoVivo && c.recebendoCortes && !c.gravacao

  let rotuloClipar = "Clipar"
  let ajuda = "Disponível quando o canal estiver ao vivo"
  if (c.aoVivo && c.semCredito) {
    rotuloClipar = "Sem créditos"
    ajuda = "Compre créditos em Plano e uso pra voltar a clipar"
  } else if (c.aoVivo && !c.recebendoCortes) {
    rotuloClipar = "Clipar esta live"
    ajuda = "Grava e corta os melhores momentos desta live, até ela acabar"
  } else if (clipandoAgora) {
    rotuloClipar = "Clipar este momento"
    ajuda = "Corta os últimos ~2,5 minutos da live agora"
  } else if (preparando) {
    rotuloClipar = "Começando…"
    ajuda = "A gravação começa em até 1 minuto"
  }

  return (
    <article
      className={cn(
        "group relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-flat)] transition-shadow hover:shadow-[var(--shadow-raised)] dark:border dark:border-border",
        c.aoVivo && "ring-1 ring-red-500/40",
      )}
    >
      {/* Faixa com a cor da plataforma, por trás da foto. */}
      <div className={cn("h-20 bg-gradient-to-br", marca.faixa)} aria-hidden />
      <button
        type="button"
        onClick={onConfigurar}
        className="absolute top-3 right-3 flex size-8 items-center justify-center rounded-full bg-background/80 text-muted-foreground backdrop-blur transition-colors hover:bg-background hover:text-foreground"
        aria-label={`Configurar ${c.nome}`}
        title="Configurar"
      >
        <IconSettings className="size-4" />
      </button>

      <div className="-mt-12 flex flex-col items-center px-5 text-center">
        <div className="relative">
          <span
            className={cn(
              "block rounded-full p-[3px]",
              c.aoVivo ? "bg-gradient-to-tr from-red-600 via-rose-500 to-orange-400" : "bg-card",
            )}
          >
            <Avatar canal={c} className="size-24 border-4 border-card text-3xl" />
          </span>
          <span
            className={cn("absolute right-0.5 bottom-1 flex size-7 items-center justify-center rounded-full border-[3px] border-card", marca.selo)}
            title={marca.nome}
          >
            <IconePlataforma plataforma={c.plataforma} className="size-3.5" />
          </span>
          {c.aoVivo && <SeloAoVivo className="absolute -bottom-2 left-1/2 -translate-x-1/2" />}
        </div>

        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="mt-4 flex max-w-full items-center gap-1 font-heading text-lg font-semibold tracking-[-0.01em] hover:underline"
          title={`Abrir na ${marca.nome}`}
        >
          <span className="truncate">{c.nome}</span>
        </a>
        <div className="flex flex-wrap items-center justify-center gap-x-2 text-xs text-muted-foreground">
          <span>@{c.login}</span>
          {c.aoVivo ? (
            c.espectadores !== null && (
              <span className="inline-flex items-center gap-1">
                <IconEye className="size-3.5" /> {compacto.format(c.espectadores)}
              </span>
            )
          ) : (
            <span>{c.ultimaVezAoVivo ? `offline · última live ${haQuanto(c.ultimaVezAoVivo)}` : "offline"}</span>
          )}
        </div>

        <div className="mt-3 min-h-[2.5rem] w-full text-sm">
          {c.aoVivo ? (
            <>
              <p className="line-clamp-1 font-medium" title={c.tituloDaLive || undefined}>
                {c.tituloDaLive || "Ao vivo"}
              </p>
              {c.jogo && <p className="line-clamp-1 text-xs text-muted-foreground">{c.jogo}</p>}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {c.cortesProntos > 0 ? "Os cortes das lives anteriores estão logo abaixo." : "Nenhum corte deste canal ainda."}
            </p>
          )}
        </div>
      </div>

      <div className="mx-5 mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs">
        <span className="relative flex size-2 shrink-0">
          {sit.tom === "vermelho" && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
          )}
          <span className={cn("relative inline-flex size-2 rounded-full", COR_SITUACAO[sit.tom])} />
        </span>
        <span className="min-w-0 flex-1 truncate text-left" title={sit.texto}>{sit.texto}</span>
      </div>

      <div className="mt-auto flex items-center gap-2 p-5 pt-3">
        <Button
          variant={c.aoVivo ? "default" : "outline"}
          className={cn(
            "min-w-0 flex-1",
            c.aoVivo && !preparando && !c.semCredito && "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700",
          )}
          disabled={!c.aoVivo || preparando || ocupado || c.semCredito}
          onClick={onClipar}
          title={ajuda}
        >
          {ocupado || preparando ? <IconLoader2 className="size-4 animate-spin" /> : <IconScissors className="size-4" />}
          <span className="truncate">{ocupado ? "Enviando…" : rotuloClipar}</span>
        </Button>
        <Button
          variant="outline"
          className="shrink-0 gap-1.5 px-3"
          onClick={onVerCortes}
          disabled={!c.cortesProntos && !c.cortesEmAndamento}
          title={`${c.cortesProntos} ${c.cortesProntos === 1 ? "corte pronto" : "cortes prontos"}${c.cortesEmAndamento ? `, ${c.cortesEmAndamento} sendo cortado(s)` : ""} — ver`}
          aria-label="Ver os cortes deste canal"
        >
          {c.cortesEmAndamento > 0 ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerPlayFilled className="size-3.5" />}
          <span className="tabular-nums">{c.cortesProntos}</span>
        </Button>
      </div>
    </article>
  )
}

// ---------------------------------------------------------------- cartão do corte

function CartaoCorte({
  corte: k,
  onAbrir,
  largura,
}: {
  corte: Corte
  onAbrir: () => void
  largura?: string
}) {
  const pronto = k.status === "pronto" && k.temArquivo
  return (
    <button
      type="button"
      onClick={onAbrir}
      disabled={!pronto && k.status !== "erro"}
      className={cn("group/corte flex min-w-0 flex-col gap-2 text-left disabled:cursor-default", largura)}
    >
      <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-muted shadow-[var(--shadow-flat)]">
        {pronto && k.temCapa ? (
          <img
            src={`${API}/cortes/${k.id}/arquivo?capa=1`}
            alt=""
            loading="lazy"
            className="size-full object-cover transition-transform duration-300 group-hover/corte:scale-[1.03]"
          />
        ) : pronto ? (
          <div className="flex size-full items-center justify-center bg-gradient-to-b from-zinc-700 to-zinc-900">
            <IconPlayerPlayFilled className="size-8 text-white/70" />
          </div>
        ) : k.status === "erro" ? (
          <div className="flex size-full flex-col items-center justify-center gap-2 p-3 text-center text-xs text-muted-foreground">
            <IconAlertTriangle className="size-6 text-destructive" />
            Não deu para cortar
          </div>
        ) : (
          <div className="flex size-full flex-col items-center justify-center gap-3 p-4 text-center">
            <IconLoader2 className="size-6 animate-spin text-muted-foreground" />
            <span className="text-xs font-medium text-muted-foreground">
              {k.status === "renderizando" ? `Cortando… ${k.progresso}%` : "Na fila"}
            </span>
            {k.status === "renderizando" && (
              <span className="h-1 w-3/4 overflow-hidden rounded-full bg-background">
                <span className="block h-full rounded-full bg-foreground transition-[width]" style={{ width: `${k.progresso}%` }} />
              </span>
            )}
          </div>
        )}

        {pronto && (
          <>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/70 to-transparent" />
            <span className="pointer-events-none absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover/corte:opacity-100">
              <span className="flex size-12 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur">
                <IconPlayerPlayFilled className="size-5" />
              </span>
            </span>
            <span className="absolute right-2 bottom-2 rounded-md bg-black/60 px-1.5 py-0.5 text-[11px] font-semibold text-white tabular-nums">
              {relogio(k.duracao)}
            </span>
          </>
        )}
        {k.nota !== null && (
          <span
            className={cn("absolute top-2 left-2 inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-[11px] font-bold shadow-sm tabular-nums", corDaNota(k.nota))}
            title="Nota da IA (0 a 10)"
          >
            <IconStarFilled className="size-2.5" /> {nota(k.nota)}
          </span>
        )}
        {k.origem === "clipar_agora" && (
          <span className="absolute top-2 right-2 flex size-6 items-center justify-center rounded-md bg-black/60 text-white" title="Clipado por você">
            <IconScissors className="size-3.5" />
          </span>
        )}
      </div>
      <div className="min-w-0 px-0.5">
        <p className="line-clamp-2 text-sm font-medium leading-snug">{k.titulo || (k.status === "pronto" ? "Sem título" : "Preparando o corte…")}</p>
        <div className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Avatar canal={k.canal} className="size-4 text-[8px]" />
          <span className="truncate">{k.canal.nome}</span>
          <span aria-hidden>·</span>
          <span className="shrink-0">{haQuanto(k.criadoEm)}</span>
        </div>
      </div>
    </button>
  )
}

// Prateleira de uma categoria: rolagem lateral, como no YouTube/Netflix. No
// celular cabem 2 e um pedaço do terceiro - o pedaço diz "tem mais pro lado".
function Prateleira({
  titulo,
  descricao,
  cortes,
  onAbrir,
  onVerTodos,
}: {
  titulo: string
  descricao?: string
  cortes: Corte[]
  onAbrir: (k: Corte) => void
  onVerTodos?: () => void
}) {
  return (
    <section className="flex min-w-0 flex-col gap-3">
      <div className="flex items-end justify-between gap-3">
        <div className="min-w-0">
          <h3 className="font-heading text-base font-semibold">
            {titulo} <span className="font-normal text-muted-foreground tabular-nums">· {cortes.length}</span>
          </h3>
          {descricao && <p className="truncate text-xs text-muted-foreground">{descricao}</p>}
        </div>
        {onVerTodos && cortes.length > 4 && (
          <Button variant="ghost" size="sm" onClick={onVerTodos} className="shrink-0">
            Ver todos <IconChevronRight className="size-4" />
          </Button>
        )}
      </div>
      <div className="-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 [scrollbar-width:thin]">
        {cortes.map((k) => (
          <CartaoCorte key={k.id} corte={k} onAbrir={() => onAbrir(k)} largura="w-[42%] shrink-0 snap-start sm:w-[180px]" />
        ))}
      </div>
    </section>
  )
}

// ---------------------------------------------------------------- página

export function LivesPage() {
  // Todos os hooks antes de qualquer return condicional (React #310, ver CLAUDE.md).
  const { user, loading: authLoading, logout } = useAuth()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [cortes, setCortes] = useState<Corte[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [aba, setAba] = useState<"canais" | "ajustes">(() =>
    typeof window !== "undefined" && window.location.hash === "#ajustes" ? "ajustes" : "canais",
  )
  const [ordem, setOrdem] = useState<"nota" | "recentes">("nota")
  const [filtroCanal, setFiltroCanal] = useState<number | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<string>("todos")
  const [clipando, setClipando] = useState<number | null>(null)
  const [configurando, setConfigurando] = useState<number | null>(null)
  const [adicionarAberto, setAdicionarAberto] = useState(false)
  const [corteAberto, setCorteAberto] = useState<number | null>(null)
  const secaoCortes = useRef<HTMLDivElement>(null)

  const carregar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ ordem })
      const [e, c] = await Promise.all([
        api.get<Estado>(API),
        api.get<{ cortes: Corte[] }>(`${API}/cortes?${q}`),
      ])
      setEstado(e)
      setCortes(c.cortes)
    } catch (e) {
      setErro(mensagem(e, "Não consegui carregar."))
    }
  }, [ordem])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Atualiza sozinho: com algo acontecendo (live gravando, corte na fila) a
  // cada 10s; parado, a cada 45s - é o que faz um canal aparecer "ao vivo"
  // sem a pessoa recarregar. Com a aba escondida, não pergunta nada.
  const temAtividade = useMemo(
    () =>
      Boolean(estado?.canais.some((c) => c.aoVivo || c.cortesEmAndamento > 0)) ||
      cortes.some((k) => k.status === "na_fila" || k.status === "renderizando"),
    [estado, cortes],
  )
  useEffect(() => {
    const t = setInterval(
      () => {
        if (document.visibilityState === "visible") void carregar()
      },
      temAtividade ? 10_000 : 45_000,
    )
    return () => clearInterval(t)
  }, [temAtividade, carregar])

  useEffect(() => {
    if (!aviso) return
    const t = setTimeout(() => setAviso(null), 6000)
    return () => clearTimeout(t)
  }, [aviso])

  function trocarAba(v: string) {
    const nova = v === "ajustes" ? "ajustes" : "canais"
    setAba(nova)
    try {
      window.history.replaceState(null, "", nova === "ajustes" ? "#ajustes" : window.location.pathname)
    } catch {
      // Navegador sem history (não acontece nos que suportamos): só não lembra.
    }
  }

  async function salvar<T extends Estado>(acao: () => Promise<T>, padrao: string) {
    setErro(null)
    try {
      setEstado(await acao())
      return true
    } catch (e) {
      setErro(mensagem(e, padrao))
      return false
    }
  }

  async function clipar(c: Canal) {
    setClipando(c.id)
    setErro(null)
    try {
      if (c.aoVivo && !c.recebendoCortes) {
        setEstado(await api.post<Estado>(`${API}/canais/${c.id}/clipar-esta-live`))
        setAviso(
          `Pronto! A live de ${c.nome} está sendo clipada (cada ${estado?.creditos.minutosDeLivePorCredito ?? 3} minutos usam 1 crédito). Os primeiros cortes aparecem aqui em uns 15 minutos.`,
        )
      } else {
        await api.post(`${API}/canais/${c.id}/clipar-agora`)
        setAviso(
          estado?.creditos.isento
            ? "Momento clipado! O corte dos últimos ~2,5 minutos fica pronto em alguns minutos."
            : `Momento clipado (${estado?.creditos.cliparAgora ?? 1} crédito)! O corte dos últimos ~2,5 minutos fica pronto em alguns minutos.`,
        )
        await carregar()
      }
    } catch (e) {
      setErro(mensagem(e, "Não consegui clipar."))
    } finally {
      setClipando(null)
    }
  }

  function verCortesDoCanal(id: number) {
    setFiltroCanal(id)
    setFiltroTipo("todos")
    secaoCortes.current?.scrollIntoView({ behavior: "smooth", block: "start" })
  }

  async function apagarCorte(id: number) {
    try {
      await api.delete(`${API}/cortes/${id}`)
      setCorteAberto(null)
      setCortes((lista) => lista.filter((k) => k.id !== id))
      void carregar()
    } catch (e) {
      setErro(mensagem(e, "Não consegui apagar."))
    }
  }

  // ----- dados derivados (sem hooks: ficam depois do return condicional seria
  // proibido, então são calculados aqui com valores seguros quando nulos).
  const categorias = estado?.categorias ?? []
  const nomeCategoria = new Map(categorias.map((c) => [c.id, c]))
  const doCanal = filtroCanal ? cortes.filter((k) => k.canal.id === filtroCanal) : cortes
  const emProducao = doCanal.filter((k) => k.status === "na_fila" || k.status === "renderizando")
  const finalizados = doCanal.filter((k) => k.status === "pronto" || k.status === "erro")
  const categoriaDe = (k: Corte) => (k.origem === "clipar_agora" ? MANUAIS : k.categoria || "outros")
  const grupos = new Map<string, Corte[]>()
  for (const k of finalizados) {
    const id = categoriaDe(k)
    grupos.set(id, [...(grupos.get(id) || []), k])
  }
  const ordemDosGrupos = [MANUAIS, ...categorias.map((c) => c.id)].filter((id) => grupos.has(id))
  const nomeDoGrupo = (id: string) => (id === MANUAIS ? "Clipados por você" : nomeCategoria.get(id)?.nome || "Outros")
  const descricaoDoGrupo = (id: string) =>
    id === MANUAIS ? "Os momentos que você mandou clipar no botão" : nomeCategoria.get(id)?.descricao
  const listaDoFiltro = filtroTipo === "todos" ? [] : grupos.get(filtroTipo) || []
  const canalFiltrado = estado?.canais.find((c) => c.id === filtroCanal) || null
  const corteSelecionado = cortes.find((k) => k.id === corteAberto) || null
  const canalConfigurando = estado?.canais.find((c) => c.id === configurando) || null
  const aoVivo = estado?.canais.filter((c) => c.aoVivo).length ?? 0
  const prontos = cortes.filter((k) => k.status === "pronto").length

  // Canais ao vivo primeiro (é onde a ação está), depois quem clipa sozinho.
  const canaisOrdenados = [...(estado?.canais ?? [])].sort(
    (a, b) => Number(b.aoVivo) - Number(a.aoVivo) || Number(b.autoClipar) - Number(a.autoClipar) || a.nome.localeCompare(b.nome),
  )

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Lives">
      <PageHeader
        title="Lives"
        description="Acompanhe canais da Twitch e da Kick e receba os melhores momentos das lives já cortados na vertical, com legenda."
        action={
          <>
            {estado && <SaldoDeCreditos creditos={estado.creditos} />}
            <Button onClick={() => setAdicionarAberto(true)}>
              <IconPlus className="size-4" /> Adicionar canal
            </Button>
          </>
        }
      />

      {estado && !estado.servicoAtivo && (
        <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            <strong>O serviço de lives está pausado no momento.</strong> Seus canais e cortes continuam aqui, mas nenhuma
            live está sendo gravada agora.
          </span>
        </div>
      )}
      {erro && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{erro}</span>
          <button type="button" onClick={() => setErro(null)} aria-label="Fechar aviso" className="shrink-0 opacity-70 hover:opacity-100">
            <IconX className="size-4" />
          </button>
        </div>
      )}
      {aviso && (
        <div
          role="status"
          className="fixed inset-x-4 bottom-4 z-50 mx-auto flex max-w-md items-start gap-3 rounded-xl bg-foreground p-4 text-sm text-background shadow-[var(--shadow-frame)] sm:inset-x-auto sm:right-6"
        >
          <IconCheck className="mt-0.5 size-4 shrink-0" />
          <span className="min-w-0 flex-1">{aviso}</span>
          <button type="button" onClick={() => setAviso(null)} aria-label="Fechar" className="shrink-0 opacity-70 hover:opacity-100">
            <IconX className="size-4" />
          </button>
        </div>
      )}

      <Tabs value={aba} onValueChange={trocarAba} className="gap-5">
        <TabsList variant="line" className="justify-start">
          <TabsTrigger value="canais">
            <IconBroadcast /> Canais e cortes
          </TabsTrigger>
          <TabsTrigger value="ajustes">
            <IconAdjustmentsHorizontal /> Ajustes<span className="hidden sm:inline"> dos cortes</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="canais" className="flex min-w-0 flex-col gap-8">
          {!estado ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-[340px] rounded-2xl" />
              ))}
            </div>
          ) : estado.canais.length === 0 ? (
            <EmptyState
              icon={<IconBroadcast />}
              title="Adicione o primeiro canal"
              description="Cole o link de um canal da Twitch ou da Kick. Quando ele entrar ao vivo, o Post Flow grava, acha os melhores momentos com IA e entrega os cortes prontos aqui."
              action={
                <Button onClick={() => setAdicionarAberto(true)}>
                  <IconPlus className="size-4" /> Adicionar canal
                </Button>
              }
            />
          ) : (
            <section className="flex flex-col gap-4">
              <SectionLabel>
                Seus canais
                {aoVivo > 0 && (
                  <span className="ml-2 normal-case tracking-normal text-red-600 dark:text-red-400">· {aoVivo} ao vivo agora</span>
                )}
              </SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {canaisOrdenados.map((c) => (
                  <CartaoCanal
                    key={c.id}
                    canal={c}
                    servicoAtivo={estado.servicoAtivo}
                    ocupado={clipando === c.id}
                    onClipar={() => void clipar(c)}
                    onConfigurar={() => setConfigurando(c.id)}
                    onVerCortes={() => verCortesDoCanal(c.id)}
                  />
                ))}
              </div>
            </section>
          )}

          {estado && estado.canais.length + cortes.length > 0 && (
            <section ref={secaoCortes} className="flex min-w-0 scroll-mt-20 flex-col gap-5">
              <SectionLabel
                action={
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    size="sm"
                    value={ordem}
                    onValueChange={(v) => v && setOrdem(v as "nota" | "recentes")}
                    aria-label="Ordenar cortes"
                  >
                    <ToggleGroupItem value="nota">Melhor nota</ToggleGroupItem>
                    <ToggleGroupItem value="recentes">Recentes</ToggleGroupItem>
                  </ToggleGroup>
                }
              >
                Cortes {prontos > 0 && <span className="normal-case tracking-normal">· {prontos} prontos</span>}
              </SectionLabel>

              {canalFiltrado && (
                <div className="flex w-fit max-w-full items-center gap-2 rounded-full border bg-card py-1 pr-1 pl-1.5 text-sm">
                  <Avatar canal={canalFiltrado} className="size-6 text-[10px]" />
                  <span className="min-w-0 truncate">Só de <strong>{canalFiltrado.nome}</strong></span>
                  <button
                    type="button"
                    onClick={() => setFiltroCanal(null)}
                    className="flex size-6 shrink-0 items-center justify-center rounded-full hover:bg-muted"
                    aria-label="Mostrar cortes de todos os canais"
                  >
                    <IconX className="size-3.5" />
                  </button>
                </div>
              )}

              {/* Tipos de corte: rolagem lateral no celular, quebra de linha no computador. */}
              {finalizados.length > 0 && (
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 sm:flex-wrap [scrollbar-width:none]">
                  {[{ id: "todos", nome: "Todos", n: finalizados.length }, ...ordemDosGrupos.map((id) => ({ id, nome: nomeDoGrupo(id), n: grupos.get(id)!.length }))].map(
                    (g) => (
                      <button
                        key={g.id}
                        type="button"
                        aria-pressed={filtroTipo === g.id}
                        onClick={() => setFiltroTipo(g.id)}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors",
                          filtroTipo === g.id
                            ? "border-foreground bg-foreground text-background"
                            : "bg-card text-muted-foreground hover:bg-muted hover:text-foreground",
                        )}
                      >
                        {g.nome}
                        <span className={cn("tabular-nums text-xs", filtroTipo === g.id ? "opacity-70" : "opacity-60")}>{g.n}</span>
                      </button>
                    ),
                  )}
                </div>
              )}

              {emProducao.length > 0 && filtroTipo === "todos" && (
                <Prateleira
                  titulo="Em produção"
                  descricao="Já escolhidos pela IA, sendo cortados agora"
                  cortes={emProducao}
                  onAbrir={(k) => setCorteAberto(k.id)}
                />
              )}

              {finalizados.length === 0 && emProducao.length === 0 ? (
                <EmptyState
                  compact
                  icon={<IconScissors />}
                  title="Nenhum corte ainda"
                  description={
                    filtroCanal
                      ? "Este canal ainda não tem cortes. Eles aparecem aqui uns 15 minutos depois que a live começa a ser clipada."
                      : "Os cortes aparecem aqui uns 15 minutos depois que uma live começa a ser clipada. Quer adiantar? Aperte Clipar num canal ao vivo."
                  }
                />
              ) : filtroTipo === "todos" ? (
                ordemDosGrupos.map((id) => (
                  <Prateleira
                    key={id}
                    titulo={nomeDoGrupo(id)}
                    descricao={descricaoDoGrupo(id)}
                    cortes={grupos.get(id)!}
                    onAbrir={(k) => setCorteAberto(k.id)}
                    onVerTodos={() => setFiltroTipo(id)}
                  />
                ))
              ) : (
                <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5">
                  {listaDoFiltro.map((k) => (
                    <CartaoCorte key={k.id} corte={k} onAbrir={() => setCorteAberto(k.id)} />
                  ))}
                </div>
              )}
            </section>
          )}
        </TabsContent>

        <TabsContent value="ajustes" className="flex min-w-0 flex-col gap-6">
          {!estado ? <Skeleton className="h-64 w-full" /> : <Ajustes estado={estado} salvar={salvar} />}
        </TabsContent>
      </Tabs>

      <DialogAdicionar
        aberto={adicionarAberto}
        onFechar={() => setAdicionarAberto(false)}
        plataformas={estado?.plataformas ?? []}
        onAdicionado={(e, nome) => {
          setEstado(e)
          setAdicionarAberto(false)
          setAviso(`${nome} adicionado.`)
        }}
      />

      {canalConfigurando && (
        <DialogConfigurar
          canal={canalConfigurando}
          onFechar={() => setConfigurando(null)}
          salvar={salvar}
          onRemovido={() => {
            setConfigurando(null)
            if (filtroCanal === canalConfigurando.id) setFiltroCanal(null)
          }}
        />
      )}

      <DialogCorte
        corte={corteSelecionado}
        categoria={corteSelecionado ? nomeDoGrupo(categoriaDe(corteSelecionado)) : ""}
        onFechar={() => setCorteAberto(null)}
        onApagar={(id) => void apagarCorte(id)}
      />
    </DashboardLayout>
  )
}

// ---------------------------------------------------------------- diálogos

function LinhaOpcao({ titulo, descricao, controle }: { titulo: string; descricao: ReactNode; controle: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border p-4">
      <div className="min-w-0">
        <p className="text-sm font-medium">{titulo}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">{descricao}</p>
      </div>
      <div className="shrink-0 pt-0.5">{controle}</div>
    </div>
  )
}

function DialogAdicionar({
  aberto,
  onFechar,
  plataformas,
  onAdicionado,
}: {
  aberto: boolean
  onFechar: () => void
  plataformas: { id: Plataforma; nome: string; disponivel: boolean }[]
  onAdicionado: (e: Estado, nome: string) => void
}) {
  const [plataforma, setPlataforma] = useState<Plataforma>("twitch")
  const [canal, setCanal] = useState("")
  const [auto, setAuto] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  // Reabrir começa limpo: o erro do canal anterior não pode ficar na tela.
  useEffect(() => {
    if (aberto) {
      setCanal("")
      setErro(null)
      setAuto(true)
    }
  }, [aberto])

  const disponiveis = plataformas.length ? plataformas : [
    { id: "twitch" as const, nome: "Twitch", disponivel: true },
    { id: "kick" as const, nome: "Kick", disponivel: true },
  ]

  async function enviar() {
    if (!canal.trim()) return
    setEnviando(true)
    setErro(null)
    try {
      const e = await api.post<Estado>(`${API}/canais`, { canal, plataforma, autoClipar: auto })
      // O nome de verdade vem da plataforma ("xQc"), não do que foi digitado.
      const login = canal.trim().replace(/\/+$/, "").replace(/^.*\//, "").toLowerCase()
      const novo = e.canais.find((c) => c.login.toLowerCase() === login)
      onAdicionado(e, novo?.nome || "Canal")
    } catch (e) {
      setErro(mensagem(e, "Não consegui adicionar o canal."))
    } finally {
      setEnviando(false)
    }
  }

  return (
    <Dialog open={aberto} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Adicionar canal</DialogTitle>
          <DialogDescription>
            Cole o nome ou o link do canal. O streamer não precisa fazer nada, e você não precisa ter conta na plataforma.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            void enviar()
          }}
        >
          <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label="Plataforma">
            {disponiveis.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={plataforma === p.id}
                disabled={!p.disponivel}
                onClick={() => setPlataforma(p.id)}
                className={cn(
                  "flex items-center justify-center gap-2 rounded-xl border p-3 text-sm font-medium transition-colors disabled:opacity-40",
                  plataforma === p.id ? "border-foreground bg-foreground/[0.04] ring-1 ring-foreground" : "hover:bg-muted",
                )}
              >
                <span className={cn("flex size-6 items-center justify-center rounded-md", MARCA[p.id].selo)}>
                  <IconePlataforma plataforma={p.id} className="size-3.5" />
                </span>
                {p.nome}
              </button>
            ))}
          </div>
          <Input
            autoFocus
            placeholder={plataforma === "kick" ? "kick.com/nome-do-canal" : "twitch.tv/nome-do-canal"}
            value={canal}
            onChange={(e) => {
              const v = e.target.value
              setCanal(v)
              // Link colado já diz a plataforma: o botão acompanha, pra não mostrar uma e adicionar outra.
              if (/kick\.com\//i.test(v)) setPlataforma("kick")
              else if (/twitch\.tv\//i.test(v)) setPlataforma("twitch")
            }}
            className="h-11"
          />
          <LinhaOpcao
            titulo="Clipar sempre que estiver ao vivo"
            descricao="Toda live deste canal é cortada sozinha. Desligado, você clipa só quando apertar Clipar. Cada 3 minutos de live clipada usam 1 crédito."
            controle={<Interruptor ligado={auto} onChange={setAuto} rotulo="Clipar sempre que estiver ao vivo" />}
          />
          {erro && <p className="text-sm text-destructive">{erro}</p>}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={onFechar}>Cancelar</Button>
            <Button type="submit" disabled={enviando || !canal.trim()}>
              {enviando ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlus className="size-4" />}
              {enviando ? "Procurando o canal…" : "Adicionar"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function DialogConfigurar({
  canal: c,
  onFechar,
  salvar,
  onRemovido,
}: {
  canal: Canal
  onFechar: () => void
  salvar: (acao: () => Promise<Estado>, padrao: string) => Promise<boolean>
  onRemovido: () => void
}) {
  const [salvando, setSalvando] = useState(false)
  const [confirmandoRemover, setConfirmandoRemover] = useState(false)
  const marca = MARCA[c.plataforma]

  async function rodar(acao: () => Promise<Estado>, padrao: string) {
    setSalvando(true)
    const ok = await salvar(acao, padrao)
    setSalvando(false)
    return ok
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onFechar()}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] overflow-y-auto rounded-2xl sm:max-w-md">
        <DialogHeader className="flex-row items-center gap-3 text-left">
          <Avatar canal={c} className="size-12 text-lg" />
          <div className="min-w-0">
            <DialogTitle className="truncate">{c.nome}</DialogTitle>
            <DialogDescription className="flex items-center gap-1.5">
              <IconePlataforma plataforma={c.plataforma} className="size-3.5" /> @{c.login} · {c.aoVivo ? "ao vivo agora" : "offline"}
            </DialogDescription>
          </div>
        </DialogHeader>

        <LinhaOpcao
          titulo="Clipar sempre que estiver ao vivo"
          descricao={
            c.autoClipar
              ? "Ligado: toda live deste canal é gravada e os melhores momentos viram cortes, sem você fazer nada. Cada 3 minutos de live usam 1 crédito."
              : "Desligado: o canal fica aqui só para você acompanhar, e você clipa a live que quiser no botão Clipar."
          }
          controle={
            <Interruptor
              ligado={c.autoClipar}
              disabled={salvando}
              rotulo="Clipar sempre que estiver ao vivo"
              onChange={(v) =>
                void rodar(() => api.put<Estado>(`${API}/canais/${c.id}/automatico`, { ligado: v }), "Não consegui salvar.")
              }
            />
          }
        />

        {c.clipandoEstaLive && !c.autoClipar && (
          <LinhaOpcao
            titulo="Clipando só esta live"
            descricao="Termina sozinho quando a live acabar. Pare antes se já tiver o que precisa."
            controle={
              <Button
                size="sm"
                variant="outline"
                disabled={salvando}
                onClick={() => void rodar(() => api.delete<Estado>(`${API}/canais/${c.id}/clipar-esta-live`), "Não consegui parar.")}
              >
                Parar
              </Button>
            }
          />
        )}

        <a
          href={c.url}
          target="_blank"
          rel="noreferrer"
          className="flex items-center justify-between rounded-xl border p-4 text-sm font-medium transition-colors hover:bg-muted"
        >
          Abrir o canal na {marca.nome}
          <IconExternalLink className="size-4 text-muted-foreground" />
        </a>

        <div className="flex flex-col gap-2 border-t pt-4">
          {confirmandoRemover ? (
            <>
              <p className="text-sm">Remover {c.nome}? Os cortes que já foram feitos continuam na sua lista.</p>
              <div className="flex gap-2">
                <Button
                  variant="destructive"
                  disabled={salvando}
                  onClick={async () => {
                    if (await rodar(() => api.delete<Estado>(`${API}/canais/${c.id}`), "Não consegui remover.")) onRemovido()
                  }}
                >
                  Sim, remover
                </Button>
                <Button variant="ghost" onClick={() => setConfirmandoRemover(false)}>Voltar</Button>
              </div>
            </>
          ) : (
            <Button variant="ghost" className="w-fit text-destructive hover:text-destructive" onClick={() => setConfirmandoRemover(true)}>
              <IconTrash className="size-4" /> Remover canal
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DialogCorte({
  corte: k,
  categoria,
  onFechar,
  onApagar,
}: {
  corte: Corte | null
  categoria: string
  onFechar: () => void
  onApagar: (id: number) => void
}) {
  const [confirmando, setConfirmando] = useState(false)
  useEffect(() => setConfirmando(false), [k?.id])

  return (
    <Dialog open={Boolean(k)} onOpenChange={(v) => !v && onFechar()}>
      <DialogContent
        showCloseButton={false}
        className="max-h-[calc(100dvh-1rem)] w-[calc(100%-1rem)] gap-0 overflow-y-auto rounded-2xl p-0 sm:max-w-3xl"
      >
        {/* Fechar próprio: o padrão é escuro e some em cima do vídeo no celular. */}
        <button
          type="button"
          onClick={onFechar}
          aria-label="Fechar"
          className="absolute top-3 right-3 z-10 flex size-8 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur transition-colors hover:bg-black/75"
        >
          <IconX className="size-4" />
        </button>
        {k && (
          <div className="flex flex-col sm:flex-row">
            <div className="flex shrink-0 justify-center bg-black sm:w-[340px] sm:rounded-l-2xl">
              {k.status === "pronto" && k.temArquivo ? (
                <video
                  key={k.id}
                  controls
                  autoPlay
                  playsInline
                  poster={k.temCapa ? `${API}/cortes/${k.id}/arquivo?capa=1` : undefined}
                  src={`${API}/cortes/${k.id}/arquivo`}
                  className="aspect-[9/16] max-h-[70dvh] w-auto max-w-full bg-black sm:max-h-[80dvh]"
                />
              ) : (
                <div className="flex aspect-[9/16] max-h-[50dvh] w-full flex-col items-center justify-center gap-2 p-6 text-center text-sm text-white/70">
                  <IconAlertTriangle className="size-6" />
                  {k.erro || "Este corte não ficou pronto."}
                </div>
              )}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-4 p-5 sm:p-6">
              <DialogHeader className="pr-8 text-left">
                <DialogTitle className="leading-snug">{k.titulo || "Corte sem título"}</DialogTitle>
                {k.gancho && <DialogDescription>{k.gancho}</DialogDescription>}
              </DialogHeader>

              <div className="flex flex-wrap gap-1.5">
                {k.nota !== null && (
                  <span className={cn("inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold", corDaNota(k.nota))}>
                    <IconStarFilled className="size-3" /> Nota {nota(k.nota)}
                  </span>
                )}
                <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium">{categoria}</span>
                <span className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium">
                  <IconClock className="size-3" /> {relogio(k.duracao)}
                </span>
                {k.revisao?.veredito === "corrigido" && (
                  <span className="rounded-md bg-muted px-2 py-1 text-xs font-medium" title="A revisão final da IA ajustou o começo ou o fim">
                    Ajustado na revisão
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 text-sm">
                <Avatar canal={k.canal} className="size-8 text-xs" />
                <div className="min-w-0">
                  <p className="truncate font-medium">{k.canal.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    {k.origem === "clipar_agora" ? "Clipado por você" : "Escolhido pela IA"} · {haQuanto(k.criadoEm)}
                  </p>
                </div>
              </div>

              <div className="mt-auto flex flex-col gap-2 pt-2 sm:flex-row">
                {k.status === "pronto" && k.temArquivo && (
                  <Button asChild className="sm:flex-1">
                    <a href={`${API}/cortes/${k.id}/arquivo?download=1`}>
                      <IconDownload className="size-4" /> Baixar vídeo
                    </a>
                  </Button>
                )}
                {confirmando ? (
                  <div className="flex gap-2">
                    <Button variant="destructive" className="flex-1" onClick={() => onApagar(k.id)}>Sim, apagar</Button>
                    <Button variant="ghost" onClick={() => setConfirmando(false)}>Voltar</Button>
                  </div>
                ) : (
                  <Button variant="outline" onClick={() => setConfirmando(true)}>
                    <IconTrash className="size-4" /> Apagar
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------- ajustes

const ENQUADRAMENTOS: { id: Opcoes["cameraModo"]; titulo: string; descricao: string }[] = [
  {
    id: "ia",
    titulo: "A IA escolhe",
    descricao: "Em cada corte a IA olha a live e monta o melhor formato: a câmera numa faixa e o jogo na outra, ou o quadro inteiro quando cortar deixaria alguém de fora.",
  },
  {
    id: "auto",
    titulo: "Destacar a câmera",
    descricao: "A câmera do streamer vai sempre numa faixa própria. Sem câmera separada, sai no estilo normal.",
  },
  {
    id: "desligado",
    titulo: "Estilo normal",
    descricao: "Segue só o estilo visual escolhido abaixo, sem enquadramento especial.",
  },
]

function Ajustes({
  estado,
  salvar,
}: {
  estado: Estado
  salvar: (acao: () => Promise<Estado>, padrao: string) => Promise<boolean>
}) {
  const [altura, setAltura] = useState<string | null>(null)
  const op = estado.opcoes
  const salvarOpcoes = (parcial: Partial<Opcoes>) => void salvar(() => api.put<Estado>(`${API}/opcoes`, parcial), "Não consegui salvar.")

  // Nenhum marcado = todos (mandado como null). Não deixa desmarcar o último:
  // sem nenhum tipo, nenhum corte chegaria e a tela pareceria quebrada.
  const [avisoTipos, setAvisoTipos] = useState<string | null>(null)
  function alternarCategoria(id: string) {
    const todos = estado.categorias.map((c) => c.id)
    const atuais = op.categorias ?? todos
    const novas = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]
    if (!novas.length) {
      setAvisoTipos("Deixe pelo menos um tipo marcado.")
      return
    }
    setAvisoTipos(null)
    salvarOpcoes({ categorias: novas.length === todos.length ? null : novas })
  }

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle>Quantidade × qualidade</CardTitle>
          <CardDescription>
            A IA dá uma nota a cada momento da live. Mais para a direita, você recebe menos cortes, só os com mais chance de viralizar.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <BarraDeQualidade valor={op.qualidade} niveis={estado.niveis} onSalvar={(q) => salvarOpcoes({ qualidade: q })} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tipos de corte</CardTitle>
          <CardDescription>Você recebe só os tipos marcados. Desmarque o que não combina com o seu perfil.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {estado.categorias.map((cat) => {
              const marcada = !op.categorias || op.categorias.includes(cat.id)
              return (
                <button
                  key={cat.id}
                  type="button"
                  aria-pressed={marcada}
                  onClick={() => alternarCategoria(cat.id)}
                  className={cn(
                    "flex items-start gap-3 rounded-xl border p-3 text-left transition-colors",
                    marcada ? "border-foreground/80 bg-foreground/[0.03]" : "opacity-60 hover:opacity-100",
                  )}
                >
                  <span
                    className={cn(
                      "mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-md border",
                      marcada ? "border-foreground bg-foreground text-background" : "border-input",
                    )}
                  >
                    {marcada && <IconCheck className="size-3.5" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium">{cat.nome}</span>
                    <span className="block text-xs text-muted-foreground">{cat.descricao}</span>
                  </span>
                </button>
              )
            })}
          </div>
          {avisoTipos && <p className="text-sm text-destructive">{avisoTipos}</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Enquadramento</CardTitle>
          <CardDescription>Como a live (que é deitada) vira um vídeo em pé.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-2 md:grid-cols-3">
            {ENQUADRAMENTOS.map((e) => (
              <button
                key={e.id}
                type="button"
                aria-pressed={op.cameraModo === e.id}
                onClick={() => op.cameraModo !== e.id && salvarOpcoes({ cameraModo: e.id })}
                className={cn(
                  "flex flex-col gap-1 rounded-xl border p-4 text-left transition-colors",
                  op.cameraModo === e.id ? "border-foreground ring-1 ring-foreground" : "hover:bg-muted",
                )}
              >
                <span className="flex items-center justify-between gap-2 text-sm font-medium">
                  {e.titulo}
                  {op.cameraModo === e.id && <IconCheck className="size-4" />}
                </span>
                <span className="text-xs text-muted-foreground">{e.descricao}</span>
              </button>
            ))}
          </div>
          {op.cameraModo === "auto" && (
            <div className="flex flex-wrap items-center gap-3">
              <ToggleGroup
                type="single"
                variant="outline"
                value={op.cameraPosicao}
                onValueChange={(v) => v && salvarOpcoes({ cameraPosicao: v as Opcoes["cameraPosicao"] })}
                aria-label="Posição da câmera"
              >
                <ToggleGroupItem value="top">Câmera em cima</ToggleGroupItem>
                <ToggleGroupItem value="bottom">Câmera embaixo</ToggleGroupItem>
              </ToggleGroup>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={20}
                  max={60}
                  className="w-20"
                  aria-label="Altura da câmera"
                  value={altura ?? String(op.cameraAlturaPercent)}
                  onChange={(e) => setAltura(e.target.value)}
                  onBlur={(e) => {
                    if (altura === null) return
                    setAltura(null)
                    salvarOpcoes({ cameraAlturaPercent: Number(e.target.value) })
                  }}
                />
                <span className="text-sm text-muted-foreground">% da altura do vídeo</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Estilo visual</CardTitle>
          <CardDescription>Legenda, título e fundo dos cortes de live.</CardDescription>
        </CardHeader>
        <CardContent>
          <LinhaOpcao
            titulo="Usar o mesmo estilo dos cortes de vídeo"
            descricao="Igual aos seus cortes do YouTube. Desligue para ter um estilo só para as lives."
            controle={
              <Interruptor
                ligado={op.usarEstiloDosVideos}
                rotulo="Usar o mesmo estilo dos cortes de vídeo"
                onChange={(v) => salvarOpcoes({ usarEstiloDosVideos: v })}
              />
            }
          />
        </CardContent>
      </Card>

      {!op.usarEstiloDosVideos && <ClipStyleEditorCard key="estilo-live" endpoint={`${API}/estilo`} modoLive />}
    </>
  )
}
