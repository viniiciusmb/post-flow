import { useCallback, useEffect, useRef, useState } from "react"
import { IconMicrophone, IconTrash, IconDownload, IconAlertTriangle, IconSparkles, IconPhoto } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill, type Tone } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"

type Politica = "economico" | "qualidade"

type VideoNarrado = {
  id: number
  title: string
  aspect: string
  imagePolicy: Politica
  voiceProvider: string
  voiceId: string
  burnCaptions: boolean
  status: string
  progressPercent: number
  durationSeconds: number | null
  errorMessage: string | null
  attempts: number
  createdAt: string
  custoUsd: number | null
  totalCenas: number | null
  cenasIa: number | null
  temArquivo: boolean
}

type Opcoes = {
  aspectos: string[]
  politicas: Politica[]
  vozes: string[]
  elevenlabsDisponivel: boolean
  maxCharsRoteiro: number
  charsPorSegundo: number
}

type Previa = { cenas: number; chars: number; segundosEstimados: number; primeirasCenas: string[] }

const ROTULO: Record<string, { texto: string; tone: Tone }> = {
  na_fila: { texto: "Na fila", tone: "neutral" },
  roteirizando: { texto: "Planejando as imagens", tone: "indigo" },
  narrando: { texto: "Gravando a narração", tone: "indigo" },
  ilustrando: { texto: "Buscando as imagens", tone: "cyan" },
  montando: { texto: "Montando o vídeo", tone: "violet" },
  pronto: { texto: "Pronto", tone: "success" },
  erro: { texto: "Falhou", tone: "danger" },
  cancelado: { texto: "Cancelado", tone: "neutral" },
}

const EM_ANDAMENTO = ["na_fila", "roteirizando", "narrando", "ilustrando", "montando"]

