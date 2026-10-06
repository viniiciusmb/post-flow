import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react"
import {
  IconArrowUp,
  IconPlus,
  IconCircleCheckFilled,
  IconCheck,
  IconRefresh,
  IconUsers,
  IconArrowRight,
  IconVideoOff,
  IconCoins,
  IconBolt,
  IconBrandTiktok,
  IconHourglass,
  IconMap2,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { BrandMark } from "@/components/brand-mark"
import { iniciarTour } from "@/components/tour/GuidedTour"
import { Button } from "@/components/ui/button"
import { useAuth } from "@/hooks/useAuth"
import { api, csrfToken } from "@/lib/api"
import { cn } from "@/lib/utils"
import { useT, type ChaveDeTraducao } from "@/i18n"
import type {
  SupportAction,
  SupportConversationStatus,
  SupportCurrentResponse,
  SupportSendResponse,
  SupportShortcut,
  SupportStreamEvent,
} from "@/types/api"

type Linha = {
  chave: string
  autor: "cliente" | "suporte"
  texto: string
  acoes?: SupportAction[]
  /** Só a resposta que acabou de chegar aparece "sendo digitada". */
  digitar?: boolean
}

type Etapa = { chave: string; rotulo: ChaveDeTraducao }

const ROTULO_DA_FERRAMENTA: Record<string, ChaveDeTraducao> = {
  ver_minha_conta: "flora.etapaConta",
  listar_meus_videos: "flora.etapaVideos",
  diagnosticar_video: "flora.etapaDiagnostico",
  devolver_minutos_do_video: "flora.etapaDevolvendo",
  processar_video_de_novo: "flora.etapaReprocessando",
  ver_minhas_postagens: "flora.etapaPostagens",
  mostrar_atalho: "flora.etapaAtalho",
  encaminhar_para_equipe: "flora.etapaEquipe",
}

// Os atalhos que a Flora pode mostrar. O endereço é decidido AQUI, nunca pela
// IA: ela só escolhe um nome desta lista.
const ATALHOS: Record<SupportShortcut, { rotulo: ChaveDeTraducao; url?: string }> = {
  tour_guiado: { rotulo: "flora.atalhoTour" },
  tutorial: { rotulo: "flora.atalhoTutorial", url: "/client/tutorial" },
  cortes: { rotulo: "flora.atalhoCortes", url: "/client/videos-clips" },
  canais: { rotulo: "flora.atalhoCanais", url: "/client/youtube-channels" },
  publicacao: { rotulo: "flora.atalhoPublicacao", url: "/client/tiktok-account" },
  plano_e_uso: { rotulo: "flora.atalhoPlano", url: "/client/billing" },
  configuracoes: { rotulo: "flora.atalhoConfiguracoes", url: "/client/settings" },
  comissoes: { rotulo: "flora.atalhoComissoes", url: "/client/commissions" },
}

const PERGUNTAS_RAPIDAS: { chave: ChaveDeTraducao; icone: ReactNode }[] = [
  { chave: "flora.q1", icone: <IconVideoOff className="size-4" /> },
  { chave: "flora.q2", icone: <IconCoins className="size-4" /> },
  { chave: "flora.q3", icone: <IconBolt className="size-4" /> },
  { chave: "flora.q4", icone: <IconBrandTiktok className="size-4" /> },
  { chave: "flora.q5", icone: <IconHourglass className="size-4" /> },
  { chave: "flora.q6", icone: <IconMap2 className="size-4" /> },
]

function abrirAtalho(destino: SupportShortcut) {
  if (destino === "tour_guiado") return iniciarTour(true)
  const url = ATALHOS[destino]?.url
  if (url) window.location.href = url
}

function AvatarDaFlora({ trabalhando = false, grande = false }: { trabalhando?: boolean; grande?: boolean }) {
  return (
    <div className={cn("relative shrink-0", grande ? "size-16" : "size-8")}>
      {grande && <span className="flora-halo" aria-hidden="true" />}
      {trabalhando && <span className="flora-anel" aria-hidden="true" />}
      <div className="relative flex size-full items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm">
        <BrandMark className={grande ? "size-8" : "size-4"} />
      </div>
    </div>
  )
}

/** Revela o texto aos poucos, como quem digita. Quem já leu (histórico) vê tudo de uma vez. */
function TextoDigitado({ texto, digitar, aoTerminar }: { texto: string; digitar: boolean; aoTerminar: () => void }) {
  const [mostrados, setMostrados] = useState(digitar ? 0 : texto.length)
  const terminarRef = useRef(aoTerminar)
  useEffect(() => {
    terminarRef.current = aoTerminar
  })

  useEffect(() => {
    if (!digitar) return
    // Resposta longa digita mais rápido: ninguém quer esperar 20 s pra ler.
    const porVez = Math.max(2, Math.ceil(texto.length / 120))
    let atual = 0
    const timer = window.setInterval(() => {
      atual = Math.min(texto.length, atual + porVez)
      setMostrados(atual)
      if (atual >= texto.length) {
        window.clearInterval(timer)
        terminarRef.current()
      }
    }, 16)
    return () => window.clearInterval(timer)
  }, [digitar, texto])

  const digitando = mostrados < texto.length
  return <span className={cn(digitando && "flora-cursor")}>{texto.slice(0, mostrados)}</span>
}

function Acoes({ acoes, visiveis }: { acoes: SupportAction[]; visiveis: boolean }) {
  const t = useT()
  if (!visiveis || acoes.length === 0) return null
  const chips = acoes.filter((a) => a.tipo !== "atalho")
  const atalhos = acoes.filter((a): a is Extract<SupportAction, { tipo: "atalho" }> => a.tipo === "atalho")
  return (
    <div className="flora-entrar mt-3 flex flex-col gap-2">
      {chips.map((a, i) => (
        <span
          key={i}
          className={cn(
            "flex w-fit items-center gap-2 rounded-full px-3 py-1.5 text-xs font-medium",
            a.tipo === "devolucao" ? "bg-tone-success-wash text-tone-success-ink" : "bg-muted text-foreground",
          )}
        >
          {a.tipo === "devolucao" && (
            <>
              <IconCircleCheckFilled className="size-4" />
              {t("suporte.devolvidos", { minutos: a.minutos })}
            </>
          )}
          {a.tipo === "reprocessamento" && (
            <>
              <IconRefresh className="size-4" />
              {a.cobraDeNovo ? t("flora.reprocessandoCobra") : t("suporte.reprocessando")}
            </>
          )}
          {a.tipo === "encaminhado" && (
            <>
              <IconUsers className="size-4" />
              {t("suporte.encaminhada")}
            </>
          )}
        </span>
      ))}
      {atalhos.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {atalhos.map((a) => (
            <Button key={a.destino} variant="outline" size="sm" className="group rounded-full" onClick={() => abrirAtalho(a.destino)}>
              {t(ATALHOS[a.destino].rotulo)}
              <IconArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}

function MensagemDaFlora({ linha, aoTerminarDigitacao }: { linha: Linha; aoTerminarDigitacao: () => void }) {
  const [terminou, setTerminou] = useState(!linha.digitar)
  return (
    <div className="flora-entrar flex gap-3">
      <AvatarDaFlora />
      <div className="min-w-0 flex-1 pt-1">
        {/* Texto puro: o React escapa tudo, então nada que a IA escreva vira HTML. */}
        <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">
          <TextoDigitado
            texto={linha.texto}
            digitar={Boolean(linha.digitar)}
            aoTerminar={() => {
              setTerminou(true)
              aoTerminarDigitacao()
            }}
          />
        </p>
        <Acoes acoes={linha.acoes ?? []} visiveis={terminou} />
      </div>
    </div>
  )
}

function MensagemDoCliente({ texto }: { texto: string }) {
  return (
    <div className="flora-entrar flex justify-end">
      <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-3xl bg-muted px-4 py-2.5 text-[15px] leading-relaxed">
        {texto}
      </div>
    </div>
  )
}

function Trabalhando({ etapas }: { etapas: Etapa[] }) {
  const t = useT()
  const atual = etapas[etapas.length - 1]
  const feitas = etapas.slice(0, -1)
  return (
    <div className="flora-entrar flex gap-3">
      <AvatarDaFlora trabalhando />
      <div className="flex min-w-0 flex-col gap-1.5 pt-1.5 text-sm">
        {feitas.map((e) => (
          <span key={e.chave} className="flora-entrar flex items-center gap-2 text-muted-foreground">
            <IconCheck className="size-3.5" />
            {t(e.rotulo)}
          </span>
        ))}
        {atual && (
          <span key={atual.chave} className="flora-entrar flora-brilho font-medium">
            {t(atual.rotulo)}...
          </span>
        )}
      </div>
    </div>
  )
}

// Lê o envio em etapas (text/event-stream). Cada bloco "data: {...}" é um evento.
async function enviarEmEtapas(corpo: unknown, aoEvento: (e: SupportStreamEvent) => void) {
  const resposta = await fetch("/api/client/support/messages", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream", "X-CSRF-Token": csrfToken() },
    body: JSON.stringify(corpo),
  })
  if (!resposta.ok || !resposta.body) {
    const dados = await resposta.json().catch(() => ({}))
    throw new Error(dados.error || "")
  }
  const leitor = resposta.body.getReader()
  const decodificador = new TextDecoder()
  let resto = ""
  for (;;) {
    const { value, done } = await leitor.read()
    if (done) break
    resto += decodificador.decode(value, { stream: true })
    const blocos = resto.split("\n\n")
    resto = blocos.pop() ?? ""
    for (const bloco of blocos) {
      const linha = bloco.trim()
      if (linha.startsWith("data: ")) aoEvento(JSON.parse(linha.slice(6)) as SupportStreamEvent)
    }
  }
}

function acrescentarEtapa(lista: Etapa[] | null, chave: string, rotulo: ChaveDeTraducao): Etapa[] {
  // "Elaborando" é sempre a etapa da vez, nunca um item concluído: se a Flora
  // voltou a consultar algo, ele sai da lista e a consulta nova entra no lugar.
  let atual = lista ?? []
  if (atual.length && atual[atual.length - 1].rotulo === "flora.etapaElaborando" && rotulo !== "flora.etapaElaborando") {
    atual = atual.slice(0, -1)
  }
  // A mesma etapa duas vezes seguidas (ex: dois vídeos consultados) vira uma só.
  if (atual.length && atual[atual.length - 1].rotulo === rotulo) return atual
  return [...atual, { chave: `${chave}-${atual.length}`, rotulo }]
}

export function ClientSupportPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [carregando, setCarregando] = useState(true)
  const [conversaId, setConversaId] = useState<number | null>(null)
  const [status, setStatus] = useState<SupportConversationStatus>("aberta")
  const [linhas, setLinhas] = useState<Linha[]>([])
  const [texto, setTexto] = useState("")
  const [maxChars, setMaxChars] = useState(1500)
  const [etapas, setEtapas] = useState<Etapa[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const rolagemRef = useRef<HTMLDivElement>(null)
  const campoRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (!user) return
    api
      .get<SupportCurrentResponse>("/api/client/support")
      .then((r) => {
        setMaxChars(r.limits.maxChars)
        if (r.conversation) {
          setConversaId(r.conversation.id)
          setStatus(r.conversation.status)
          setLinhas(r.conversation.mensagens.map((m) => ({ chave: `m${m.id}`, autor: m.autor, texto: m.texto })))
        }
      })
      .catch(() => setErro(t("comum.erroGenerico")))
      .finally(() => setCarregando(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  useEffect(() => {
    // Sem mensagens, a tela inicial fica no topo (senão abre rolada pela metade no celular).
    if (linhas.length === 0 && !etapas) return
    const caixa = rolagemRef.current
    if (caixa) caixa.scrollTo({ top: caixa.scrollHeight, behavior: "smooth" })
  }, [linhas, etapas])

  // O campo cresce com o texto, até um teto.
  useEffect(() => {
    const campo = campoRef.current
    if (!campo) return
    campo.style.height = "auto"
    campo.style.height = `${Math.min(campo.scrollHeight, 200)}px`
  }, [texto])

  if (authLoading || !user) return null

  const enviando = etapas !== null

  function rolarParaOFim() {
    const caixa = rolagemRef.current
    if (caixa) caixa.scrollTo({ top: caixa.scrollHeight, behavior: "smooth" })
  }

  async function enviar(mensagemPronta?: string) {
    const mensagem = (mensagemPronta ?? texto).trim()
    if (!mensagem || enviando) return
    setErro(null)
    setTexto("")
    setLinhas((l) => [...l, { chave: `c${Date.now()}`, autor: "cliente", texto: mensagem }])
    setEtapas([{ chave: "inicio", rotulo: "flora.etapaPensando" }])

    let final: SupportSendResponse | null = null
    let falha: string | null = null
    try {
      await enviarEmEtapas({ conversationId: conversaId, message: mensagem }, (e) => {
        if (e.etapa === "ferramenta") {
          setEtapas((l) => acrescentarEtapa(l, e.nome, ROTULO_DA_FERRAMENTA[e.nome] ?? "flora.etapaPensando"))
        } else if (e.etapa === "elaborando") {
          setEtapas((l) => acrescentarEtapa(l, "elaborando", "flora.etapaElaborando"))
        } else if (e.etapa === "fim") {
          final = e
        } else if (e.etapa === "erro") {
          falha = e.error
        }
      })
    } catch (err) {
      falha = err instanceof Error && err.message ? err.message : t("comum.erroGenerico")
    }

    const r = final as SupportSendResponse | null
    if (r) {
      setConversaId(r.conversationId)
      setStatus(r.status)
      setLinhas((l) => [...l, { chave: `s${Date.now()}`, autor: "suporte", texto: r.resposta, acoes: r.acoes, digitar: true }])
    } else {
      // Sem resposta: devolve a mensagem pro campo pra não perder o que foi escrito.
      setLinhas((l) => l.slice(0, -1))
      setTexto(mensagem)
      setErro(falha || t("comum.erroGenerico"))
    }
    setEtapas(null)
    campoRef.current?.focus()
  }

  function aoTeclar(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      enviar()
    }
  }

  function novaConversa() {
    setConversaId(null)
    setStatus("aberta")
    setLinhas([])
    setErro(null)
    campoRef.current?.focus()
  }

  const vazio = !carregando && linhas.length === 0

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("suporte.titulo")}>
      <div className="mx-auto -mb-12 flex h-[calc(100svh-var(--header-height)-2rem)] min-h-[480px] w-full max-w-4xl flex-col overflow-hidden rounded-2xl border bg-card shadow-sm lg:mb-0 lg:h-[calc(100svh-var(--header-height)-3.5rem)]">
        {/* Cabeçalho */}
        <div className="flex items-center justify-between gap-3 border-b px-4 py-3 sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <AvatarDaFlora trabalhando={enviando} />
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="font-heading text-base font-semibold">Flora</span>
                <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className="flora-online size-2 rounded-full bg-tone-success-ink" />
                  {t("flora.online")}
                </span>
              </div>
              <p className="truncate text-xs text-muted-foreground">{t("flora.subtitulo")}</p>
            </div>
          </div>
          {linhas.length > 0 && (
            <Button variant="ghost" size="sm" className="rounded-full" onClick={novaConversa} disabled={enviando}>
              <IconPlus className="size-4" />
              <span className="hidden sm:inline">{t("suporte.novaConversa")}</span>
            </Button>
          )}
        </div>

        {/* Conversa */}
        <div ref={rolagemRef} className="flex-1 overflow-y-auto">
          {vazio ? (
            <div className="flex min-h-full flex-col items-center justify-center gap-6 px-4 py-10 text-center">
              <div className="flora-entrar">
                <AvatarDaFlora grande />
              </div>
              <div className="flora-entrar max-w-lg" style={{ animationDelay: "80ms" }}>
                <h1 className="font-heading text-2xl font-semibold">{t("flora.ola")}</h1>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{t("flora.olaTexto")}</p>
              </div>
              <div className="grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-2">
                {PERGUNTAS_RAPIDAS.map((q, i) => (
                  <button
                    key={q.chave}
                    type="button"
                    onClick={() => enviar(t(q.chave))}
                    style={{ animationDelay: `${140 + i * 50}ms` }}
                    className="flora-entrar group flex items-center gap-3 rounded-xl border bg-background px-4 py-3 text-left text-sm transition-colors hover:border-foreground/30 hover:bg-muted"
                  >
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground transition-colors group-hover:bg-background group-hover:text-foreground">
                      {q.icone}
                    </span>
                    <span className="min-w-0 flex-1">{t(q.chave)}</span>
                    <IconArrowRight className="size-4 shrink-0 text-muted-foreground opacity-0 transition-all group-hover:translate-x-0.5 group-hover:opacity-100" />
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 sm:px-6">
              {carregando && <div className="h-6 w-1/2 animate-pulse rounded bg-muted" />}
              {linhas.map((l) =>
                l.autor === "cliente" ? (
                  <MensagemDoCliente key={l.chave} texto={l.texto} />
                ) : (
                  <MensagemDaFlora key={l.chave} linha={l} aoTerminarDigitacao={rolarParaOFim} />
                ),
              )}
              {etapas && <Trabalhando etapas={etapas} />}
              {status === "encaminhada" && !enviando && (
                <p className="flora-entrar rounded-xl border px-4 py-3 text-sm text-muted-foreground">
                  <IconUsers className="mr-1.5 inline size-4" />
                  {t("suporte.encaminhada")}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Caixa de mensagem */}
        <div className="border-t bg-card px-3 pb-3 pt-3 sm:px-5">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              enviar()
            }}
            className="mx-auto flex w-full max-w-3xl items-end gap-2 rounded-3xl border bg-background px-3 py-2 shadow-sm transition-shadow focus-within:border-foreground/30 focus-within:shadow-md"
          >
            <textarea
              ref={campoRef}
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              onKeyDown={aoTeclar}
              placeholder={t("suporte.placeholder")}
              rows={1}
              maxLength={maxChars}
              // O contorno global de foco (globals.css, fora das camadas do
              // Tailwind) vence qualquer classe; o foco aqui já aparece na
              // borda da caixa inteira (focus-within).
              style={{ outline: "none" }}
              disabled={enviando || carregando}
              className="max-h-[200px] min-h-[40px] flex-1 resize-none border-0 bg-transparent px-2 py-2 text-[15px] shadow-none outline-none ring-0 placeholder:text-muted-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-0 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={enviando || carregando || !texto.trim()}
              aria-label={t("suporte.enviar")}
              className="mb-1 flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground transition-all hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-25"
            >
              <IconArrowUp className="size-5" />
            </button>
          </form>
          {erro && <p className="mx-auto mt-2 max-w-3xl px-2 text-sm text-destructive">{erro}</p>}
          <div className="mx-auto mt-2 flex max-w-3xl flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
            <span>{t("suporte.aviso")}</span>
            <span className="hidden sm:inline">
              {texto.length > maxChars * 0.8 ? t("suporte.caracteres", { usados: texto.length, max: maxChars }) : t("flora.enviarDica")}
            </span>
          </div>
        </div>
      </div>
    </DashboardLayout>
  )
}
