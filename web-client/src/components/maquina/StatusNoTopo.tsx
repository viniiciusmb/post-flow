import { useResumoDaMaquina, type ResumoDaMaquina } from "@/hooks/useResumoDaMaquina"

/**
 * Indicador da máquina na barra do topo, em toda tela do painel novo: uma
 * lâmpada e uma frase curta. É o que faz qualquer tela - Configurações,
 * Plano e uso - lembrar que o sistema continua trabalhando enquanto a pessoa
 * está ali. Leva pro Início, onde a linha inteira aparece.
 */
function frase(r: ResumoDaMaquina): { estado: "trabalhando" | "vigia" | "parada"; texto: string; curto: string } {
  const partes: string[] = []
  if (r.naLinha > 0) partes.push(`${r.naLinha} ${r.naLinha === 1 ? "vídeo" : "vídeos"} na linha`)
  if (r.livesGravando > 0) partes.push(`${r.livesGravando} ${r.livesGravando === 1 ? "live gravando" : "lives gravando"}`)
  if (r.publicandoAgora > 0) partes.push("publicando agora")
  if (partes.length > 0) return { estado: "trabalhando", texto: partes.join(" · "), curto: "Trabalhando" }
  if (r.fontes > 0) {
    return {
      estado: "vigia",
      texto: r.naFila > 0 ? `Em vigia · ${r.naFila} ${r.naFila === 1 ? "corte" : "cortes"} na fila` : "Em vigia",
      curto: "Em vigia",
    }
  }
  return { estado: "parada", texto: "Parada", curto: "Parada" }
}

const COR = { trabalhando: "var(--signal)", vigia: "var(--cyan)", parada: "var(--muted-foreground)" } as const

export function StatusNoTopo({ escopo }: { escopo: "cliente" | "sistema" }) {
  const r = useResumoDaMaquina(escopo === "sistema" ? "/api/admin/maquina/resumo" : "/api/client/maquina/resumo")
  if (!r) return null
  const f = frase(r)
  return (
    <a
      href={escopo === "sistema" ? "/admin" : "/client"}
      className="maq inline-flex min-w-0 max-w-[52vw] shrink items-center gap-2 rounded-full border border-border bg-card/70 px-2.5 py-1 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
      title="Ver a linha de produção"
    >
      <span className="maq-lampada shrink-0" data-viva={f.estado !== "parada"} style={{ color: COR[f.estado] }} aria-hidden="true" />
      <span className="truncate sm:hidden">{f.curto}</span>
      <span className="hidden truncate sm:inline">{f.texto}</span>
    </a>
  )
}
