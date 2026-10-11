import { useEffect, useState } from "react"
import { IconMinus, IconPlus, IconX } from "@tabler/icons-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export type Horarios = { mode: "auto" | "manual"; videosPerDay: number; manualTimes: string[]; defaultTimes: string[] }

/**
 * Horário sugerido ao clicar em "adicionar": 8h no primeiro e depois sempre 2h
 * depois do último. Repetir é impossível por construção - dois horários iguais
 * seriam duas publicações disputando o mesmo minuto (aconteceu no TikTok em
 * 13/09/2026, quando o botão punha sempre 12:00). Passando das 22h, preenche
 * os buracos do dia antes de cair na madrugada.
 */
export function proximoHorarioSugerido(usados: string[]) {
  const emMin = usados.map((h) => Number(h.slice(0, 2)) * 60 + Number(h.slice(3, 5)))
  const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
  if (emMin.length === 0) return "08:00"
  const proximo = Math.max(...emMin) + 120
  if (proximo <= 23 * 60 && !usados.includes(hhmm(proximo))) return hhmm(proximo)
  for (const h of [...Array(16).keys()].map((i) => i + 8).concat([...Array(8).keys()])) {
    const c = `${String(h).padStart(2, "0")}:00`
    if (!usados.includes(c)) return c
  }
  return "08:00"
}

export function HorariosEditor({
  valor,
  maxPorDia = 10,
  salvando,
  onSalvar,
}: {
  valor: Horarios
  maxPorDia?: number
  salvando?: boolean
  onSalvar: (proximo: Omit<Horarios, "defaultTimes">) => void
}) {
  // Rascunho dos horários digitados: salva ao sair do campo, não a cada tecla
  // (requisições fora de ordem fariam a mais lenta vencer com valor antigo).
  const [rascunho, setRascunho] = useState(valor.manualTimes)
  useEffect(() => setRascunho(valor.manualTimes), [valor.manualTimes])

  const salvar = (p: Partial<Omit<Horarios, "defaultTimes">>) =>
    onSalvar({ mode: valor.mode, videosPerDay: valor.videosPerDay, manualTimes: valor.manualTimes, ...p })

  function trocarModo(mode: "auto" | "manual") {
    if (mode === valor.mode) return
    // "Eu escolho" começa dos horários que o Padrão já usava, não de uma lista
    // vazia: a pessoa quer ajustar, não recomeçar.
    const manualTimes = mode === "manual" && valor.manualTimes.length === 0 ? valor.defaultTimes : valor.manualTimes
    salvar({ mode, manualTimes, videosPerDay: mode === "manual" ? Math.max(1, manualTimes.length) : valor.videosPerDay })
  }

  return (
    <div className="flex flex-col gap-5">
      <div role="radiogroup" aria-label="Como os horários são escolhidos" className="grid gap-2 sm:grid-cols-2">
        {(
          [
            { v: "auto", t: "Horários do Post Flow", d: "Espalhados entre 8h e 20h, em hora cheia." },
            { v: "manual", t: "Eu escolho os horários", d: "Cada horário é uma publicação por dia." },
          ] as const
        ).map((op) => (
          <button
            key={op.v}
            type="button"
            role="radio"
            aria-checked={valor.mode === op.v}
            disabled={salvando}
            onClick={() => trocarModo(op.v)}
            className={cn(
              "rounded-xl border px-3.5 py-3 text-left transition-colors",
              valor.mode === op.v ? "border-foreground bg-muted/50" : "border-border hover:bg-muted/40",
            )}
          >
            <span className="block text-sm font-medium">{op.t}</span>
            <span className="mt-0.5 block text-xs text-muted-foreground">{op.d}</span>
          </button>
        ))}
      </div>

      {valor.mode === "auto" ? (
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm">Publicações por dia</span>
            <span className="flex items-center gap-1">
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Menos"
                disabled={salvando || valor.videosPerDay <= 1}
                onClick={() => salvar({ videosPerDay: valor.videosPerDay - 1 })}
              >
                <IconMinus />
              </Button>
              <span className="w-8 text-center font-mono text-base font-semibold tabular-nums">{valor.videosPerDay}</span>
              <Button
                size="icon-sm"
                variant="outline"
                aria-label="Mais"
                disabled={salvando || valor.videosPerDay >= maxPorDia}
                onClick={() => salvar({ videosPerDay: valor.videosPerDay + 1 })}
              >
                <IconPlus />
              </Button>
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {valor.defaultTimes.map((h) => (
              <span key={h} className="rounded-md border border-border bg-muted/40 px-2 py-1 font-mono text-xs tabular-nums">
                {h}
              </span>
            ))}
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <span className="text-sm">Horários de cada dia</span>
          <div className="flex flex-wrap gap-2">
            {rascunho.map((h, i) => (
              <span key={i} className="flex items-center gap-0.5 rounded-lg border border-border bg-card pl-1">
                <Input
                  type="time"
                  aria-label={`Horário ${i + 1}`}
                  className="h-8 w-[7.75rem] border-0 bg-transparent px-1.5 font-mono shadow-none"
                  value={h}
                  disabled={salvando}
                  onChange={(e) => setRascunho((r) => r.map((x, k) => (k === i ? e.target.value : x)))}
                  onBlur={() => {
                    if (rascunho[i] && rascunho[i] !== valor.manualTimes[i]) salvar({ manualTimes: rascunho, videosPerDay: rascunho.length })
                  }}
                />
                {rascunho.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Tirar ${h}`}
                    disabled={salvando}
                    onClick={() => {
                      const n = valor.manualTimes.filter((_, k) => k !== i)
                      salvar({ manualTimes: n, videosPerDay: n.length })
                    }}
                    className="flex size-7 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    <IconX className="size-3.5" />
                  </button>
                )}
              </span>
            ))}
            {valor.manualTimes.length < maxPorDia && (
              <Button
                size="sm"
                variant="outline"
                className="h-9 gap-1"
                disabled={salvando}
                onClick={() => {
                  const n = [...valor.manualTimes, proximoHorarioSugerido(valor.manualTimes)].sort()
                  salvar({ manualTimes: n, videosPerDay: n.length })
                }}
              >
                <IconPlus className="size-3.5" />
                Horário
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
