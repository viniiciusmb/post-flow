import { useCallback, useEffect, useMemo, useState } from "react"
import {
  IconBrandKick,
  IconBrandTwitch,
  IconScissors,
  IconTrash,
  IconDownload,
  IconPlayerRecordFilled,
  IconAlertTriangle,
  IconPlayerPauseFilled,
  IconPlayerPlayFilled,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill, type Tone } from "@/components/ui/tone-pill"
import { Checkbox } from "@/components/ui/checkbox"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { BarraDeQualidade, IconePlataforma, type Nivel, type Plataforma } from "@/components/lives/comum"

type Config = {
  maxCanais: number
  qualidade: string
  retencaoHoras: number
  discoMaxPercent: number
  horasPorCanalDia: number
}

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
  pausado: boolean
  tituloDaLive: string | null
  jogo: string | null
  espectadores: number | null
  ultimaChecagem: string | null
  ultimaGravacao: string | null
  gravacao: { sessaoId: number; desde: string; segundosGravados: number; bytes: number } | null
  cortesProntos: number
  cortesEmAndamento: number
}

type ResumoCusto = {
  canais: { id: number; login: string; custoUsd: number; horasGravadas: number; cortes: number }[]
  porTipo: Record<string, number>
}

type Estado = {
  ligado: boolean
  bloqueios: string[]
  avisos?: string[]
  config: Config
  limites: { faixas: Record<string, [number, number]>; qualidades: string[] }
  discoPercent: number | null
  canais: Canal[]
  custos: { hoje: ResumoCusto; seteDias: ResumoCusto }
  monitor?: { concordanciaTranscricao: number | null; amostrasTranscricao: number; chamadasFlex: number; chamadasTexto: number }
  opcoes: Opcoes
  niveis: Record<string, Nivel>
  categorias: Categoria[]
}

type Corte = {
  id: number
  canal: { id: number; login: string; nome: string }
  origem: "triagem" | "sinal" | "clipar_agora"
  duracao: number
  titulo: string | null
  gancho: string | null
  nota: number | null
  tipo: string | null
  categoria: string | null
  revisao: { veredito: "aprovado" | "corrigido" | "descartar"; notaHistoria: number | null; problemas: string } | null
  status: "na_fila" | "renderizando" | "pronto" | "erro"
  progresso: number
  erro: string | null
  criadoEm: string
  temArquivo: boolean
  temCapa: boolean
}

const CAMPOS: { chave: keyof Config; rotulo: string; ajuda: string; sufixo: string }[] = [
  { chave: "maxCanais", rotulo: "Lives clipadas ao mesmo tempo", ajuda: "Cada cliente recebendo cortes de cada live conta 1 (o corte é montado por cliente). Acima disso, quem entrar ao vivo espera vaga e o cliente vê o aviso. Com 2 núcleos, 2 é o recomendado.", sufixo: "lugares" },
  { chave: "horasPorCanalDia", rotulo: "Horas gravadas por canal por dia", ajuda: "Protege contra live de 24h.", sufixo: "horas" },
  { chave: "retencaoHoras", rotulo: "Apagar a gravação bruta depois de", ajuda: "Os cortes prontos não são apagados.", sufixo: "horas" },
  { chave: "discoMaxPercent", rotulo: "Parar de gravar com o disco em", ajuda: "Protege os cortes do YouTube.", sufixo: "%" },
]

const STATUS_CORTE: Record<Corte["status"], { texto: string; tone: Tone }> = {
  na_fila: { texto: "Na fila", tone: "neutral" },
  renderizando: { texto: "Renderizando", tone: "indigo" },
  pronto: { texto: "Pronto", tone: "success" },
  erro: { texto: "Falhou", tone: "danger" },
}

function duracao(segundos: number) {
  const s = Math.max(0, Math.round(segundos))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (h) return `${h}h${String(m).padStart(2, "0")}`
  if (m) return `${m}min`
  return `${s}s`
}

function usd(v: number) {
  const casas = v < 1 ? 3 : 2
  return `US$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas })}`
}

