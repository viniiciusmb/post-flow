import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react"
import { REDES, type Rede } from "@/lib/redes"
import type { MaquinaResponse } from "@/types/api"

export type Maquina = MaquinaResponse
export type VideoNaLinhaT = MaquinaResponse["processando"][number]
export type FilaT = MaquinaResponse["filas"][number]

// ------------------------------------------------------------------ tempo

export function hhmmss(segundos: number) {
  const s = Math.max(0, Math.floor(segundos))
  const h = Math.floor(s / 3600)
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0")
  const ss = String(s % 60).padStart(2, "0")
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function ha(ms: number) {
  const min = Math.floor(ms / 60000)
  if (min < 1) return "agora há pouco"
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  return h < 24 ? `há ${h}h${String(min % 60).padStart(2, "0")}` : `há ${Math.floor(h / 24)} d`
}

export function emQuanto(ms: number) {
  if (ms <= 60000) return "agora"
  const min = Math.round(ms / 60000)
  if (min < 60) return `em ${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `em ${h}h${String(min % 60).padStart(2, "0")}`
  return `em ${Math.floor(h / 24)} d`
}

export function horaCurta(iso: string) {
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function duracaoCurta(ms: number) {
  const min = Math.round(ms / 60000)
  if (min < 1) return "<1 min"
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`
}

export function plural(n: number, um: string, varios: string) {
  return `${n} ${n === 1 ? um : varios}`
}

export function nomeDaRede(r: string) {
  return REDES[r as Rede]?.nome ?? r
}

// ------------------------------------------------------------------ hooks

export function useRelogio() {
  const [agora, setAgora] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setAgora(Date.now()), 1000)
    return () => window.clearInterval(id)
  }, [])
  return agora
}

/** Largura de um elemento, acompanhando redimensionamento (pros traçados em SVG). */
export function useLargura<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [largura, setLargura] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setLargura(el.clientWidth))
    ro.observe(el)
    setLargura(el.clientWidth)
    return () => ro.disconnect()
  }, [])
  return [ref, largura] as const
}

export function useMovimentoReduzido() {
  const [reduzido, setReduzido] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)")
    const f = () => setReduzido(mq.matches)
    mq.addEventListener("change", f)
    return () => mq.removeEventListener("change", f)
  }, [])
  return reduzido
}

// ------------------------------------------------------------------ peças visuais

/** Ícone da rede no quadrado com a cor da marca. */
export function MarcaDaRede({ rede, tamanho = "md" }: { rede: string; tamanho?: "sm" | "md" }) {
  const info = REDES[rede as Rede]
  const caixa = tamanho === "sm" ? "size-[18px] rounded-[5px]" : "size-8 rounded-lg"
  const icone = tamanho === "sm" ? "size-3" : "size-[18px]"
  if (!info) return <span className={`${caixa} inline-grid place-items-center bg-muted text-[10px]`}>{rede.slice(0, 1)}</span>
  return (
    <span className={`${caixa} inline-grid shrink-0 place-items-center text-white`} style={{ background: info.fundo }} title={info.nome}>
      <info.Icone className={icone} />
    </span>
  )
}

/**
 * Divisor de camada: "Entrada", "Processamento", "Saída".
 *
 * Quando a camada recebe um traçado da de cima, o título vai DENTRO da área
 * do traçado, num canto por onde as linhas não passam - assim a linha sai do
 * cartão de cima e entra direto no de baixo, sem um título no meio do caminho.
 */
export function Camada({
  nome,
  descricao,
  conector,
  canto = "baixo-direita",
  children,
}: {
  nome: string
  descricao?: ReactNode
  conector?: ReactNode
  canto?: "baixo-direita" | "cima-esquerda" | "cima-direita"
  children: ReactNode
}) {
  const titulo = (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
      <h3 className="text-xs font-semibold tracking-[0.07em] text-muted-foreground uppercase">{nome}</h3>
      {descricao && <p className="hidden text-xs text-muted-foreground/80 sm:block">{descricao}</p>}
    </div>
  )
  if (!conector) {
    return (
      <section>
        <div className="mb-3">{titulo}</div>
        {children}
      </section>
    )
  }
  return (
    <section>
      <div className="relative">
        {conector}
        <div className={`absolute bg-card px-1 ${canto === "baixo-direita" ? "right-0 bottom-1.5" : canto === "cima-direita" ? "top-0 right-0" : "top-0 left-0 -ml-1"}`}>{titulo}</div>
      </div>
      {children}
    </section>
  )
}

/** Capas pequenas sobrepostas (avatares de canais). */
export function Avatares({
  itens,
  max = 5,
  anel,
}: {
  itens: { id: number; nome: string | null; avatarUrl: string | null; destaque?: boolean }[]
  max?: number
  anel?: string
}) {
  return (
    <div className="flex -space-x-2">
      {itens.slice(0, max).map((c) => (
        <span
          key={c.id}
          title={c.nome ?? undefined}
          className="grid size-7 place-items-center overflow-hidden rounded-full bg-muted text-[11px] font-semibold text-muted-foreground ring-2 ring-card"
          style={c.destaque && anel ? { boxShadow: `0 0 0 2px var(--card), 0 0 0 4px ${anel}` } : undefined}
        >
          {c.avatarUrl ? <img src={c.avatarUrl} alt="" className="size-full object-cover" /> : (c.nome ?? "?").slice(0, 1).toUpperCase()}
        </span>
      ))}
      {itens.length > max && (
        <span className="grid size-7 place-items-center rounded-full bg-muted text-[10.5px] font-medium text-muted-foreground ring-2 ring-card">
          +{itens.length - max}
        </span>
      )}
    </div>
  )
}

/** As faixas da saída, por chave - pra quem mostra "vai para" saber o @ de cada conta. */
export const FaixasContexto = createContext<Map<string, FilaT>>(new Map())
export const useFaixas = () => useContext(FaixasContexto)

/** Etiqueta de origem: o que veio do YouTube e o que veio de live, sempre com a mesma cor. */
export function Origem({ tipo }: { tipo: "yt" | "live" }) {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-px text-[10px] font-semibold tracking-[0.02em] uppercase"
      style={{
        color: tipo === "yt" ? "var(--maq-yt)" : "var(--maq-live)",
        background: `color-mix(in oklab, ${tipo === "yt" ? "var(--maq-yt)" : "var(--maq-live)"} 11%, transparent)`,
      }}
    >
      {tipo === "yt" ? "YouTube" : "Live"}
    </span>
  )
}
