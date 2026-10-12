import { useMemo, useRef } from "react"
import { cn } from "@/lib/utils"
import { horaCurta, nomeDaRede, plural, type Maquina } from "./comum"

type Evento = Maquina["registro"][number]

/** Cada fato do pipeline, escrito como uma etapa passando o trabalho pra outra. */
function lerEvento(e: Evento): { de: string; para: string; texto: string; sub: string | null; ok?: boolean } {
  switch (e.tipo) {
    case "detectado":
      return { de: "vigia", para: "download", texto: e.extra ? `Vídeo novo em ${e.extra}` : "Vídeo enviado por você", sub: e.titulo }
    case "baixado":
      return { de: "download", para: "transcrição", texto: "Download concluído", sub: e.titulo }
    case "transcrito":
      return { de: "transcrição", para: "seleção", texto: "Transcrição pronta", sub: e.titulo }
    case "escolhido":
      return { de: "seleção", para: "corte", texto: e.n ? `IA escolheu ${plural(e.n, "trecho", "trechos")}` : "Trechos escolhidos", sub: e.titulo }
    case "corte_pronto":
      return { de: "corte", para: "fila", texto: "Corte pronto", sub: e.titulo }
    case "publicado": {
      const [rede, conta] = (e.extra ?? "").split(":")
      return {
        de: "fila",
        para: nomeDaRede(rede).toLowerCase(),
        texto: `Publicado no ${nomeDaRede(rede)}${conta ? ` · @${conta.replace(/^@/, "")}` : ""}`,
        sub: e.titulo,
        ok: true,
      }
    }
    case "live_gravando":
      return { de: "lives", para: "gravação", texto: `${e.extra ?? "Canal"} entrou ao vivo`, sub: e.titulo }
    case "live_corte":
      return { de: "corte", para: "fila", texto: `Corte da live de ${e.extra ?? "um canal"} pronto`, sub: e.titulo }
  }
}

const chave = (e: Evento) => `${e.tipo}|${e.em}|${e.titulo ?? ""}`

export function Atividade({ eventos }: { eventos: Evento[] }) {
  // Só anima o que CHEGOU depois que a tela abriu: na primeira carga, 16
  // linhas piscando de uma vez não diriam nada.
  const vistos = useRef<Set<string> | null>(null)
  const novos = useMemo(() => {
    const chaves = eventos.map(chave)
    if (vistos.current === null) {
      vistos.current = new Set(chaves)
      return new Set<string>()
    }
    const n = new Set(chaves.filter((c) => !vistos.current!.has(c)))
    chaves.forEach((c) => vistos.current!.add(c))
    return n
  }, [eventos])

  if (eventos.length === 0) {
    return <p className="px-4 py-8 text-center text-[12px] text-muted-foreground">Nada aconteceu nas últimas 72 horas.</p>
  }

  return (
    <ol
      className="relative flex flex-col px-4 py-1 before:absolute before:top-4 before:bottom-4 before:left-[23px] before:w-px before:bg-border"
      aria-live="polite"
    >
      {eventos.map((e) => {
        const k = chave(e)
        const l = lerEvento(e)
        return (
          <li key={k} className={cn("relative grid grid-cols-[14px_1fr] gap-2.5 rounded-md py-2", novos.has(k) && "maq-chegou")}>
            <span className="relative flex justify-center pt-1.5" aria-hidden="true">
              <span className={cn("size-2 rounded-full ring-4 ring-card", l.ok ? "bg-[var(--maq-ok)]" : "bg-[var(--maq-work)]/70")} />
            </span>
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <p className={cn("min-w-0 truncate text-[12.5px] leading-snug font-medium", l.ok && "text-[var(--maq-ok)]")}>{l.texto}</p>
                <time dateTime={e.em} className="num shrink-0 text-[10.5px] text-muted-foreground">
                  {horaCurta(e.em)}
                </time>
              </div>
              {l.sub && <p className="truncate text-[11.5px] text-muted-foreground">{l.sub}</p>}
              <p className="num mt-0.5 text-[10px] text-muted-foreground/70">
                {l.de} <span className="text-[var(--maq-work)]">→</span> {l.para}
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