function somaCusto(r: ResumoCusto) {
  const custo = r.canais.reduce((s, c) => s + c.custoUsd, 0)
  const horas = r.canais.reduce((s, c) => s + c.horasGravadas, 0)
  const cortes = r.canais.reduce((s, c) => s + c.cortes, 0)
  return { custo, horas, cortes, porHora: horas > 0 ? custo / horas : null }
}

export function AdminLivesPage() {
  // Todos os hooks antes de qualquer return condicional (ver React #310 no
  // CLAUDE.md - tela branca em produção por hook declarado depois do return).
  const { user, loading: authLoading, logout } = useAuth()
  const [estado, setEstado] = useState<Estado | null>(null)
  const [cortes, setCortes] = useState<Corte[]>([])
  const [erro, setErro] = useState<string | null>(null)
  const [novoCanal, setNovoCanal] = useState("")
  const [plataforma, setPlataforma] = useState<Plataforma>("twitch")
  const [adicionando, setAdicionando] = useState(false)
  const [rascunho, setRascunho] = useState<Partial<Record<keyof Config, string>>>({})
  const [ordem, setOrdem] = useState<"recentes" | "nota">("nota")
  const [filtroCanal, setFiltroCanal] = useState<number | null>(null)
  const [filtroTipo, setFiltroTipo] = useState<string>("todos")
  const [pausando, setPausando] = useState<number | null>(null)
  const [confirmando, setConfirmando] = useState<string | null>(null)
  const [clipando, setClipando] = useState<number | null>(null)
  const [aviso, setAviso] = useState<string | null>(null)
  const [alturaCamera, setAlturaCamera] = useState<string | null>(null)

  const carregar = useCallback(async () => {
    try {
      const q = new URLSearchParams({ ordem })
      if (filtroCanal) q.set("canal", String(filtroCanal))
      const [e, c] = await Promise.all([
        api.get<Estado>("/api/admin/lives"),
        api.get<{ cortes: Corte[] }>(`/api/admin/lives/cortes?${q}`),
      ])
      setEstado(e)
      setCortes(c.cortes)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui carregar.")
    }
  }, [ordem, filtroCanal])

  useEffect(() => {
    void carregar()
  }, [carregar])

  // Enquanto algo acontece (gravando, corte na fila), atualiza sozinho: sem
  // isso, a tela parece parada durante uma live inteira.
  const temAtividade = useMemo(
    () =>
      Boolean(estado?.canais.some((c) => c.gravacao || c.cortesEmAndamento > 0)) ||
      cortes.some((c) => c.status === "na_fila" || c.status === "renderizando"),
    [estado, cortes],
  )
  useEffect(() => {
    if (!temAtividade) return
    const t = setInterval(() => void carregar(), 10_000)
    return () => clearInterval(t)
  }, [temAtividade, carregar])

  async function ligarDesligar() {
    if (!estado) return
    try {
      setEstado(await api.put<Estado>("/api/admin/lives/config", { ligado: !estado.ligado }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.")
    }
  }

  // Salva no onBlur, não a cada tecla: digitar "12" mandaria "1" e "12", e a
  // resposta mais lenta podia vencer (o bug do ScheduleCard, ver CLAUDE.md).
  async function salvarCampo(chave: keyof Config, valor: string) {
    if (!estado) return
    try {
      const novo = await api.put<Estado>("/api/admin/lives/config", { config: { [chave]: valor } })
      setEstado(novo)
      setRascunho((r) => ({ ...r, [chave]: undefined }))
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.")
    }
  }

  async function salvarOpcoes(parcial: Partial<Opcoes>) {
    try {
      setEstado(await api.put<Estado>("/api/admin/lives/opcoes", parcial))
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui salvar.")
    }
  }

  async function adicionar() {
    if (!novoCanal.trim()) return
    setAdicionando(true)
    setErro(null)
    try {
      setEstado(await api.post<Estado>("/api/admin/lives/canais", { canal: novoCanal, plataforma }))
      setNovoCanal("")
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui adicionar o canal.")
    } finally {
      setAdicionando(false)
    }
  }

  async function remover(id: number) {
    try {
      setEstado(await api.delete<Estado>(`/api/admin/lives/canais/${id}`))
      setConfirmando(null)
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui remover.")
    }
  }

  async function pausarOuRetomar(c: Canal) {
    setPausando(c.id)
    setErro(null)
    try {
      setEstado(await api.post<Estado>(`/api/admin/lives/canais/${c.id}/${c.pausado ? "retomar" : "pausar"}`))
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui mudar o canal.")
    } finally {
      setPausando(null)
    }
  }

  // Liga/desliga um tipo de corte. Nenhum marcado = todos (mandado como null).
  function alternarCategoria(id: string) {
    if (!estado) return
    const todos = estado.categorias.map((c) => c.id)
    const atuais = estado.opcoes.categorias ?? todos
    const novas = atuais.includes(id) ? atuais.filter((x) => x !== id) : [...atuais, id]
    if (!novas.length) {
      setErro("Escolha pelo menos um tipo de corte.")
      return
    }
    void salvarOpcoes({ categorias: novas.length === todos.length ? null : novas })
  }

  async function cliparAgora(id: number) {
    setClipando(id)
    setErro(null)
    try {
      await api.post(`/api/admin/lives/canais/${id}/clipar-agora`)
      setAviso("Pedido registrado: o corte dos últimos ~2,5 minutos entra na fila e aparece aqui em alguns minutos.")
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui clipar.")
    } finally {
      setClipando(null)
    }
  }

  async function apagarCorte(id: number) {
    try {
      await api.delete(`/api/admin/lives/cortes/${id}`)
      setConfirmando(null)
      await carregar()
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não consegui apagar.")
    }
  }

  if (authLoading || !user) return null

  const hoje = estado ? somaCusto(estado.custos.hoje) : null
  const nomeCategoria = new Map((estado?.categorias ?? []).map((c) => [c.id, c.nome]))
  const cortesFiltrados = filtroTipo === "todos" ? cortes : cortes.filter((k) => k.categoria === filtroTipo)
  const semana = estado ? somaCusto(estado.custos.seteDias) : null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Lives Admin">
      <p className="text-sm text-muted-foreground">
        O sistema vigia canais da Twitch e da Kick, grava a live, acha os melhores momentos com IA e entrega os cortes
        verticais prontos. Em <strong>modo de validação</strong>: só você vê esta tela, e o custo é registrado
        por canal pra medir quanto custa uma hora de live.
      </p>

      {erro && (
        <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
          <span>{erro}</span>
        </div>
      )}
      {aviso && <div className="rounded-lg border bg-muted/40 p-3 text-sm">{aviso}</div>}

      {!estado ? (
        <Skeleton className="h-48 w-full" />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="flex flex-wrap items-center gap-2">
                Módulo de lives
                <TonePill tone={estado.ligado && !estado.bloqueios.length ? "success" : "neutral"}>
                  {estado.ligado ? (estado.bloqueios.length ? "Ligado, mas bloqueado" : "Ligado") : "Desligado"}
                </TonePill>
              </CardTitle>
              <CardDescription>
                Desligar para todas as gravações na hora e para de gastar. Nada é apagado.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <Button variant={estado.ligado ? "outline" : "default"} onClick={() => void ligarDesligar()}>
                  {estado.ligado ? "Desligar" : "Ligar"}
                </Button>
                {estado.discoPercent !== null && (
                  <span className="text-sm text-muted-foreground">Disco do servidor: {estado.discoPercent.toFixed(0)}% usado</span>
                )}
              </div>
              {estado.bloqueios.map((b) => (
                <p key={b} className="text-sm text-destructive">{b}</p>
              ))}
              {(estado.avisos || []).map((a) => (
                <p key={a} className="text-sm text-muted-foreground">{a}</p>
              ))}

              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                <div className="flex min-w-0 flex-col gap-1.5">
                  <Label>Qualidade da gravação</Label>
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={estado.config.qualidade}
                    onValueChange={(v) => v && void salvarCampo("qualidade", v)}
                  >
                    {estado.limites.qualidades.map((q) => (
                      <ToggleGroupItem key={q} value={q}>{q}</ToggleGroupItem>
                    ))}
                  </ToggleGroup>
                  <span className="text-xs text-muted-foreground">
                    720p ≈ 1,5 GB por hora por canal (480p ≈ 0,65). Use 720p: a câmera do streamer é recortada do vídeo e em 480p sai borrada.
                  </span>
                </div>
                {CAMPOS.map((c) => {
                  const [min, max] = estado.limites.faixas[c.chave] || [0, 999]
                  return (
                    <div key={c.chave} className="flex min-w-0 flex-col gap-1.5">
                      <Label htmlFor={`cfg-${c.chave}`}>{c.rotulo}</Label>
                      <div className="flex items-center gap-2">
                        <Input
                          id={`cfg-${c.chave}`}
                          type="number"
                          min={min}
                          max={max}
                          className="w-24"
                          value={rascunho[c.chave] ?? String(estado.config[c.chave])}
                          onChange={(e) => setRascunho((r) => ({ ...r, [c.chave]: e.target.value }))}
                          onBlur={(e) => {
                            if (rascunho[c.chave] !== undefined) void salvarCampo(c.chave, e.target.value)
                          }}
                        />
                        <span className="text-sm text-muted-foreground">{c.sufixo}</span>
                      </div>
                      <span className="text-xs text-muted-foreground">{c.ajuda} ({min} a {max})</span>
                    </div>
                  )
                })}
              </div>

              {hoje && semana && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    ["Hoje", hoje],
                    ["Últimos 7 dias", semana],
                  ].map(([rotulo, r]) => {
                    const v = r as ReturnType<typeof somaCusto>
                    return (
                      <div key={rotulo as string} className="rounded-lg border p-3 text-sm">
                        <div className="font-medium">{rotulo as string}</div>
                        <div className="text-muted-foreground">
                          {usd(v.custo)} de IA · {v.horas.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}h gravadas · {v.cortes} cortes
                          {v.porHora !== null && <> · <strong className="text-foreground">{usd(v.porHora)} por hora de live</strong></>}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
              {estado.monitor && (estado.monitor.amostrasTranscricao > 0 || estado.monitor.chamadasTexto > 0) && (
                <p className="text-xs text-muted-foreground">
                  Economias, últimos 7 dias:
                  {estado.monitor.amostrasTranscricao > 0 && estado.monitor.concordanciaTranscricao !== null && (
                    <> a transcrição acelerada concordou <strong className="text-foreground">{estado.monitor.concordanciaTranscricao.toFixed(0)}%</strong> com a normal ({estado.monitor.amostrasTranscricao} amostras);</>
                  )}
                  {estado.monitor.chamadasTexto > 0 && (
                    <> {Math.round((100 * estado.monitor.chamadasFlex) / estado.monitor.chamadasTexto)}% das chamadas de IA saíram pela fila econômica (metade do preço).</>
                  )}
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Seus cortes de live</CardTitle>
              <CardDescription>
                A IA avalia cada momento da live uma vez só; aqui você decide quais chegam até você e como eles ficam.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <div className="flex flex-col gap-2">
                <Label htmlFor="qualidade-cortes">Qualidade dos cortes</Label>
                <BarraDeQualidade
                  valor={estado.opcoes.qualidade}
                  niveis={estado.niveis}
                  onSalvar={(q) => void salvarOpcoes({ qualidade: q })}
                />
              </div>

              <div className="flex flex-col gap-2">
                <Label>Tipos de corte</Label>
                <p className="text-xs text-muted-foreground">
                  A IA classifica cada momento. Você recebe só os tipos marcados — desmarque o que não combina com o seu canal.
                </p>
                <div className="flex flex-wrap gap-2">
                  {estado.categorias.map((cat) => {
                    const marcada = !estado.opcoes.categorias || estado.opcoes.categorias.includes(cat.id)
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        aria-pressed={marcada}
                        title={cat.descricao}
                        onClick={() => alternarCategoria(cat.id)}
                        className={`rounded-full border px-3 py-1.5 text-sm transition-colors ${
                          marcada ? "border-primary bg-primary text-primary-foreground" : "bg-background text-muted-foreground hover:bg-muted"
                        }`}
                      >
                        {cat.nome}
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex flex-col gap-2">
                <Label>Enquadramento</Label>
                <div className="flex flex-wrap items-center gap-3">
                  <ToggleGroup
                    type="single"
                    variant="outline"
                    value={estado.opcoes.cameraModo}
                    onValueChange={(v) => v && void salvarOpcoes({ cameraModo: v as Opcoes["cameraModo"] })}
                  >
                    <ToggleGroupItem value="ia">A IA escolhe o formato</ToggleGroupItem>
                    <ToggleGroupItem value="auto">Destacar a câmera</ToggleGroupItem>
                    <ToggleGroupItem value="desligado">Estilo normal</ToggleGroupItem>
                  </ToggleGroup>
                  {estado.opcoes.cameraModo === "auto" && (
                    <>
                      <ToggleGroup
                        type="single"
                        variant="outline"
                        value={estado.opcoes.cameraPosicao}
                        onValueChange={(v) => v && void salvarOpcoes({ cameraPosicao: v as Opcoes["cameraPosicao"] })}
                      >
                        <ToggleGroupItem value="top">Em cima</ToggleGroupItem>
                        <ToggleGroupItem value="bottom">Embaixo</ToggleGroupItem>
                      </ToggleGroup>
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          min={20}
                          max={60}
                          className="w-20"
                          value={alturaCamera ?? String(estado.opcoes.cameraAlturaPercent)}
                          onChange={(e) => setAlturaCamera(e.target.value)}
                          onBlur={(e) => {
                            if (alturaCamera === null) return
                            setAlturaCamera(null)
                            void salvarOpcoes({ cameraAlturaPercent: Number(e.target.value) })
                          }}
                        />
                        <span className="text-sm text-muted-foreground">% da altura do vídeo</span>
                      </div>
                    </>
                  )}
                </div>
                <span className="text-xs text-muted-foreground">
                  {estado.opcoes.cameraModo === "ia"
                    ? "Em cada corte a IA olha a live e monta o melhor formato: a webcam numa faixa e o jogo na outra, uma pessoa em cima e a outra embaixo quando estão nas pontas, zoom em quem está sozinho num canto — ou o quadro inteiro, quando cortar deixaria alguém de fora."
                    : estado.opcoes.cameraModo === "auto"
                      ? "A IA encontra a webcam do streamer em cada corte e coloca ela numa faixa própria. Se a live não tiver webcam separada, o corte sai no estilo normal."
                      : "O corte segue só o estilo escolhido abaixo, sem enquadramento especial."}
                </span>
              </div>

              <label className="flex items-start gap-3 text-sm">
                <Checkbox
                  checked={estado.opcoes.usarEstiloDosVideos}
                  onCheckedChange={(v) => void salvarOpcoes({ usarEstiloDosVideos: v === true })}
                />
                <span>
                  <span className="font-medium">Usar o mesmo estilo dos cortes de vídeo</span>
                  <span className="block text-xs text-muted-foreground">
                    Legenda, título e fundo iguais aos dos seus cortes do YouTube. Desmarque pra ter um estilo só para as lives.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          {!estado.opcoes.usarEstiloDosVideos && (
            <ClipStyleEditorCard key="estilo-live" endpoint="/api/admin/lives/estilo" modoLive />
          )}

          <Card>
            <CardHeader>
              <CardTitle>Canais</CardTitle>
              <CardDescription>
                Cole o nome ou o link do canal da Twitch ou da Kick. O streamer não precisa fazer nada, e você não
                precisa entrar em nenhuma das duas.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form
                className="flex flex-col gap-2 sm:flex-row"
                onSubmit={(e) => {
                  e.preventDefault()
                  void adicionar()
                }}
              >
                <ToggleGroup
                  type="single"
                  variant="outline"
                  value={plataforma}
                  onValueChange={(v) => v && setPlataforma(v as Plataforma)}
                  aria-label="Plataforma do canal"
                >
                  <ToggleGroupItem value="twitch" aria-label="Twitch">
                    <IconBrandTwitch className="size-4" /> Twitch
                  </ToggleGroupItem>
                  <ToggleGroupItem value="kick" aria-label="Kick">
                    <IconBrandKick className="size-4" /> Kick
                  </ToggleGroupItem>
                </ToggleGroup>
                <Input
                  placeholder={plataforma === "kick" ? "kick.com/nome-do-canal" : "twitch.tv/nome-do-canal"}
                  value={novoCanal}
                  onChange={(e) => {
                    const v = e.target.value
                    setNovoCanal(v)
                    // Link colado já diz a plataforma: o botão acompanha, pra não mostrar uma e adicionar outra.
                    if (/kick\.com\//i.test(v)) setPlataforma("kick")
                    else if (/twitch\.tv\//i.test(v)) setPlataforma("twitch")
                  }}
                  className="min-w-0 flex-1"
                />
                <Button type="submit" disabled={adicionando || !novoCanal.trim()}>
                  {adicionando ? "Adicionando..." : "Adicionar canal"}
                </Button>
              </form>

              {estado.canais.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum canal ainda.</p>
              ) : (
                <ul className="flex flex-col divide-y">
                  {estado.canais.map((c) => (
                    <li key={c.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-center">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        {c.imagem ? (
                          <img src={c.imagem} alt="" className="size-10 shrink-0 rounded-full" />
                        ) : (
                          <IconePlataforma plataforma={c.plataforma} className="size-10 shrink-0 text-muted-foreground" />
                        )}
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <a
                              href={c.url}
                              target="_blank"
                              rel="noreferrer"
                              className="flex min-w-0 items-center gap-1 font-medium hover:underline"
                              title={c.plataforma === "kick" ? "Canal na Kick" : "Canal na Twitch"}
                            >
                              <IconePlataforma plataforma={c.plataforma} className="size-4 shrink-0 text-muted-foreground" />
                              <span className="truncate">{c.nome}</span>
                            </a>
                            {c.gravacao && !c.pausado ? (
                              <TonePill tone="danger">
                                <IconPlayerRecordFilled className="size-3" /> Gravando há {duracao(c.gravacao.segundosGravados)}
                              </TonePill>
                            ) : c.aoVivo ? (
                              <TonePill tone="indigo">
                                {estado.ligado && !c.pausado ? "Ao vivo" : "Ao vivo · não está gravando"}
                              </TonePill>
                            ) : (
                              <TonePill tone="neutral">Offline</TonePill>
                            )}
                            {c.pausado && (
                              <TonePill tone="violet">
                                <IconPlayerPauseFilled className="size-3" /> Pausado
                              </TonePill>
                            )}
                          </div>
                          <div className="truncate text-xs text-muted-foreground">
                            {c.aoVivo
                              ? `${c.jogo || "—"} · ${c.espectadores ?? 0} assistindo · ${c.tituloDaLive || ""}`
                              : c.ultimaGravacao
                                ? `Última gravação: ${new Date(c.ultimaGravacao).toLocaleString("pt-BR")}`
                                : "Ainda não gravado"}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {c.cortesProntos} corte(s) pronto(s){c.cortesEmAndamento ? ` · ${c.cortesEmAndamento} em andamento` : ""}
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={pausando === c.id}
                          onClick={() => void pausarOuRetomar(c)}
                          title={c.pausado ? "Volta a gravar e cortar quando o canal estiver ao vivo" : "Para de gravar este canal, sem tirar ele da lista"}
                        >
                          {c.pausado ? <IconPlayerPlayFilled className="size-4" /> : <IconPlayerPauseFilled className="size-4" />}
                          {pausando === c.id ? "..." : c.pausado ? "Retomar" : "Pausar"}
                        </Button>
                        <Button
                          size="sm"
                          disabled={!c.gravacao || c.pausado || clipando === c.id}
                          onClick={() => void cliparAgora(c.id)}
                          title={c.gravacao ? "Corta o momento dos últimos ~2,5 minutos" : "Só dá pra clipar enquanto o canal está sendo gravado"}
                        >
                          <IconScissors className="size-4" /> {clipando === c.id ? "Clipando..." : "Clipar agora"}
                        </Button>
                        {confirmando === `canal-${c.id}` ? (
                          <>
                            <Button size="sm" variant="destructive" onClick={() => void remover(c.id)}>Sim, remover</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>Voltar</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setConfirmando(`canal-${c.id}`)}>Remover</Button>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Cortes</CardTitle>
              <CardDescription>Revise, baixe ou apague. A nota é a da IA (0 a 10).</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="flex flex-wrap items-center gap-2">
                <ToggleGroup type="single" variant="outline" value={ordem} onValueChange={(v) => v && setOrdem(v as "recentes" | "nota")}>
                  <ToggleGroupItem value="nota">Maior nota</ToggleGroupItem>
                  <ToggleGroupItem value="recentes">Mais recentes</ToggleGroupItem>
                </ToggleGroup>
                <select
                  aria-label="Filtrar por tipo de corte"
                  className="h-9 rounded-md border bg-background px-2 text-sm"
                  value={filtroTipo}
                  onChange={(e) => setFiltroTipo(e.target.value)}
                >
                  <option value="todos">Todos os tipos</option>
                  {estado.categorias.map((cat) => (
                    <option key={cat.id} value={cat.id}>{cat.nome}</option>
                  ))}
                </select>
                {estado.canais.length > 1 && (
                  <select
                    className="h-9 rounded-md border bg-background px-2 text-sm"
                    value={filtroCanal ?? ""}
                    onChange={(e) => setFiltroCanal(e.target.value ? Number(e.target.value) : null)}
                  >
                    <option value="">Todos os canais</option>
                    {estado.canais.map((c) => (
                      <option key={c.id} value={c.id}>{c.nome}</option>
                    ))}
                  </select>
                )}
              </div>

              {cortesFiltrados.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Nenhum corte ainda. Eles aparecem aqui alguns minutos depois de um canal começar a ser gravado.
                </p>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {cortesFiltrados.map((k) => (
                    <div key={k.id} className="flex min-w-0 flex-col gap-2 rounded-lg border p-3">
                      {k.status === "pronto" && k.temArquivo ? (
                        <video
                          controls
                          preload="none"
                          poster={k.temCapa ? `/api/admin/lives/cortes/${k.id}/arquivo?capa=1` : undefined}
                          src={`/api/admin/lives/cortes/${k.id}/arquivo`}
                          className="aspect-[9/16] w-full rounded-md bg-black object-contain"
                        />
                      ) : (
                        <div className="flex aspect-[9/16] w-full items-center justify-center rounded-md bg-muted text-sm text-muted-foreground">
                          {k.status === "renderizando" ? `${k.progresso}%` : STATUS_CORTE[k.status].texto}
                        </div>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5">
                        <TonePill tone={STATUS_CORTE[k.status].tone}>{STATUS_CORTE[k.status].texto}</TonePill>
                        {k.nota !== null && <TonePill tone={k.nota >= 8 ? "success" : "cyan"}>Nota {k.nota}</TonePill>}
                        {k.origem === "clipar_agora" && <TonePill tone="violet">Clipar agora</TonePill>}
                        {k.origem === "sinal" && <TonePill tone="indigo">Reação do público</TonePill>}
                        {k.categoria && nomeCategoria.get(k.categoria) && <TonePill tone="neutral">{nomeCategoria.get(k.categoria)}</TonePill>}
                        {k.revisao?.veredito === "corrigido" && (
                          <TonePill tone="cyan">Ajustado na revisão</TonePill>
                        )}
                        <span className="text-xs text-muted-foreground">{duracao(k.duracao)} · {k.canal.nome}</span>
                      </div>
                      <div className="font-medium leading-snug">{k.titulo || "(sem título ainda)"}</div>
                      {k.gancho && <div className="text-sm text-muted-foreground">{k.gancho}</div>}
                      {k.erro && <div className="text-xs text-destructive">{k.erro}</div>}
                      <div className="mt-auto flex flex-wrap gap-2">
                        {k.status === "pronto" && k.temArquivo && (
                          <Button size="sm" variant="outline" asChild>
                            <a href={`/api/admin/lives/cortes/${k.id}/arquivo?download=1`}>
                              <IconDownload className="size-4" /> Baixar
                            </a>
                          </Button>
                        )}
                        {confirmando === `corte-${k.id}` ? (
                          <>
                            <Button size="sm" variant="destructive" onClick={() => void apagarCorte(k.id)}>Sim, apagar</Button>
                            <Button size="sm" variant="ghost" onClick={() => setConfirmando(null)}>Voltar</Button>
                          </>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setConfirmando(`corte-${k.id}`)}>
                            <IconTrash className="size-4" /> Apagar
                          </Button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
