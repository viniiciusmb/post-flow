import { useEffect, useState } from "react"
import { PipelineRail } from "@/components/youtube/PipelineRail"
import { api } from "@/lib/api"
import type { Clip, SourceVideo } from "@/types/api"
import { GradeDeQuadros, Onda, Quadro, Varredura } from "./Processamento"

/**
 * A etapa do vídeo na tela "Vídeos do YouTube" (painel novo): a trilha das
 * quatro etapas e, embaixo, o desenho do que está acontecendo - o mesmo da
 * linha de produção do Início, pra a pessoa reconhecer de uma tela pra outra.
 *
 * No corte, os quadros vêm dos cortes de verdade (com o progresso do render),
 * consultados a cada 4 s só enquanto o vídeo está cortando.
 */
export function EtapaDoVideo({
  video,
  percent,
  eta,
}: {
  video: SourceVideo
  percent: number | null
  eta: string | null
}) {
  const cortando = video.status === "cutting"
  const [cortes, setCortes] = useState<Clip[] | null>(null)

  useEffect(() => {
    if (!cortando) return
    let vivo = true
    const carregar = () =>
      api
        .get<{ clips: Clip[] }>(`/api/client/source-videos/${video.id}/clips`)
        .then((r) => vivo && setCortes(r.clips))
        .catch(() => {})
    carregar()
    const id = window.setInterval(carregar, 4000)
    return () => {
      vivo = false
      window.clearInterval(id)
    }
  }, [cortando, video.id])

  return (
    <div className="maq flex flex-col gap-3">
      <PipelineRail status={video.status} percent={percent} eta={eta} />
      {video.status === "downloading" && <div className="maq-baixando h-2 overflow-hidden rounded-full" aria-hidden="true" />}
      {video.status === "transcribing" && <Onda barras={72} altura="h-7" />}
      {video.status === "selecting_clips" && <Varredura />}
      {cortando && cortes && cortes.length > 0 && (
        <div>
          <GradeDeQuadros>
            {cortes.slice(0, 16).map((c, i) => (
              <Quadro
                key={c.id}
                chave={`yt-${c.id}`}
                status={c.status === "rendering" || c.status === "ready" || c.status === "error" ? c.status : "pending"}
                progresso={c.renderProgressPercent}
                imagem={c.thumbnailUrl ?? video.thumbnailUrl}
                numero={i + 1}
                titulo={c.title}
              />
            ))}
          </GradeDeQuadros>
          <p className="mt-2 text-[11.5px] text-muted-foreground">
            <span className="font-mono font-semibold text-foreground tabular-nums">{cortes.filter((c) => c.status === "ready").length}</span> de{" "}
            {cortes.length} cortes prontos
          </p>
        </div>
      )}
    </div>
  )
}