function usd(v: number | null | undefined) {
  if (v === null || v === undefined) return "—"
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`
}

function duracao(segundos: number | null) {
  if (!segundos) return "—"
  const m = Math.floor(segundos / 60)
  const s = Math.round(segundos % 60)
  // Abaixo de um minuto, "0min 22s" só atrapalha a leitura.
  if (m === 0) return `${s}s`
  return `${m}min ${String(s).padStart(2, "0")}s`
}

export function AdminNarratedPage() {
  // TODOS os hooks antes de qualquer return condicional. Hook declarado depois
  // de um `if (...) return null` faz a primeira renderização declarar menos
  // hooks que a seguinte — React error #310, tela completamente branca. Foi
  // exatamente assim que /client/billing quebrou em produção.
  const { user, loading: authLoading, logout } = useAuth()

  const [videos, setVideos] = useState<VideoNarrado[]>([])
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null)
  const [carregando, setCarregando] = useState(true)

  const [titulo, setTitulo] = useState("")
  const [roteiro, setRoteiro] = useState("")
  const [aspect, setAspect] = useState("16:9")
  const [politica, setPolitica] = useState<Politica>("economico")
  const [voz, setVoz] = useState("onyx")
  const [legenda, setLegenda] = useState(true)
  const [previa, setPrevia] = useState<Previa | null>(null)
  const [enviando, setEnviando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)
  const [confirmandoExclusao, setConfirmandoExclusao] = useState<number | null>(null)

  const carregar = useCallback(async () => {
    try {
      const r = await api.get<{ videos: VideoNarrado[]; options: Opcoes }>("/api/admin/narrated")
      setVideos(r.videos)
      setOpcoes(r.options)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar a lista.")
    } finally {
      setCarregando(false)
    }
  }, [])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Enquanto houver vídeo em andamento, recarrega: a geração leva minutos e a
  // barra parada faz parecer travado.
  const temAndamento = videos.some((v) => EM_ANDAMENTO.includes(v.status))
  useEffect(() => {
    if (!temAndamento) return
    const t = setInterval(() => void carregar(), 5000)
    return () => clearInterval(t)
  }, [temAndamento, carregar])

  // Prévia do roteiro: quantas cenas e quanto deve durar, sem gastar nada.
  // Só depois de parar de digitar — uma requisição por tecla mandaria dezenas
  // e a mais lenta poderia vencer com um texto pela metade.
  const timerPrevia = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (timerPrevia.current) clearTimeout(timerPrevia.current)
    if (!roteiro.trim()) {
      setPrevia(null)
      return
    }
    timerPrevia.current = setTimeout(() => {
      api
        .post<Previa>("/api/admin/narrated/preview", { script: roteiro })
        .then(setPrevia)
        .catch(() => setPrevia(null))
    }, 500)
    return () => {
      if (timerPrevia.current) clearTimeout(timerPrevia.current)
    }
  }, [roteiro])

  async function criar() {
    setErro(null)
    setEnviando(true)
    try {
      await api.post("/api/admin/narrated", {
        title: titulo,
        script: roteiro,
        aspect,
        imagePolicy: politica,
        voiceProvider: "openai",
        voiceId: voz,
        burnCaptions: legenda,
      })
      setTitulo("")
      setRoteiro("")
      setPrevia(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui criar o vídeo.")
    } finally {
      setEnviando(false)
    }
  }

  async function excluir(id: number) {
    try {
      await api.delete(`/api/admin/narrated/${id}`)
      setConfirmandoExclusao(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui excluir.")
    }
  }

  if (authLoading || !user) return null

  const podeEnviar = titulo.trim().length > 0 && roteiro.trim().length > 0 && !enviando

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeo narrado">
      <p className="text-sm text-muted-foreground">
        Cole um roteiro e o sistema gera o vídeo inteiro: narração, imagens ilustrando cada trecho, legenda e
        montagem. Em <strong>modo de teste</strong> — só você vê esta tela, e o custo é registrado sem
        descontar da cota de ninguém.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-tone-danger-wash bg-tone-danger-wash/40 p-3 text-sm">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-tone-danger-ink" />
          <span>{erro}</span>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Novo vídeo</CardTitle>
          <CardDescription>
            A narração é gerada trecho a trecho, e cada trecho ganha uma imagem que ilustra o que está sendo
            dito naquele momento.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="flex flex-col gap-2">
            <Label htmlFor="titulo">Nome do vídeo</Label>
            <Input
              id="titulo"
              value={titulo}
              onChange={(e) => setTitulo(e.target.value)}
              placeholder="A Peste Negra"
              maxLength={200}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="roteiro">Roteiro</Label>
            <textarea
              id="roteiro"
              value={roteiro}
              onChange={(e) => setRoteiro(e.target.value)}
              placeholder={"Cole aqui o texto que será narrado.\n\nSepare os assuntos em parágrafos — é neles que o sistema troca a imagem."}
              rows={12}
              maxLength={opcoes?.maxCharsRoteiro ?? 20000}
              className="min-h-48 w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            />
            {previa && (
              <p className="text-xs text-muted-foreground">
                {previa.chars.toLocaleString("pt-BR")} caracteres · <strong>{previa.cenas} cenas</strong> ·
                aproximadamente <strong>{duracao(previa.segundosEstimados)}</strong> de vídeo (estimativa — a
                duração real só existe depois da narração pronta)
              </p>
            )}
          </div>

          <div className="grid gap-5 sm:grid-cols-2">
            <div className="flex flex-col gap-2">
              <Label>Formato</Label>
              <ToggleGroup
                type="single"
                value={aspect}
                onValueChange={(v) => v && setAspect(v)}
                variant="outline"
                className="justify-start"
              >
                <ToggleGroupItem value="16:9" className="px-4">
                  16:9 · YouTube
                </ToggleGroupItem>
                <ToggleGroupItem value="9:16" className="px-4">
                  9:16 · TikTok
                </ToggleGroupItem>
              </ToggleGroup>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="voz">Voz</Label>
              <select
                id="voz"
                value={voz}
                onChange={(e) => setVoz(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
              >
                {(opcoes?.vozes ?? ["onyx"]).map((v) => (
                  <option key={v} value={v}>
                    {v === "onyx" ? "onyx (grave, documentário)" : v}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* O botão que separa os dois modos de imagem. Fica destacado e com o
              custo escrito porque é a decisão que mais muda a conta: entre um
              e outro o gasto praticamente dobra. */}
          <div className="flex flex-col gap-2">
            <Label>De onde vêm as imagens</Label>
            <ToggleGroup
              type="single"
              value={politica}
              onValueChange={(v) => v && setPolitica(v as Politica)}
              variant="outline"
              className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2"
            >
              <ToggleGroupItem
                value="economico"
                className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal px-4 py-3 text-left"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <IconPhoto className="size-4" /> Econômico
                </span>
                <span className="whitespace-normal text-xs font-normal opacity-80">
                  Acervo real primeiro. Só desenha por IA quando a busca não acha nada.
                </span>
              </ToggleGroupItem>
              <ToggleGroupItem
                value="qualidade"
                className="h-auto min-w-0 flex-col items-start gap-1 whitespace-normal px-4 py-3 text-left"
              >
                <span className="flex items-center gap-1.5 font-medium">
                  <IconSparkles className="size-4" /> Qualidade
                </span>
                <span className="whitespace-normal text-xs font-normal opacity-80">
                  A IA decide cena a cena o que fica melhor. Custa cerca do dobro.
                </span>
              </ToggleGroupItem>
            </ToggleGroup>
            <p className="text-xs text-muted-foreground">
              Gere o mesmo roteiro nos dois modos para comparar: o custo real de cada vídeo aparece na lista
              abaixo, ao lado do modo usado.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Checkbox id="legenda" checked={legenda} onCheckedChange={(c) => setLegenda(c === true)} />
            <Label htmlFor="legenda" className="font-normal">
              Queimar a legenda no vídeo
            </Label>
          </div>

          <div>
            <Button onClick={() => void criar()} disabled={!podeEnviar}>
              <IconMicrophone className="size-4" />
              {enviando ? "Enviando..." : "Gerar vídeo"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Vídeos gerados</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {carregando && <Skeleton className="h-24 w-full" />}
          {!carregando && videos.length === 0 && (
            <p className="text-sm text-muted-foreground">Nenhum vídeo ainda. Cole um roteiro acima.</p>
          )}

          {videos.map((v) => {
            const rotulo = ROTULO[v.status] ?? { texto: v.status, tone: "neutral" as Tone }
            const andando = EM_ANDAMENTO.includes(v.status)
            return (
              <div key={v.id} className="flex flex-col gap-3 rounded-lg border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-medium">{v.title}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                      <TonePill tone={rotulo.tone} spin={andando}>
                        {rotulo.texto}
                      </TonePill>
                      <span>{v.aspect}</span>
                      <span>·</span>
                      <span>{v.imagePolicy === "qualidade" ? "Qualidade" : "Econômico"}</span>
                      {v.totalCenas ? (
                        <>
                          <span>·</span>
                          <span>
                            {v.totalCenas} cenas{v.cenasIa ? ` (${v.cenasIa} por IA)` : ""}
                          </span>
                        </>
                      ) : null}
                      {v.durationSeconds ? (
                        <>
                          <span>·</span>
                          <span>{duracao(v.durationSeconds)}</span>
                        </>
                      ) : null}
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-heading text-lg font-semibold tabular-nums">{usd(v.custoUsd)}</div>
                    <div className="text-xs text-muted-foreground">
                      {v.custoUsd === null ? "ainda sem medição" : "custo real"}
                    </div>
                  </div>
                </div>

                {andando && (
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-primary transition-all"
                      style={{ width: `${Math.max(3, v.progressPercent)}%` }}
                    />
                  </div>
                )}

                {v.status === "erro" && v.errorMessage && (
                  <p className="text-xs text-tone-danger-ink">{v.errorMessage}</p>
                )}

                {v.status === "pronto" && v.temArquivo && (
                  <video
                    controls
                    preload="metadata"
                    className="w-full max-w-xl rounded-md border bg-black"
                    src={`/api/admin/narrated/${v.id}/download`}
                  />
                )}

                <div className="flex flex-wrap gap-2">
                  {v.status === "pronto" && v.temArquivo && (
                    <Button size="sm" variant="outline" asChild>
                      <a href={`/api/admin/narrated/${v.id}/download`} download>
                        <IconDownload className="size-4" /> Baixar
                      </a>
                    </Button>
                  )}
                  {/* Confirmação inline, sem popup nativo — mesmo padrão da
                      exclusão em lote de "Vídeos & Cortes". */}
                  <Button
                    size="sm"
                    variant={confirmandoExclusao === v.id ? "destructive" : "ghost"}
                    onClick={() =>
                      confirmandoExclusao === v.id ? void excluir(v.id) : setConfirmandoExclusao(v.id)
                    }
                    onBlur={() => setConfirmandoExclusao((atual) => (atual === v.id ? null : atual))}
                  >
                    <IconTrash className="size-4" />
                    {confirmandoExclusao === v.id ? "Confirmar exclusão" : "Excluir"}
                  </Button>
                </div>
              </div>
            )
          })}
        </CardContent>
      </Card>
    </DashboardLayout>
  )
}
