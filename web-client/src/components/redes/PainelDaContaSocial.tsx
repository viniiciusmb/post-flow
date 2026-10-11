import { useCallback, useEffect, useState, type ReactNode } from "react"
import {
  IconAlertTriangle,
  IconArrowDown,
  IconArrowUp,
  IconBolt,
  IconCalendarRepeat,
  IconExternalLink,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconX,
} from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Interruptor } from "@/components/youtube/MonitoramentoDoCanal"
import { HorariosEditor, type Horarios } from "@/components/redes/HorariosEditor"
import { ReguaDoDia } from "@/components/redes/ReguaDoDia"
import { api, ApiError } from "@/lib/api"
import { cn } from "@/lib/utils"
import { data } from "@/lib/formatoLocal"
import { REDES, duracaoCurta, type Rede } from "@/lib/redes"

export type ContaSocial = {
  id: number
  network: Exclude<Rede, "tiktok">
  username: string | null
  displayName: string | null
  avatarUrl: string | null
  connectedAt: string
  fila: {
    naFila: number
    publicados: number
    erros: number
    proxima: string | null
    publicaSozinho: boolean
    pausada: boolean
    porDia: number
    horarios: string[]
  }
}

type Config = Horarios & {
  timezone: string
  paused: boolean
  autoPostEnabled: boolean
  opcoes: { youtubePrivacidade: "public" | "unlisted" | "private"; youtubeInfantil: boolean; pinterestPasta: string | null; pinterestPastaNome: string | null }
  limites: { duracaoMinS: number; duracaoMaxS: number; legendaMax: number; maxPorDia: number; retencaoHoras: number }
}

type Item = {
  id: number
  status: "pending" | "sending" | "processing" | "posted" | "error" | "skipped"
  legenda: string | null
  titulo: string | null
  duracaoS: number | null
  horario: string | null
  publicadoEm: string | null
  url: string | null
  erro: string | null
  erroDeDuracao: boolean
  esperandoVaga: boolean
  postarAgora: boolean
  origem: string | null
  capaUrl: string | null
  videoUrl: string | null
}

export type CanalDestino = { id: number; nome: string; avatar: string | null; socialAccountIds: number[] }

/** "Hoje 16:00", "Amanhã 08:00" ou "14/10 08:00". */
export function quando(iso: string | null) {
  if (!iso) return "—"
  const d = new Date(iso)
  const hoje = new Date()
  const amanha = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() + 1)
  const hhmm = d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (d.toDateString() === hoje.toDateString()) return `Hoje ${hhmm}`
  if (d.toDateString() === amanha.toDateString()) return `Amanhã ${hhmm}`
  return `${d.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} ${hhmm}`
}

type Aba = "fila" | "publicados" | "erros" | "configurar"

