import { useEffect, useState } from "react"
import { cn } from "@/lib/utils"

/**
 * A régua das próximas 24 horas: começa AGORA (à esquerda) e vai até a mesma
 * hora de amanhã. Os horários em que a conta publica aparecem marcados, a
 * virada do dia também, e os cortes da fila ficam pendurados em cima do
 * horário em que vão sair (com a capa).
 *
 * Começar do agora, e não da meia-noite, é o que faz a régua responder sempre
 * a mesma pergunta - "o que sai daqui pra frente?". Uma régua de 00h a 24h
 * fica quase toda no passado à noite, justamente quando a pessoa confere a
 * fila do dia seguinte.
 *
 * Os horários vêm do servidor (quem decide de verdade); a régua só desenha.
 */
export type ItemDaRegua = { id: number; horario: string | null; capaUrl: string | null; titulo: string | null }

const JANELA_MS = 24 * 60 * 60 * 1000

function useAgora() {
  const [agora, setAgora] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setAgora(new Date()), 60_000)
    return () => clearInterval(t)
  }, [])
  return agora
}

/** Cada "HH:MM" nas próximas 24h, como instantes. */
function ocorrencias(horarios: string[], agora: Date) {
  const fim = agora.getTime() + JANELA_MS
  const out: Date[] = []
  for (const dia of [0, 1]) {
    for (const h of horarios) {
      const [hh, mm] = h.split(":").map(Number)
      const d = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + dia, hh, mm || 0)
      if (d.getTime() >= agora.getTime() && d.getTime() <= fim) out.push(d)
    }
  }
  return out
}

function hhmm(d: Date) {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
}

export function ReguaDoDia({
  horarios,
  itens,
  cor,
  pausada,
  className,
}: {
  /** "HH:MM" que a conta usa (os do modo padrão ou os escolhidos). */
  horarios: string[]
  itens: ItemDaRegua[]
  cor: string
  pausada?: boolean
  className?: string
}) {
  const agora = useAgora()
  const t0 = agora.getTime()
  const pos = (d: Date) => `${Math.min(100, Math.max(0, ((d.getTime() - t0) / JANELA_MS) * 100))}%`

  const datados = itens
    .filter((i) => i.horario)
    .map((i) => ({ ...i, d: new Date(i.horario as string) }))
    .sort((a, b) => a.d.getTime() - b.d.getTime())
  // Vencido e ainda na fila (publicação desligada, ou saindo agora): fica no "agora".
  const naJanela = datados.filter((i) => i.d.getTime() <= t0 + JANELA_MS)
  const depois = datados.length - naJanela.length
  const proximo = datados[0]?.d
  const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  const slots = ocorrencias(horarios, agora)
  const marcas = [0, 6, 12, 18, 24].map((h) => new Date(t0 + h * 3600_000))

  const resumo = pausada
    ? "Fila parada: nada sai sozinho até você ligar de novo"
    : proximo
      ? `Próximo corte ${proximo.getTime() <= t0 ? "agora" : proximo.toDateString() === agora.toDateString() ? `hoje às ${hhmm(proximo)}` : proximo.toDateString() === meiaNoite.toDateString() ? `amanhã às ${hhmm(proximo)}` : `em ${proximo.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hhmm(proximo)}`}`
      : slots.length
        ? `Fila vazia · próximo horário livre às ${hhmm(slots[0])}`
        : "Fila vazia"

  return (
    <div className={cn("flex flex-col gap-1.5", className)} role="img" aria-label={`${resumo}. Horários: ${horarios.join(", ") || "nenhum"}.`}>
      <div className="relative h-[66px] select-none" aria-hidden>
        {naJanela.map((i, k) => (
          <span
            key={i.id}
            title={`${i.titulo ?? "Corte"} · ${hhmm(i.d)}`}
            className="absolute top-0 h-10 w-[22px] -translate-x-1/2 overflow-hidden rounded-[5px] bg-muted ring-2 ring-card"
            style={{ left: pos(i.d), zIndex: 10 + k, boxShadow: `0 0 0 1px ${cor}66`, marginLeft: i.d.getTime() <= t0 ? 12 : 0 }}
          >
            {i.capaUrl && <img src={i.capaUrl} alt="" className="size-full object-cover" loading="lazy" />}
          </span>
        ))}
        <div className="absolute inset-x-0 top-[51px] h-px border-t border-dashed border-border" />
        {/* Virada do dia. */}
        <span className="absolute top-[42px] h-[18px] w-px bg-foreground/25" style={{ left: pos(meiaNoite) }} />
        <span className="absolute top-[40px] -translate-x-1/2 -translate-y-full text-[10px] font-medium text-muted-foreground" style={{ left: pos(meiaNoite) }}>
          amanhã
        </span>
        {slots.map((d) => (
          <span
            key={d.getTime()}
            className={cn("absolute top-[47px] size-[9px] -translate-x-1/2 rounded-full ring-2 ring-card", pausada && "opacity-40")}
            style={{ left: pos(d), background: cor }}
          />
        ))}
        <span className="absolute left-0 top-[40px] h-[24px] w-[3px] rounded-full bg-foreground" />
        {/* O "agora" pulsa: a régua anda sozinha, e o ponto diz que ela está viva. */}
        {!pausada && (
          <span className="maq-lampada absolute top-[36px] -left-[2.5px]" data-viva="true" style={{ color: "var(--signal)" }} />
        )}
      </div>
      <div className="relative h-3.5 text-[10.5px] tabular-nums text-muted-foreground" aria-hidden>
        {marcas.map((d, k) => (
          <span key={k} className={cn("absolute", k === 0 ? "left-0" : k === marcas.length - 1 ? "right-0" : "-translate-x-1/2")} style={k > 0 && k < marcas.length - 1 ? { left: pos(d) } : undefined}>
            {k === 0 ? "agora" : `${String(d.getHours()).padStart(2, "0")}h`}
          </span>
        ))}
      </div>
      <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span className={cn("font-medium", pausada ? "text-amber-700 dark:text-amber-400" : "text-foreground")}>{resumo}</span>
        {depois > 0 && <span>· +{depois} mais adiante</span>}
      </p>
    </div>
  )
}

/** A régua em miniatura, pra lista de contas: os horários das próximas 24h. */
export function MiniRegua({ horarios, cor, apagada }: { horarios: string[]; cor: string; apagada?: boolean }) {
  const agora = useAgora()
  const t0 = agora.getTime()
  const meiaNoite = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() + 1)
  const pos = (d: Date) => `${((d.getTime() - t0) / JANELA_MS) * 100}%`
  return (
    <span className={cn("relative block h-2 w-full", apagada && "opacity-40")} aria-hidden>
      <span className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-border" />
      <span className="absolute top-0 h-2 w-px bg-foreground/20" style={{ left: pos(meiaNoite) }} />
      {ocorrencias(horarios, agora).map((d) => (
        <span key={d.getTime()} className="absolute top-1/2 size-[5px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ left: pos(d), background: cor }} />
      ))}
      <span className="absolute left-0 top-0 h-2 w-[2px] rounded-full bg-foreground" />
    </span>
  )
}
