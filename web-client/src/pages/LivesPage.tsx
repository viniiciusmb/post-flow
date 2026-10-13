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
  IconPlayerStopFilled,
  IconPlus,
  IconScissors,
  IconStarFilled,
  IconTrash,
  IconX,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader, SectionLabel } from "@/components/dashboard/PageHeader"
import { EmptyState } from "@/components/dashboard/EmptyState"
import { CenaDePrevia, GaleriaDeEstilos, TextoNoModelo, letraPelaCaixa } from "@/components/estilos/estilosDeTexto"
import type { ClientVideoSettingsResponse } from "@/types/api"
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
import { Onda } from "@/components/maquina/Processamento"

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
  // Quando a live começou na plataforma (relógio da live, não da gravação).
  aoVivoDesde: string | null
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
  // Limite do plano: acompanha mais canais do que o plano dá, ou outra live já
  // está sendo clipada (o plano clipa 1 por vez).
  bloqueio?: "fora_do_plano" | "outra_live" | null
  // Ao vivo e sem gravar no servidor: por quê.
  semGravar?: { motivo: "servidor_cheio" | "disco_cheio" | "limite_de_horas"; desde: string } | null
}

type Estado = {
  servicoAtivo: boolean
  plataformas: { id: Plataforma; nome: string; disponivel: boolean }[]
  canais: Canal[]
  opcoes: Opcoes
  niveis: Record<string, Nivel>
  categorias: Categoria[]
  creditos: { disponiveis: number; isento: boolean; minutosDeLivePorCredito: number; cliparAgora: number }
  // Quantos segundos pra trás o "Clipar este momento" pega.
  janelaCliparAgoraS: number
  limites?: { semPlano: boolean; plano: string | null; canais: number | null; aoMesmoTempo: number | null }
}

const TEXTO_SEM_GRAVAR = {
  servidor_cheio: "Servidor cheio agora: a gravação começa sozinha assim que abrir vaga",
  disco_cheio: "Gravações pausadas no servidor por alguns minutos (manutenção)",
  limite_de_horas: "Este canal já foi gravado o máximo de horas de hoje",
} as const

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
  apagaEm: string
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

// Relógio de live: 2:13:05 (ou 13:05 na primeira hora), como o player mostra.
function relogioDeLive(segundos: number) {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const resto = String(s % 60).padStart(2, "0")
  return h ? `${h}:${String(m).padStart(2, "0")}:${resto}` : `${m}:${resto}`
}

// "Agora" que anda sozinho a cada segundo - só enquanto ligado, pra não
// redesenhar a página inteira à toa.
function useAgora(ligado: boolean) {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    if (!ligado) return
    const t = setInterval(() => setAgora(Date.now()), 1000)
    return () => clearInterval(t)
  }, [ligado])
  return agora
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