export function PainelDaContaSocial({
  conta,
  canais,
  onMudou,
  onAplicarEmTodas,
}: {
  conta: ContaSocial
  canais: CanalDestino[] | null
  onMudou: () => Promise<void> | void
  onAplicarEmTodas: () => void
}) {
  const info = REDES[conta.network]
  const [cfg, setCfg] = useState<Config | null>(null)
  const [aba, setAba] = useState<Aba>("fila")
  const [fila, setFila] = useState<Item[] | null>(null)
  const [erro, setErro] = useState<string | null>(null)
  const [salvando, setSalvando] = useState<string | null>(null)

  const base = `/api/client/social-accounts/${conta.id}`

  const carregarFila = useCallback(async () => {
    const r = await api.get<{ itens: Item[] }>(`${base}/fila`)
    setFila(r.itens)
  }, [base])

  useEffect(() => {
    setCfg(null)
    setFila(null)
    setAba("fila")
    void api.get<Config>(`${base}/publicacao`).then(setCfg)
    void carregarFila()
  }, [base, carregarFila])

  // Enquanto algo está saindo, a fila se atualiza sozinha.
  const publicando = fila?.some((i) => i.status === "sending" || i.status === "processing" || i.postarAgora)
  useEffect(() => {
    if (!publicando) return
    const t = setInterval(() => void carregarFila(), 6000)
    return () => clearInterval(t)
  }, [publicando, carregarFila])

  async function salvar(chave: string, acao: () => Promise<Config | void>) {
    setErro(null)
    setSalvando(chave)
    try {
      const r = await acao()
      if (r) setCfg(r)
      await carregarFila()
      await onMudou()
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.")
    } finally {
      setSalvando(null)
    }
  }

  if (!cfg) return <Skeleton className="h-96" />

  const horariosEmUso = cfg.mode === "manual" && cfg.manualTimes.length > 0 ? cfg.manualTimes : cfg.defaultTimes
  const pendentes = fila?.filter((i) => i.status === "pending") ?? []

  return (
    <div className="flex flex-col gap-4">
      {erro && <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{erro}</p>}

      <Card className="gap-0 py-0">
        <div className="flex flex-col gap-4 px-5 pb-4 pt-5">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <Interruptor
              ligado={cfg.autoPostEnabled}
              rotulo="Publicar sozinho"
              disabled={salvando === "auto"}
              onClick={() => void salvar("auto", () => api.put<Config>(`${base}/auto-post`, { enabled: !cfg.autoPostEnabled }))}
            />
            <span className="text-sm text-muted-foreground">
              {cfg.autoPostEnabled ? "Os cortes saem nos horários abaixo." : "Os cortes esperam na fila até você usar Postar agora."}
            </span>
            <Button
              size="sm"
              variant="outline"
              className="ml-auto gap-1.5"
              disabled={salvando === "pausa"}
              onClick={() => void salvar("pausa", () => api.put<Config>(`${base}/pausa`, { paused: !cfg.paused }))}
            >
              {cfg.paused ? <IconPlayerPlay className="size-3.5" /> : <IconPlayerPause className="size-3.5" />}
              {cfg.paused ? "Retomar fila" : "Pausar fila"}
            </Button>
          </div>
          <ReguaDoDia
            horarios={horariosEmUso}
            cor={info.cor}
            pausada={cfg.paused || !cfg.autoPostEnabled}
            itens={pendentes.map((i) => ({ id: i.id, horario: i.horario, capaUrl: i.capaUrl, titulo: i.titulo }))}
          />
          {info.aviso && (
            <p className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
              <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
              {info.aviso}
            </p>
          )}
        </div>

        <div role="tablist" className="flex gap-5 overflow-x-auto border-t border-border px-5 pt-2">
          <AbaBotao ativa={aba === "fila"} onClick={() => setAba("fila")} cor={info.cor} n={fila ? fila.length : conta.fila.naFila}>
            Fila
          </AbaBotao>
          <AbaBotao ativa={aba === "publicados"} onClick={() => setAba("publicados")} cor={info.cor}>
            Publicados
          </AbaBotao>
          <AbaBotao ativa={aba === "erros"} onClick={() => setAba("erros")} cor={info.cor} n={conta.fila.erros} alerta>
            Não saíram
          </AbaBotao>
          <AbaBotao ativa={aba === "configurar"} onClick={() => setAba("configurar")} cor={info.cor}>
            Horários e opções
          </AbaBotao>
        </div>
      </Card>

      {aba === "fila" && <Fila itens={fila} cfg={cfg} rede={conta.network} onMudou={async () => { await carregarFila(); await onMudou() }} base={base} />}
      {aba === "publicados" && <Lista base={base} qual="publicados" rede={conta.network} onMudou={onMudou} />}
      {aba === "erros" && <Lista base={base} qual="erros" rede={conta.network} onMudou={async () => { await carregarFila(); await onMudou() }} />}
      {aba === "configurar" && (
        <Configurar
          conta={conta}
          cfg={cfg}
          canais={canais}
          salvando={salvando}
          salvar={salvar}
          base={base}
          onAplicarEmTodas={onAplicarEmTodas}
          onMudou={onMudou}
        />
      )}
    </div>
  )
}

