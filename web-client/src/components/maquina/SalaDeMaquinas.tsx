import { useEffect, useRef, useState } from "react"
import { IconArrowRight } from "@tabler/icons-react"
import { api } from "@/lib/api"
import { useIsMobile } from "@/hooks/use-mobile"
import type { MaquinaResponse } from "@/types/api"
import { Camada, FaixasContexto, plural, ha, useMovimentoReduzido, useRelogio, type Maquina } from "./comum"
import { Linha } from "./Linha"
import { Saida } from "./Saida"
import { Atividade } from "./Atividade"

/**
 * A linha de produção: o Início do painel novo (admin e Rise Style, em teste).
 *
 * Três camadas, na ordem em que o trabalho anda:
 *   Entrada        - vigia do YouTube e lives monitoradas, que se juntam
 *   Processamento  - download, transcrição, seleção e corte, com cada vídeo
 *                    desenhado na etapa em que está
 *   Saída          - uma fila por rede social
 * Ao lado, a atividade: o que acabou de acontecer.
 *
 * Cada movimento corresponde a um dado do servidor. Etapa parada fica
 * parada; a linha até ela fica apagada; e um corte só "voa" pra fila quando o
 * servidor diz que ele ficou pronto entre uma leitura e a seguinte.
 *
 * Texto só em português por enquanto, como as outras telas do painel novo.
 */

const INTERVALO_MS = 4000

function useMaquina(endpoint: string) {
  const [dados, setDados] = useState<MaquinaResponse | null>(null)
  const [falhou, setFalhou] = useState(false)
  // Diferença entre o relógio do servidor e o daqui: "há X min" e as
  // contagens regressivas usam a hora do servidor.
  const [desvio, setDesvio] = useState(0)

  useEffect(() => {
    let vivo = true
    let timer: number | undefined
    async function buscar() {
      try {
        const r = await api.get<MaquinaResponse>(endpoint)
        if (!vivo) return
        setDados(r)
        setDesvio(new Date(r.agora).getTime() - Date.now())
        setFalhou(false)
      } catch {
        if (vivo) setFalhou(true)
      }
    }
    function agendar() {
      window.clearInterval(timer)
      // Aba escondida não consulta: ninguém está olhando.
      if (document.visibilityState === "visible") timer = window.setInterval(buscar, INTERVALO_MS)
    }
    function aoMudarVisibilidade() {
      if (document.visibilityState === "visible") buscar()
      agendar()
    }
    buscar()
    agendar()
    document.addEventListener("visibilitychange", aoMudarVisibilidade)
    return () => {
      vivo = false
      window.clearInterval(timer)
      document.removeEventListener("visibilitychange", aoMudarVisibilidade)
    }
  }, [endpoint])

  return { dados, falhou, desvio }
}

// ------------------------------------------------------------------ o voo do corte

function pulsar(el: Element) {
  el.classList.remove("maq-chegada", "maq-concluiu")
  void (el as HTMLElement).offsetWidth
  el.classList.add(el.hasAttribute("data-corte") ? "maq-concluiu" : "maq-chegada")
}

