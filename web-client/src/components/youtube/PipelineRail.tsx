import { cn } from "@/lib/utils"
import type { SourceVideoStatus } from "@/types/api"

/**
 * As quatro etapas reais por que um vídeo passa, em ordem.
 *
 * É a única linha "técnica" da tela, e por isso fica em mono: cada segmento é
 * uma etapa que de fato existe no servidor (download, transcrição, escolha dos
 * trechos pela IA, corte), não um enfeite de progresso. Quem olha sabe EM QUE
 * o vídeo está, e não só "quanto falta".
 */
const ETAPAS: { status: SourceVideoStatus; rotulo: string }[] = [
  { status: "downloading", rotulo: "Baixando" },
  { status: "transcribing", rotulo: "Transcrevendo" },
  { status: "selecting_clips", rotulo: "Escolhendo trechos" },
  { status: "cutting", rotulo: "Cortando" },
]

export function PipelineRail({
  status,
  percent,
  eta,
  pausado = false,
}: {
  status: SourceVideoStatus
  percent: number | null
  eta?: string | null
  pausado?: boolean
}) {
  const atual = ETAPAS.findIndex((e) => e.status === status)

  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-4 gap-1" aria-hidden="true">
        {ETAPAS.map((e, i) => (
          <div key={e.status} className="relative h-1 overflow-hidden rounded-full bg-border">
            {i < atual && <div className="absolute inset-0 bg-status-posted" />}
            {i === atual && (
              <div className={cn("absolute inset-0", pausado ? "bg-muted-foreground/60" : "pipeline-vivo")} />
            )}
          </div>
        ))}
      </div>
      <div className="flex items-baseline justify-between gap-3 font-mono text-[11px] leading-none">
        <span className="min-w-0 truncate text-foreground">
          {atual >= 0 ? (
            <>
              <span className="text-muted-foreground">{atual + 1}/4</span> <span className="font-semibold text-tone-indigo-ink">{ETAPAS[atual].rotulo}</span>
              {pausado && <span className="text-muted-foreground"> · pausado</span>}
            </>
          ) : (
            <span className="text-muted-foreground">Na fila</span>
          )}
        </span>
        <span className="shrink-0 text-muted-foreground tabular-nums">
          {percent !== null && `${percent}%`}
          {eta ? ` · ~${eta}` : ""}
        </span>
      </div>
      <span className="sr-only">
        {atual >= 0 ? `Etapa ${atual + 1} de 4: ${ETAPAS[atual].rotulo}` : "Na fila"}
        {percent !== null ? `, ${percent}%` : ""}
      </span>
    </div>
  )
}