function AbaBotao({
  ativa,
  onClick,
  children,
  cor,
  n,
  alerta,
}: {
  ativa: boolean
  onClick: () => void
  children: ReactNode
  cor: string
  n?: number
  alerta?: boolean
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={ativa}
      onClick={onClick}
      className={cn(
        "relative -mb-px inline-flex shrink-0 items-center gap-1.5 border-b-2 px-0.5 pb-2.5 pt-1 text-sm transition-colors",
        ativa ? "font-medium text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
      )}
      style={ativa ? { borderColor: cor } : undefined}
    >
      {children}
      {n !== undefined && n > 0 && (
        <span
          className={cn(
            "rounded-full px-1.5 font-mono text-[10.5px]",
            alerta ? "bg-tone-danger-wash text-tone-danger-ink" : "bg-muted text-muted-foreground",
          )}
        >
          {n}
        </span>
      )}
    </button>
  )
}

function Capa({ url }: { url: string | null }) {
  return (
    <span className="block h-[72px] w-[41px] shrink-0 overflow-hidden rounded-md bg-muted">
      {url && <img src={url} alt="" loading="lazy" className="size-full object-cover" />}
    </span>
  )
}

function Fila({ itens, cfg, rede, base, onMudou }: { itens: Item[] | null; cfg: Config; rede: Rede; base: string; onMudou: () => Promise<void> }) {
  const [abrindo, setAbrindo] = useState<number | null>(null)
  const [mexendo, setMexendo] = useState<number | null>(null)
  const [rascunho, setRascunho] = useState<Record<number, string>>({})
  const [erro, setErro] = useState<string | null>(null)

  if (!itens) return <Skeleton className="h-40" />
  if (itens.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center">
        <p className="font-medium">A fila está vazia</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
          Ligue um canal a esta conta em Horários e opções pra os cortes entrarem sozinhos, ou mande um corte pelo Feed de cortes.
        </p>
      </div>
    )
  }

  async function acao(id: number, fn: () => Promise<unknown>) {
    setErro(null)
    setMexendo(id)
    try {
      await fn()
      await onMudou()
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível fazer isso agora.")
    } finally {
      setMexendo(null)
    }
  }

  const pendentes = itens.filter((i) => i.status === "pending")
  function mover(id: number, delta: number) {
    const ids = pendentes.map((i) => i.id)
    const k = ids.indexOf(id)
    const alvo = k + delta
    if (alvo < 0 || alvo >= ids.length) return
    ;[ids[k], ids[alvo]] = [ids[alvo], ids[k]]
    void acao(id, () => api.put(`${base}/ordem`, { ids }))
  }

  const r = REDES[rede]
  return (
    <div className="flex flex-col gap-2">
      {erro && <p className="rounded-md bg-tone-danger-wash px-3 py-2 text-sm text-tone-danger-ink">{erro}</p>}
      <ol className="flex flex-col gap-2">
        {itens.map((i) => {
          const saindo = i.status !== "pending"
          const k = pendentes.findIndex((p) => p.id === i.id)
          const legenda = rascunho[i.id] ?? i.legenda ?? ""
          return (
            <li key={i.id} className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-flat)]">
              <Capa url={i.capaUrl} />
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
                  <p className="min-w-0 truncate text-sm font-medium">{i.titulo ?? "Corte"}</p>
                  <span
                    className={cn("shrink-0 font-mono text-xs font-semibold tabular-nums", saindo && "text-tone-indigo-ink")}
                    style={!saindo && !i.esperandoVaga ? { color: r.cor } : undefined}
                  >
                    {saindo ? "Publicando…" : i.postarAgora ? "Agora" : i.esperandoVaga ? `Esperando vaga · ${quando(i.horario)}` : quando(i.horario)}
                  </span>
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {i.origem ?? "Envio avulso"}
                  {i.duracaoS ? ` · ${duracaoCurta(i.duracaoS)}` : ""}
                </p>
                {abrindo === i.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      value={legenda}
                      maxLength={cfg.limites.legendaMax}
                      onChange={(e) => setRascunho((x) => ({ ...x, [i.id]: e.target.value }))}
                      rows={3}
                      aria-label="Legenda"
                      className="w-full resize-y rounded-md border border-input bg-background px-2.5 py-2 text-sm"
                    />
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[10.5px] text-muted-foreground">
                        {legenda.length}/{cfg.limites.legendaMax}
                      </span>
                      <span className="flex gap-1.5">
                        <Button size="xs" variant="ghost" onClick={() => setAbrindo(null)}>
                          Fechar
                        </Button>
                        <Button
                          size="xs"
                          disabled={mexendo === i.id}
                          onClick={() =>
                            void acao(i.id, async () => {
                              await api.put(`/api/client/social-postings/${i.id}/legenda`, { legenda })
                              setAbrindo(null)
                            })
                          }
                        >
                          Salvar legenda
                        </Button>
                      </span>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={saindo}
                    onClick={() => setAbrindo(i.id)}
                    className="line-clamp-2 text-left text-xs text-foreground/80 hover:text-foreground disabled:cursor-default"
                    title="Editar legenda"
                  >
                    {i.legenda || <span className="italic text-muted-foreground">Sem legenda — toque pra escrever</span>}
                  </button>
                )}
                {!saindo && (
                  <div className="mt-0.5 flex flex-wrap items-center gap-1">
                    <Button size="xs" variant="outline" className="gap-1" disabled={mexendo === i.id} onClick={() => void acao(i.id, () => api.post(`/api/client/social-postings/${i.id}/postar-agora`, {}))}>
                      <IconBolt />
                      Postar agora
                    </Button>
                    <Button size="xs" variant="ghost" className="gap-1 text-muted-foreground" disabled={mexendo === i.id} onClick={() => void acao(i.id, () => api.post(`/api/client/social-postings/${i.id}/cancelar`, {}))}>
                      <IconX />
                      Não postar
                    </Button>
                    <span className="ml-auto flex">
                      <Button size="icon-xs" variant="ghost" aria-label="Subir na fila" disabled={k <= 0 || mexendo !== null} onClick={() => mover(i.id, -1)}>
                        <IconArrowUp />
                      </Button>
                      <Button size="icon-xs" variant="ghost" aria-label="Descer na fila" disabled={k < 0 || k >= pendentes.length - 1 || mexendo !== null} onClick={() => mover(i.id, 1)}>
                        <IconArrowDown />
                      </Button>
                    </span>
                  </div>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      <p className="px-1 text-xs text-muted-foreground">
        Cortes de um mesmo vídeo ficam juntos e em ordem. Depois de publicado, o arquivo fica guardado por {cfg.limites.retencaoHoras / 24} dias.
      </p>
    </div>
  )
}

function Lista({ base, qual, rede, onMudou }: { base: string; qual: "publicados" | "erros"; rede: Rede; onMudou: () => Promise<void> | void }) {
  const [itens, setItens] = useState<Item[] | null>(null)
  const [mexendo, setMexendo] = useState<number | null>(null)
  const carregar = useCallback(async () => setItens((await api.get<{ itens: Item[] }>(`${base}/${qual}`)).itens), [base, qual])
  useEffect(() => {
    setItens(null)
    void carregar()
  }, [carregar])

  if (!itens) return <Skeleton className="h-40" />
  if (itens.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
        {qual === "publicados" ? "Nada publicado nesta conta ainda." : "Nenhum corte deixou de sair. Tudo certo."}
      </div>
    )
  }
  return (
    <ol className="flex flex-col gap-2">
      {itens.map((i) => (
        <li key={i.id} className="flex gap-3 rounded-xl border border-border bg-card p-3 shadow-[var(--shadow-flat)]">
          <Capa url={i.capaUrl} />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="truncate text-sm font-medium">{i.titulo ?? "Corte"}</p>
            <p className="truncate text-xs text-muted-foreground">
              {i.origem ?? "Envio avulso"}
              {i.duracaoS ? ` · ${duracaoCurta(i.duracaoS)}` : ""}
              {qual === "publicados" && i.publicadoEm ? ` · publicado em ${data(i.publicadoEm)}` : ""}
            </p>
            {qual === "erros" && i.erro && <p className="text-xs text-tone-danger-ink">{i.erro}</p>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {qual === "publicados" && i.url && (
                <Button asChild size="xs" variant="outline" className="gap-1">
                  <a href={i.url} target="_blank" rel="noreferrer">
                    <IconExternalLink />
                    Ver no {REDES[rede].nome}
                  </a>
                </Button>
              )}
              {qual === "erros" &&
                (i.erroDeDuracao ? (
                  <span className="text-[11px] text-muted-foreground">Este corte não vai pra esta rede.</span>
                ) : (
                  <Button
                    size="xs"
                    variant="outline"
                    className="gap-1"
                    disabled={mexendo === i.id}
                    onClick={async () => {
                      setMexendo(i.id)
                      try {
                        await api.post(`/api/client/social-postings/${i.id}/tentar-de-novo`, {})
                        await carregar()
                        await onMudou()
                      } finally {
                        setMexendo(null)
                      }
                    }}
                  >
                    <IconRefresh />
                    Pôr na fila de novo
                  </Button>
                ))}
            </div>
          </div>
        </li>
      ))}
    </ol>
  )
}

function Bloco({ titulo, texto, children }: { titulo: string; texto?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3 px-5 py-5">
      <div>
        <h3 className="text-sm font-semibold">{titulo}</h3>
        {texto && <p className="mt-0.5 text-xs text-muted-foreground">{texto}</p>}
      </div>
      {children}
    </section>
  )
}

function Configurar({
  conta,
  cfg,
  canais,
  salvando,
  salvar,
  base,
  onAplicarEmTodas,
  onMudou,
}: {
  conta: ContaSocial
  cfg: Config
  canais: CanalDestino[] | null
  salvando: string | null
  salvar: (chave: string, acao: () => Promise<Config | void>) => Promise<void>
  base: string
  onAplicarEmTodas: () => void
  onMudou: () => Promise<void> | void
}) {
  const [pastas, setPastas] = useState<{ id: string; nome: string }[] | null>(null)
  const [erroPastas, setErroPastas] = useState<string | null>(null)
  const [canaisAviso, setCanaisAviso] = useState<string | null>(null)
  const [ligados, setLigados] = useState<Set<number>>(
    () => new Set((canais ?? []).filter((c) => c.socialAccountIds.includes(conta.id)).map((c) => c.id)),
  )
  useEffect(() => {
    setLigados(new Set((canais ?? []).filter((c) => c.socialAccountIds.includes(conta.id)).map((c) => c.id)))
  }, [canais, conta.id])

  useEffect(() => {
    if (conta.network !== "pinterest") return
    api
      .get<{ pastas: { id: string; nome: string }[] }>(`${base}/pinterest/pastas`)
      .then((r) => setPastas(r.pastas))
      .catch((err) => setErroPastas(err instanceof ApiError ? err.message : "Não foi possível listar as pastas."))
  }, [conta.network, base])

  async function alternarCanal(canal: CanalDestino, ligar: boolean) {
    setCanaisAviso(null)
    const ids = ligar ? [...new Set([...canal.socialAccountIds, conta.id])] : canal.socialAccountIds.filter((x) => x !== conta.id)
    setLigados((s) => {
      const n = new Set(s)
      if (ligar) n.add(canal.id)
      else n.delete(canal.id)
      return n
    })
    try {
      const r = await api.put<{ enfileirados: number; longos: number }>(`/api/client/social-accounts/canais/${canal.id}`, { socialAccountIds: ids })
      if (ligar && (r.enfileirados || r.longos)) {
        setCanaisAviso(
          `${r.enfileirados} corte${r.enfileirados === 1 ? "" : "s"} pronto${r.enfileirados === 1 ? "" : "s"} de ${canal.nome} entr${r.enfileirados === 1 ? "ou" : "aram"} na fila.` +
            (r.longos ? ` ${r.longos} ficaram de fora por passar de ${duracaoCurta(cfg.limites.duracaoMaxS)}.` : ""),
        )
      }
      await onMudou()
    } catch (err) {
      setCanaisAviso(err instanceof ApiError ? err.message : "Não foi possível salvar.")
    }
  }

  return (
    <Card className="gap-0 divide-y divide-border py-0">
      <Bloco titulo="Quando publicar" texto="Vale só pra esta conta. Mudar os horários reorganiza a fila na hora.">
        <HorariosEditor
          valor={cfg}
          maxPorDia={cfg.limites.maxPorDia}
          salvando={salvando === "horarios"}
          onSalvar={(v) => void salvar("horarios", () => api.put<Config>(`${base}/horarios`, v))}
        />
      </Bloco>

      <Bloco
        titulo="Canais que publicam aqui"
        texto={`Todo corte novo destes canais entra na fila desta conta. Cortes com mais de ${duracaoCurta(cfg.limites.duracaoMaxS)} não vão pro ${REDES[conta.network].nome}.`}
      >
        {!canais ? (
          <Skeleton className="h-16" />
        ) : canais.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum canal do YouTube conectado. <a href="/client/youtube" className="font-medium text-foreground underline underline-offset-2">Conectar canal</a>
          </p>
        ) : (
          <div className="grid gap-1.5 sm:grid-cols-2">
            {canais.map((c) => (
              <label key={c.id} className={cn("flex cursor-pointer items-center gap-2.5 rounded-lg border px-3 py-2", ligados.has(c.id) ? "border-foreground bg-muted/40" : "border-border")}>
                <Checkbox checked={ligados.has(c.id)} onCheckedChange={(v) => void alternarCanal(c, v === true)} />
                <span className="min-w-0 truncate text-sm">{c.nome}</span>
              </label>
            ))}
          </div>
        )}
        {canaisAviso && <p className="text-xs text-muted-foreground">{canaisAviso}</p>}
      </Bloco>

      {conta.network === "youtube" && (
        <Bloco titulo="Opções do YouTube">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm">Visibilidade</span>
            <Select
              value={cfg.opcoes.youtubePrivacidade}
              onValueChange={(v) => void salvar("yt", () => api.put<Config>(`${base}/opcoes`, { youtubePrivacidade: v }))}
            >
              <SelectTrigger size="sm" className="w-44 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Público</SelectItem>
                <SelectItem value="unlisted">Não listado</SelectItem>
                <SelectItem value="private">Privado</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <label className="flex items-start gap-2.5 text-sm">
            <Checkbox
              checked={cfg.opcoes.youtubeInfantil}
              onCheckedChange={(v) => void salvar("yt", () => api.put<Config>(`${base}/opcoes`, { youtubeInfantil: v === true }))}
              className="mt-0.5"
            />
            <span>
              Conteúdo feito para crianças
              <span className="block text-xs text-muted-foreground">Exigência do YouTube. Deixe desmarcado se o canal não é infantil.</span>
            </span>
          </label>
        </Bloco>
      )}

      {conta.network === "pinterest" && (
        <Bloco titulo="Pasta do Pinterest" texto="Todo pin precisa de uma pasta. Os cortes entram nesta.">
          {erroPastas ? (
            <p className="text-sm text-destructive">{erroPastas}</p>
          ) : !pastas ? (
            <Skeleton className="h-9 w-56" />
          ) : pastas.length === 0 ? (
            <p className="text-sm text-muted-foreground">Esta conta não tem pastas. Crie uma no Pinterest e volte aqui.</p>
          ) : (
            <Select value={cfg.opcoes.pinterestPasta ?? undefined} onValueChange={(v) => void salvar("pin", () => api.put<Config>(`${base}/opcoes`, { pinterestPasta: v }))}>
              <SelectTrigger size="sm" className={cn("w-64 text-xs", !cfg.opcoes.pinterestPasta && "border-amber-500")}>
                <SelectValue placeholder="Escolha a pasta" />
              </SelectTrigger>
              <SelectContent>
                {pastas.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.nome}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </Bloco>
      )}

      <Bloco titulo="Outras contas" texto="Copia os horários e o “publicar sozinho” desta conta pra todas as outras, de todas as redes, TikTok incluído.">
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className="h-auto min-h-9 gap-1.5 whitespace-normal text-left" onClick={onAplicarEmTodas}>
            <IconCalendarRepeat className="size-4" />
            Usar estes horários em todas as contas
          </Button>
          <Button
            variant="ghost"
            className="gap-1.5 text-muted-foreground"
            disabled={salvando === "corrigir"}
            onClick={() => void salvar("corrigir", async () => void (await api.post(`${base}/corrigir-horarios`, {})))}
          >
            <IconRefresh className="size-4" />
            Reorganizar horários da fila
          </Button>
        </div>
      </Bloco>
    </Card>
  )
}