/** Um corte que acabou de ficar pronto sai do quadro dele e voa até a fila de cada rede. */
function voar(chave: string, imagem: string | null, redes: string[], atraso: number, reduzido: boolean) {
  const origem = document.querySelector(`[data-corte="${chave}"]`)
  const alvos = redes.map((r) => document.querySelector(`[data-lane-alvo="${r}"]`)).filter(Boolean) as HTMLElement[]
  if (origem) pulsar(origem)
  if (!origem || alvos.length === 0) return
  if (reduzido) {
    alvos.forEach(pulsar)
    return
  }
  const a = origem.getBoundingClientRect()
  alvos.forEach((alvo, i) => {
    const b = alvo.getBoundingClientRect()
    const el = document.createElement("div")
    el.className = "maq-voo"
    Object.assign(el.style, { left: `${a.left}px`, top: `${a.top}px`, width: `${a.width}px`, height: `${a.height}px`, opacity: "0" })
    if (imagem) {
      const img = document.createElement("img")
      img.src = imagem
      el.appendChild(img)
    }
    document.body.appendChild(el)
    // Pousa no começo da fila (onde o próximo corte aparece).
    const dx = b.left + 19 - (a.left + a.width / 2)
    const dy = b.top + Math.min(b.height, 70) / 2 - (a.top + a.height / 2)
    el.animate(
      [
        { transform: "translate(0, 0) scale(1)", opacity: 1 },
        { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 70}px) scale(1.06)`, opacity: 1, offset: 0.45 },
        { transform: `translate(${dx}px, ${dy}px) scale(0.6)`, opacity: 0.15 },
      ],
      { duration: 1250, delay: atraso + i * 140, easing: "cubic-bezier(0.55, 0, 0.25, 1)", fill: "forwards" }
    ).finished.then(() => {
      el.remove()
      pulsar(alvo)
    })
  })
}

function useVooDosCortes(dados: Maquina | null, reduzido: boolean) {
  const anterior = useRef<Map<string, string> | null>(null)
  useEffect(() => {
    if (!dados) return
    const agora = new Map<string, { s: string; img: string | null; destinos: string[] }>()
    for (const v of dados.processando) {
      for (const c of v.cortes) agora.set(`yt-${c.id}`, { s: c.status, img: c.capaUrl ?? v.thumbnailUrl, destinos: v.destinos })
    }
    // Corte de live não entra em fila sozinho: o destino dele é o Feed.
    for (const l of dados.aoVivo) {
      for (const c of l.cortes) agora.set(`live-${c.id}`, { s: c.status === "pronto" ? "ready" : c.status, img: c.capaUrl ?? l.avatarUrl, destinos: ["feed"] })
    }
    const antes = anterior.current
    anterior.current = new Map([...agora].map(([id, c]) => [id, c.s]))
    // Primeira leitura: nada voa. Só o que mudou DEPOIS que a tela abriu.
    if (!antes) return
    const prontos = [...agora].filter(([id, c]) => c.s === "ready" && antes.has(id) && antes.get(id) !== "ready")
    if (prontos.length === 0) return
    // Espera o React pintar o quadro como pronto antes de medir.
    const id = window.requestAnimationFrame(() =>
      prontos.forEach(([chave, c], i) => voar(chave, c.img, c.destinos, i * 260, reduzido))
    )
    return () => window.cancelAnimationFrame(id)
  }, [dados, reduzido])
}

// ------------------------------------------------------------------ a tela

function manchete(d: Maquina, agora: number) {
  const naLinha = d.processando.filter((v) => v.status !== "ready").length
  const partes = [
    naLinha > 0 ? `${plural(naLinha, "vídeo", "vídeos")} na linha` : null,
    d.aoVivo.length > 0 ? plural(d.aoVivo.length, "live gravando", "lives gravando") : null,
    d.etapas.esperando > 0 ? `${d.etapas.esperando} esperando a vez` : null,
    d.fila.total > 0 ? plural(d.fila.total, "corte na fila", "cortes na fila") : null,
  ].filter(Boolean) as string[]

  if (naLinha > 0 || d.aoVivo.length > 0 || d.fila.publicandoAgora > 0) {
    return { estado: "trabalhando" as const, titulo: "Trabalhando agora", frase: partes.join(" · ") }
  }
  const fontes = d.fontes.canaisAtivos + d.fontes.livesSeguidas
  if (fontes > 0) {
    const checou = d.fontes.ultimaChecagem ? ` · última checagem ${ha(agora - new Date(d.fontes.ultimaChecagem).getTime())}` : ""
    return {
      estado: "vigia" as const,
      titulo: "Em vigia",
      frase: `Nada na linha agora${checou}${partes.length ? ` · ${partes.join(" · ")}` : ""}`,
    }
  }
  return { estado: "parada" as const, titulo: "Parada", frase: "Ligue um canal do YouTube ou uma live pra máquina começar." }
}

const COR = { trabalhando: "var(--maq-work)", vigia: "var(--maq-flow)", parada: "var(--muted-foreground)" } as const

export function SalaDeMaquinas({ escopo }: { escopo: "cliente" | "sistema" }) {
  const endpoint = escopo === "sistema" ? "/api/admin/maquina" : "/api/client/maquina"
  const { dados, falhou, desvio } = useMaquina(endpoint)
  const relogio = useRelogio()
  const reduzido = useMovimentoReduzido()
  const celular = useIsMobile()
  const agora = relogio + desvio
  useVooDosCortes(dados, reduzido)

  if (!dados) {
    return <div className="maq h-[640px] animate-pulse rounded-xl bg-card shadow-[var(--shadow-flat)]" aria-label="Carregando a linha de produção" />
  }

  const m = manchete(dados, agora)
  const linkDaFila = escopo === "sistema" ? "/admin/postings" : "/client/social"
  const linkDosVideos = escopo === "sistema" ? "/admin/queue" : "/client/youtube"
  const naLinha = dados.processando
  const vazio = naLinha.length === 0 && dados.aoVivo.length === 0

  // Filas recebendo agora: as redes de destino dos vídeos sendo cortados, o
  // Feed se alguma live está tendo corte montado, e as que estão publicando.
  const ativas = new Set<string>()
  naLinha.filter((v) => v.status === "cutting").forEach((v) => v.destinos.forEach((r) => ativas.add(r)))
  if (dados.aoVivo.some((l) => l.cortesProduzindo > 0)) ativas.add("feed")
  dados.filas.filter((f) => f.publicandoAgora > 0).forEach((f) => ativas.add(f.rede))
  const mostrarFeed = dados.fontes.livesSeguidas > 0 || dados.feed.prontos > 0
  const faixas = new Map(dados.filas.map((f) => [f.chave, f]))

  return (
    <div className="maq grid items-start gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <section data-tour="linha-de-producao" className="min-w-0 rounded-xl bg-card shadow-[var(--shadow-flat)] dark:border dark:border-border" aria-label="Linha de produção">
        <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-border/70 px-4 py-3.5 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2.5">
              <span className="maq-lampada" data-viva={m.estado !== "parada"} style={{ color: falhou ? "var(--maq-hold)" : COR[m.estado] }} aria-hidden="true" />
              <h2 className="text-[15px] font-semibold tracking-[-0.01em]">{falhou ? "Sem sinal do servidor" : m.titulo}</h2>
              {escopo === "sistema" && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[10.5px] font-medium text-muted-foreground">todos os clientes</span>
              )}
            </div>
            <p className="mt-0.5 text-[12.5px] text-muted-foreground">
              {falhou ? "Tentando reconectar. Os números são da última leitura." : m.frase}
            </p>
            <p className="mt-1.5 flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--maq-yt)]" />vídeos do YouTube</span>
              <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-[var(--maq-live)]" />lives</span>
            </p>
          </div>
          <div className="flex items-center gap-4">
            <a href={linkDosVideos} className="inline-flex items-center gap-1 text-[12px] font-medium text-[var(--signal)] hover:underline">
              {escopo === "sistema" ? "Ver o processamento" : "Ver todos os vídeos"} <IconArrowRight className="size-3.5" />
            </a>
            <p className="num text-[13px] text-muted-foreground" aria-label="Hora">
              {new Date(agora).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </p>
          </div>
        </header>

        <div className="px-4 py-5 sm:px-5">
          <FaixasContexto.Provider value={faixas}>
          <Linha d={dados} agora={agora} celular={celular} />
          {vazio && (
            <p className="mt-1 mb-2 pl-[56px] text-[12px] text-muted-foreground">
              Linha livre. Quando um canal publicar ou uma live começar, o vídeo aparece pendurado na etapa em que estiver.
            </p>
          )}
          <Saida
            filas={dados.filas}
            agora={agora}
            ativas={ativas}
            feed={mostrarFeed ? dados.feed : null}
            linkDaFila={linkDaFila}
            titulo={(conector, conteudo) => (
              <Camada nome="Filas de publicação" descricao="uma por rede" conector={conector} canto="cima-direita">
                {conteudo}
              </Camada>
            )}
          />
          </FaixasContexto.Provider>
        </div>
      </section>

      <aside className="min-w-0 rounded-xl bg-card shadow-[var(--shadow-flat)] xl:sticky xl:top-4 dark:border dark:border-border" aria-label="Atividade">
        <header className="flex items-baseline justify-between border-b border-border/70 px-4 py-3.5">
          <h2 className="text-[13px] font-semibold">Atividade</h2>
          <span className="text-[11px] text-muted-foreground">últimas 72 horas</span>
        </header>
        <div className="max-h-[560px] overflow-y-auto [scrollbar-width:thin] xl:max-h-[calc(100vh-7rem)]">
          <Atividade eventos={dados.registro} />
        </div>
      </aside>
    </div>
  )
}