// "apaga hoje", "apaga amanhã", "apaga em 2 dias" - pra quem quer guardar o
// corte saber quanto tempo tem pra baixar.
function quandoApaga(iso: string) {
  const horas = (new Date(iso).getTime() - Date.now()) / 3600000
  if (horas <= 0) return "apaga em instantes"
  if (horas < 24) return `apaga em ${Math.max(1, Math.round(horas))}h`
  const dias = Math.round(horas / 24)
  return dias === 1 ? "apaga amanhã" : `apaga em ${dias} dias`
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
  if (c.bloqueio === "fora_do_plano") {
    return { texto: "Fora do seu plano: este canal não está sendo clipado. Remova outro canal ou troque de plano", tom: "ambar" }
  }
  if (c.aoVivo && c.bloqueio === "outra_live") {
    return { texto: "Ao vivo · seu plano clipa 1 live por vez e outra já está sendo clipada", tom: "ambar" }
  }
  if (c.aoVivo && c.semCredito) return { texto: "Seus créditos acabaram — esta live parou de ser clipada", tom: "ambar" }
  if (c.aoVivo && c.recebendoCortes && c.gravacao) {
    const gasto = c.creditosNestaLive ? ` · ${c.creditosNestaLive} ${c.creditosNestaLive === 1 ? "crédito" : "créditos"}` : ""
    return {
      texto: `${c.clipandoEstaLive && !c.autoClipar ? "Clipando esta live" : "Clipando"} há ${duracaoCurta(c.gravacao.segundosGravados)}${gasto}`,
      tom: "vermelho",
    }
  }
  if (c.aoVivo && c.recebendoCortes) {
    if (servicoAtivo && c.semGravar) return { texto: TEXTO_SEM_GRAVAR[c.semGravar.motivo], tom: "ambar" }
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

// Quanto vale o crédito nas lives (pedido de 12/10/2026): os mesmos créditos
// dos cortes do YouTube, e a conta escrita com os números do servidor.
function QuantoValeOCredito({ creditos }: { creditos: Estado["creditos"] }) {
  const porHora = Math.round(60 / creditos.minutosDeLivePorCredito)
  const minutos = creditos.disponiveis * creditos.minutosDeLivePorCredito
  const tempo =
    minutos >= 60
      ? `${Math.floor(minutos / 60)} h${minutos % 60 ? ` ${Math.round(minutos % 60)} min` : ""}`
      : `${minutos} min`
  return (
    <div data-tour="lives-credito" className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-3">
      <div className="bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Live clipada</p>
        <p className="font-heading text-base font-semibold">{creditos.minutosDeLivePorCredito} min = 1 crédito</p>
        <p className="text-xs text-muted-foreground">1 hora de live gasta {porHora} créditos</p>
      </div>
      <div className="bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Clipar este momento</p>
        <p className="font-heading text-base font-semibold">{creditos.cliparAgora} crédito por clique</p>
        <p className="text-xs text-muted-foreground">Só gasta enquanto a live é clipada pra você</p>
      </div>
      <div className="bg-card px-4 py-3">
        <p className="text-xs text-muted-foreground">Seu saldo</p>
        {creditos.isento ? (
          <p className="font-heading text-base font-semibold">Isento (admin)</p>
        ) : (
          <>
            <p className="font-heading text-base font-semibold tabular-nums">
              {creditos.disponiveis} créditos ≈ {tempo} de live
            </p>
            <a href="/client/billing?aba=comprar" className="text-xs font-medium text-primary underline-offset-4 hover:underline">
              Comprar mais créditos →
            </a>
          </>
        )}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- clipar este momento

// Secundário de propósito (pequeno e preto): com a live já sendo clipada, o
// sistema acha os momentos sozinho; o botão é pra quando a pessoa viu algo e
// quer garantir. O aviso diz, no relógio da live, qual trecho vira corte -
// sem ele não dá pra saber se o momento que acabou de passar ainda cabe.
function ClipeDesteMomento({
  canal: c,
  janelaS,
  agora,
  recebidoEm,
  ocupado,
  onClipar,
}: {
  canal: Canal
  janelaS: number
  agora: number
  recebidoEm: number
  ocupado: boolean
  onClipar: () => void
}) {
  if (!c.gravacao) return null
  // A gravação anda enquanto a tela está aberta. O servidor corta pelo que já
  // foi GRAVADO (pedaços de 10s), então o fim real fica alguns segundos atrás
  // do "agora" - por isso o "~".
  const gravado = c.gravacao.segundosGravados + Math.max(0, (agora - recebidoEm) / 1000)
  const inicioDaGravacao = new Date(c.gravacao.desde).getTime()
  const inicioDaLive = c.aoVivoDesde ? new Date(c.aoVivoDesde).getTime() : null
  // Desde quando a gravação começou, contado no relógio da live.
  const deslocamento = inicioDaLive && inicioDaLive <= inicioDaGravacao ? (inicioDaGravacao - inicioDaLive) / 1000 : null
  const fim = (deslocamento ?? 0) + gravado
  const inicio = Math.max(deslocamento ?? 0, fim - janelaS)
  const relogioRotulo = deslocamento !== null ? "da live" : "da gravação"
  const naLive = inicioDaLive ? (agora - inicioDaLive) / 1000 : null

  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 text-left">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium tabular-nums">
          <IconClock className="size-3.5 text-muted-foreground" />
          {naLive !== null ? `Live em ${relogioDeLive(naLive)}` : `Gravando há ${relogioDeLive(gravado)}`}
        </span>
        {naLive !== null && (
          <span className="tabular-nums text-muted-foreground">gravando há {relogioDeLive(gravado)}</span>
        )}
      </div>
      <p className="text-xs leading-relaxed text-muted-foreground">
        Clipar este momento analisa os últimos {relogio(janelaS)} — de{" "}
        <strong className="font-semibold tabular-nums text-foreground">~{relogioDeLive(inicio)}</strong> a{" "}
        <strong className="font-semibold tabular-nums text-foreground">~{relogioDeLive(fim)}</strong> {relogioRotulo} — e a IA
        recorta o melhor trecho dessa janela.
      </p>
      <Button
        size="sm"
        className="w-full bg-neutral-900 text-white hover:bg-neutral-800 dark:border dark:border-neutral-700 dark:bg-black dark:text-white dark:hover:bg-neutral-900"
        disabled={ocupado}
        onClick={onClipar}
        title={`Cria um corte com o melhor trecho dos últimos ${relogio(janelaS)}`}
      >
        {ocupado ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconScissors className="size-3.5" />}
        <span className="truncate">{ocupado ? "Enviando…" : "Clipar este momento · 1 crédito"}</span>
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------- cartão do canal

// Tudo do canal mora no próprio cartão (pedido de 07/10/2026): clipar sempre,
// ver clipes, abrir e remover - sem engrenagem nem janela escondendo opção.
function CartaoCanal({
  canal: c,
  servicoAtivo,
  ocupado,
  salvando,
  janelaS,
  onClipar,
  onAutomatico,
  onParar,
  onRemover,
  onVerCortes,
}: {
  canal: Canal
  servicoAtivo: boolean
  ocupado: boolean
  salvando: boolean
  janelaS: number
  onClipar: () => void
  onAutomatico: (ligado: boolean) => void
  onParar: () => void
  onRemover: () => void
  onVerCortes: () => void
}) {
  const [confirmandoRemover, setConfirmandoRemover] = useState(false)
  const sit = situacao(c, servicoAtivo)
  const marca = MARCA[c.plataforma]
  const clipandoAgora = c.aoVivo && c.recebendoCortes && Boolean(c.gravacao)
  const preparando = c.aoVivo && c.recebendoCortes && !c.gravacao && !c.semCredito
  // Carimbo de quando a resposta chegou: a gravação anda enquanto a tela está
  // aberta, e o aviso da janela tem que andar junto.
  const [recebidoEm, setRecebidoEm] = useState(() => Date.now())
  const gravadoNoServidor = c.gravacao?.segundosGravados
  useEffect(() => {
    // A página se atualiza sozinha: cada número novo do servidor vira o novo
    // ponto de partida (senão o tempo aberto seria somado duas vezes).
    setRecebidoEm(Date.now())
  }, [gravadoNoServidor])
  const agora = useAgora(clipandoAgora)

  let rotuloClipar = "Clipar"
  let ajuda = "Disponível quando o canal estiver ao vivo"
  const foraDoPlano = c.bloqueio === "fora_do_plano"
  if (foraDoPlano) {
    rotuloClipar = "Fora do seu plano"
    ajuda = "Remova outro canal ou troque de plano em Plano e uso"
  } else if (c.aoVivo && c.semCredito) {
    rotuloClipar = "Sem créditos"
    ajuda = "Compre créditos em Plano e uso pra voltar a clipar"
  } else if (preparando && c.semGravar?.motivo === "servidor_cheio") {
    rotuloClipar = "Esperando vaga…"
    ajuda = "O servidor está cheio agora; a gravação começa sozinha quando abrir vaga"
  } else if (c.aoVivo && !c.recebendoCortes) {
    rotuloClipar = "Clipar esta live"
    ajuda = "Grava e corta os melhores momentos desta live, até ela acabar"
  } else if (preparando) {
    rotuloClipar = "Começando…"
    ajuda = "A gravação começa em até 1 minuto"
  }
  const totalDeCortes = c.cortesProntos + c.cortesEmAndamento

  return (
    <article
      className={cn(
        "relative flex min-w-0 flex-col overflow-hidden rounded-2xl bg-card shadow-[var(--shadow-flat)] transition-shadow hover:shadow-[var(--shadow-raised)] dark:border dark:border-border",
        c.aoVivo && "ring-1 ring-red-500/40",
      )}
    >
      {/* Faixa com a cor da plataforma, por trás da foto. */}
      <div className={cn("h-20 bg-gradient-to-br", marca.faixa)} aria-hidden />

      <div className="-mt-12 flex flex-col items-center px-4 text-center sm:px-5">
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

        <h3 className="mt-4 max-w-full truncate font-heading text-lg font-semibold tracking-[-0.01em]" title={c.nome}>
          {c.nome}
        </h3>
        <div className="flex max-w-full flex-wrap items-center justify-center gap-x-2 text-xs text-muted-foreground">
          <span className="max-w-full truncate">@{c.login}</span>
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

        {c.aoVivo && (
          <div className="mt-3 w-full text-sm">
            <p className="line-clamp-1 font-medium" title={c.tituloDaLive || undefined}>
              {c.tituloDaLive || "Ao vivo"}
            </p>
            {c.jogo && <p className="line-clamp-1 text-xs text-muted-foreground">{c.jogo}</p>}
          </div>
        )}
      </div>

      <div className="mx-4 mt-3 flex items-center gap-2 rounded-lg bg-muted/60 px-3 py-2 text-xs sm:mx-5">
        <span className="relative flex size-2 shrink-0">
          {sit.tom === "vermelho" && (
            <span className="absolute inline-flex size-full animate-ping rounded-full bg-red-500 opacity-60 motion-reduce:animate-none" />
          )}
          <span className={cn("relative inline-flex size-2 rounded-full", COR_SITUACAO[sit.tom])} />
        </span>
        <span className="min-w-0 flex-1 text-left">{sit.texto}</span>
      </div>

      {/* Clipando agora: o que a máquina está fazendo com esta live. Com o
          serviço pausado nada está sendo gravado, e a tela não pode dizer que está. */}
      {clipandoAgora && servicoAtivo && (
        <div className="maq maq-origem-live mx-4 mt-2 rounded-lg border border-border px-3 py-2 text-left sm:mx-5">
          <Onda barras={44} altura="h-4" />
          <p className="mt-1.5 text-[11.5px] leading-snug text-muted-foreground">
            Gravando e ouvindo · a IA escolhe os melhores momentos
            {c.cortesEmAndamento > 0 && (
              <span className="text-[var(--maq-live)]">
                {" "}· {c.cortesEmAndamento} {c.cortesEmAndamento === 1 ? "sendo cortado" : "sendo cortados"}
              </span>
            )}
          </p>
        </div>
      )}

      {/* Clipar sempre: a escolha principal do canal, sempre à vista. */}
      <label className="mx-4 mt-2 flex cursor-pointer items-center justify-between gap-3 rounded-lg px-1 py-2 sm:mx-5">
        <span className="min-w-0 text-left">
          <span className="block text-sm font-medium">Clipar sempre que estiver ao vivo</span>
          <span className="block text-xs text-muted-foreground">
            {c.autoClipar ? "Toda live deste canal vira cortes sozinha" : "Você clipa só quando apertar o botão"}
          </span>
        </span>
        <Interruptor ligado={c.autoClipar} disabled={salvando} onChange={onAutomatico} rotulo={`Clipar ${c.nome} sempre que estiver ao vivo`} />
      </label>

      <div className="mt-auto flex flex-col gap-2 p-4 pt-3 sm:p-5 sm:pt-3">
        {clipandoAgora ? (
          <>
            {/* Clipando: a ação principal vira PARAR (pedido de 08/10/2026).
                Com "Clipar sempre" ligado, parar desliga o automático - não
                existe "pular só esta live" sem desligá-lo. */}
            <Button
              variant="outline"
              className="w-full border-red-600 text-red-600 hover:bg-red-50 hover:text-red-700 dark:border-red-500 dark:text-red-400 dark:hover:bg-red-950/40"
              disabled={salvando}
              onClick={onParar}
              title={c.autoClipar ? "Para de clipar agora e desliga o “Clipar sempre” deste canal" : "Para de clipar esta live agora"}
            >
              {salvando ? <IconLoader2 className="size-4 animate-spin" /> : <IconPlayerStopFilled className="size-4" />}
              <span className="truncate">Parar de clipar</span>
            </Button>
            <ClipeDesteMomento
              canal={c}
              janelaS={janelaS}
              agora={agora}
              recebidoEm={recebidoEm}
              ocupado={ocupado}
              onClipar={onClipar}
            />
          </>
        ) : (
          <Button
            variant={c.aoVivo && !foraDoPlano ? "default" : "outline"}
            className={cn(
              "w-full",
              c.aoVivo && !preparando && !c.semCredito && !foraDoPlano && "bg-red-600 text-white hover:bg-red-700 dark:bg-red-600 dark:text-white dark:hover:bg-red-700",
            )}
            disabled={!c.aoVivo || preparando || ocupado || c.semCredito || foraDoPlano}
            onClick={onClipar}
            title={ajuda}
          >
            {ocupado || preparando ? <IconLoader2 className="size-4 animate-spin" /> : <IconScissors className="size-4" />}
            <span className="truncate">{ocupado ? "Enviando…" : rotuloClipar}</span>
          </Button>
        )}

        {confirmandoRemover ? (
          <div className="flex flex-col gap-2 rounded-lg bg-destructive/5 p-2 text-left">
            <p className="text-xs">Remover {c.nome}? Os cortes já feitos continuam na lista até apagarem sozinhos.</p>
            <div className="grid grid-cols-2 gap-2">
              <Button size="sm" variant="destructive" disabled={salvando} onClick={onRemover}>
                Remover
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirmandoRemover(false)}>
                Voltar
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-[1fr_auto_auto] gap-2">
            <Button variant="outline" size="sm" className="min-w-0" onClick={onVerCortes} disabled={!totalDeCortes} title="Ver os clipes deste canal">
              {c.cortesEmAndamento > 0 ? <IconLoader2 className="size-3.5 animate-spin" /> : <IconPlayerPlayFilled className="size-3.5" />}
              <span className="truncate">Ver clipes{totalDeCortes ? ` (${c.cortesProntos})` : ""}</span>
            </Button>
            <Button variant="outline" size="sm" asChild title={`Abrir o canal na ${marca.nome}`}>
              <a href={c.url} target="_blank" rel="noreferrer" aria-label={`Abrir ${c.nome} na ${marca.nome}`}>
                <IconExternalLink className="size-3.5" />
                <span className="hidden sm:inline">Abrir</span>
              </a>
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={() => setConfirmandoRemover(true)}
              aria-label={`Remover ${c.nome}`}
              title="Remover canal"
            >
              <IconTrash className="size-3.5" />
            </Button>
          </div>
        )}
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
          // O corte sendo montado: o mesmo desenho da linha de produção do
          // Início (quadriculado, linha subindo com o progresso REAL do render,
          // legenda sendo escrita). Na fila: só a moldura tracejada.
          <div className="maq maq-origem-live absolute inset-0">
            <div
              className="maq-quadro absolute inset-0 rounded-none border-0"
              data-s={k.status === "renderizando" ? "rendering" : "pending"}
              style={{ ["--p" as string]: `${Math.max(4, k.progresso)}%` }}
            >
              {k.status === "renderizando" && (
                <>
                  <span className="maq-scan" />
                  <span className="maq-legenda" aria-hidden="true">
                    <span style={{ ["--w" as string]: "100%" }} />
                    <span style={{ ["--w" as string]: "64%" }} />
                  </span>
                </>
              )}
            </div>
            <span className="absolute inset-x-0 top-1/3 text-center text-xs font-medium text-muted-foreground">
              {k.status === "renderizando" ? (
                <>
                  Cortando <span className="font-mono tabular-nums text-[var(--maq-live)]">{k.progresso}%</span>
                </>
              ) : (
                "Na fila"
              )}
            </span>
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
        {k.status === "pronto" && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconClock className="size-3" /> {quandoApaga(k.apagaEm)}
          </p>
        )}
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
  const [salvandoCanal, setSalvandoCanal] = useState<number | null>(null)
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

  async function acaoNoCanal(id: number, acao: () => Promise<Estado>) {
    setSalvandoCanal(id)
    await salvar(acao, "Não consegui salvar.")
    setSalvandoCanal(null)
  }

  // Parar desfaz o que estiver fazendo o canal ser clipado: o "clipar esta
  // live" e, se estiver ligado, o "Clipar sempre".
  async function pararDeClipar(c: Canal): Promise<Estado> {
    let novo: Estado | null = null
    if (c.clipandoEstaLive) novo = await api.delete<Estado>(`${API}/canais/${c.id}/clipar-esta-live`)
    if (c.autoClipar) novo = await api.put<Estado>(`${API}/canais/${c.id}/automatico`, { ligado: false })
    return novo ?? (await api.get<Estado>(API))
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
            {/* No celular o saldo desce pra linha de baixo (ver abaixo): lado a lado com o botão não cabe em 320px. */}
            {estado && (
              <span className="hidden sm:inline-flex">
                <SaldoDeCreditos creditos={estado.creditos} />
              </span>
            )}
            <Button onClick={() => setAdicionarAberto(true)} data-tour="adicionar-live">
              <IconPlus className="size-4" /> Adicionar canal
            </Button>
          </>
        }
      />

      {estado && (
        <div className="-mt-2 sm:hidden">
          <SaldoDeCreditos creditos={estado.creditos} />
        </div>
      )}

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
          {estado && <QuantoValeOCredito creditos={estado.creditos} />}
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
                {estado.limites && estado.limites.canais !== null && (
                  <span className="ml-2 normal-case tracking-normal text-muted-foreground">
                    · seu plano: até {estado.limites.canais} {estado.limites.canais === 1 ? "canal" : "canais"}
                    {estado.limites.aoMesmoTempo !== null && `, ${estado.limites.aoMesmoTempo} ${estado.limites.aoMesmoTempo === 1 ? "live clipada" : "lives clipadas"} por vez`}
                  </span>
                )}
              </SectionLabel>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                {canaisOrdenados.map((c) => (
                  <CartaoCanal
                    key={c.id}
                    canal={c}
                    servicoAtivo={estado.servicoAtivo}
                    ocupado={clipando === c.id}
                    salvando={salvandoCanal === c.id}
                    onClipar={() => void clipar(c)}
                    onAutomatico={(v) => void acaoNoCanal(c.id, () => api.put<Estado>(`${API}/canais/${c.id}/automatico`, { ligado: v }))}
                    janelaS={estado.janelaCliparAgoraS ?? 150}
                    onParar={() => void acaoNoCanal(c.id, () => pararDeClipar(c))}
                    onRemover={() => void acaoNoCanal(c.id, () => api.delete<Estado>(`${API}/canais/${c.id}`)).then(() => filtroCanal === c.id && setFiltroCanal(null))}
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

              <p className="-mt-2 flex items-start gap-2 text-xs text-muted-foreground">
                <IconClock className="mt-px size-3.5 shrink-0" />
                <span>
                  Os cortes de live ficam aqui por <strong className="text-foreground">3 dias</strong> depois de prontos e são apagados
                  sozinhos. Baixe os que quiser guardar.
                </span>
              </p>

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

              {k.status === "pronto" && (
                <p className="flex items-start gap-2 rounded-lg bg-muted/60 p-3 text-xs text-muted-foreground">
                  <IconClock className="mt-px size-3.5 shrink-0" />
                  <span>
                    Este corte é apagado sozinho em{" "}
                    <strong className="text-foreground">
                      {new Date(k.apagaEm).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })}
                    </strong>{" "}
                    (3 dias depois de pronto). Baixe se quiser guardar.
                  </span>
                </p>
              )}

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

function Ajustes({
  estado,
  salvar,
}: {
  estado: Estado
  salvar: (acao: () => Promise<Estado>, padrao: string) => Promise<boolean>
}) {
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

      <EstiloDosTextos />
    </>
  )
}

// Modelo do título e da legenda dos cortes de live. O ENQUADRAMENTO não é
// escolha aqui: a IA monta o formato de cada corte (câmera, câmera + vídeo,
// metade/metade) - um editor de enquadramento só brigaria com ela. O que a
// pessoa escolhe é o visual do texto, e é isso que esta caixa mostra.
function EstiloDosTextos() {
  const [estilo, setEstilo] = useState<ClientVideoSettingsResponse | null>(null)
  const [erro, setErro] = useState<string | null>(null)

  useEffect(() => {
    api.get<ClientVideoSettingsResponse>(`${API}/estilo`).then(setEstilo, (e) => setErro(mensagem(e, "Não consegui carregar o estilo.")))
  }, [])

  async function salvar(parcial: Partial<ClientVideoSettingsResponse>) {
    if (!estilo) return
    const anterior = estilo
    setEstilo({ ...estilo, ...parcial })
    setErro(null)
    try {
      setEstilo(await api.put<ClientVideoSettingsResponse>(`${API}/estilo`, parcial))
    } catch (e) {
      setEstilo(anterior)
      setErro(mensagem(e, "Não consegui salvar."))
    }
  }

  if (!estilo) return erro ? <p className="text-sm text-destructive">{erro}</p> : <Skeleton className="h-64 w-full" />
  const usaCorNoTitulo = ["caixa_colorida", "papel_rasgado", "cartao", "faixa_colorida"].includes(estilo.titleStyle)
  const usaCorNaLegenda = estilo.captionStyle === "caixa_colorida"
  const opcoesDeLegenda = estilo.options.captionStyles.filter((x) => x !== "none")

  return (
    <>
      {erro && <p className="text-sm text-destructive">{erro}</p>}
      <div className="grid gap-6 lg:grid-cols-[260px_minmax(0,1fr)]">
        {/* Prévia dos dois juntos, no formato de um corte de live. */}
        <div className="lg:sticky lg:top-20 lg:self-start">
          <p className="mb-2 text-sm font-medium">Prévia</p>
          <CenaDePrevia
            cena="live"
            className="mx-auto w-full max-w-[240px] rounded-2xl shadow-[var(--shadow-raised)]"
            style={{
              ["--cor-da-caixa" as string]: estilo.titleBoxColor,
              ["--cor-da-letra-cartao" as string]: letraPelaCaixa(estilo.titleBoxColor),
            }}
          >
            {estilo.showTitle !== false && (
              <div className="absolute inset-x-0 top-[33%] flex justify-center px-[6%] text-center" style={{ fontSize: "7.5cqw" }}>
                <TextoNoModelo modelo={estilo.titleStyle} texto="Comprei um carro de 2 milhões" fonte={estilo.titleFont} />
              </div>
            )}
            <div
              className="absolute inset-x-0 bottom-[20%] flex justify-center text-center"
              style={{ fontSize: "11cqw", ["--cor-da-caixa" as string]: estilo.captionBoxColor }}
            >
              <TextoNoModelo modelo={estilo.captionStyle} texto="olha isso" fonte={estilo.captionFont} />
            </div>
          </CenaDePrevia>
          <p className="mx-auto mt-2 max-w-[240px] text-center text-xs text-muted-foreground">
            Em cada corte a IA escolhe o formato e põe o título e a legenda onde não cobrem o streamer nem o vídeo.
          </p>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Modelo do título</CardTitle>
              <CardDescription>Aparece nos primeiros segundos de cada corte.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {usaCorNoTitulo && <SeletorDeCor rotulo="Cor do fundo do título" valor={estilo.titleBoxColor} onChange={(v) => void salvar({ titleBoxColor: v })} />}
              <GaleriaDeEstilos
                tipo="titulo"
                cena="live"
                options={estilo.options.titleStyles}
                value={estilo.titleStyle}
                onChange={(v) => void salvar({ titleStyle: v })}
                sampleText="Título do corte"
                corDaCaixa={estilo.titleBoxColor}
                fonte={estilo.titleFont}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Modelo da legenda</CardTitle>
              <CardDescription>A fala do streamer, palavra por palavra, durante o corte todo.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {usaCorNaLegenda && <SeletorDeCor rotulo="Cor da caixa da legenda" valor={estilo.captionBoxColor} onChange={(v) => void salvar({ captionBoxColor: v })} />}
              <GaleriaDeEstilos
                tipo="legenda"
                cena="live"
                options={opcoesDeLegenda}
                value={estilo.captionStyle}
                onChange={(v) => void salvar({ captionStyle: v })}
                sampleText="olha"
                corDaCaixa={estilo.captionBoxColor}
                fonte={estilo.captionFont}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </>
  )
}

// Cor da caixa: as do painel de sempre + qualquer outra pelo seletor do sistema.
const CORES_RAPIDAS = ["#D92323", "#7C3FD4", "#2F54EB", "#0B8EA8", "#15803D", "#F59E0B", "#111111", "#FFFFFF"]
function SeletorDeCor({ rotulo, valor, onChange }: { rotulo: string; valor: string; onChange: (v: string) => void }) {
  // O seletor do sistema dispara a cada movimento do arraste: salvar cada um
  // mandaria dezenas de pedidos, e o mais lento podia vencer com a cor velha.
  const espera = useRef<ReturnType<typeof setTimeout> | null>(null)
  const depois = (v: string) => {
    if (espera.current) clearTimeout(espera.current)
    espera.current = setTimeout(() => onChange(v), 400)
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-sm text-muted-foreground">{rotulo}</span>
      {CORES_RAPIDAS.map((cor) => (
        <button
          key={cor}
          type="button"
          aria-label={`Cor ${cor}`}
          aria-pressed={valor.toUpperCase() === cor}
          onClick={() => onChange(cor)}
          className={cn("size-7 rounded-full border shadow-sm", valor.toUpperCase() === cor && "ring-2 ring-foreground ring-offset-2 ring-offset-card")}
          style={{ background: cor }}
        />
      ))}
      <label className="relative size-7 cursor-pointer overflow-hidden rounded-full border bg-[conic-gradient(red,yellow,lime,cyan,blue,magenta,red)]" title="Outra cor">
        <input type="color" defaultValue={valor} onChange={(e) => depois(e.target.value.toUpperCase())} className="absolute inset-0 cursor-pointer opacity-0" aria-label="Outra cor" />
      </label>
    </div>
  )
}
