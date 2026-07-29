import type { SourceVideoStatus } from "@/types/api"

// Aproximacao por estagio - nao e progresso real de bytes baixados, e sim
// "em que fase do pipeline estamos" combinado com o tempo medio historico
// de cada video, pra dar uma nocao de andamento e ETA sem precisar
// instrumentar yt-dlp/ffmpeg byte a byte.
const STAGE_FLOOR: Partial<Record<SourceVideoStatus, number>> = {
  downloading: 5,
  transcribing: 35,
  selecting_clips: 55,
  cutting: 65,
}
const STAGE_CEIL: Partial<Record<SourceVideoStatus, number>> = {
  downloading: 35,
  transcribing: 55,
  selecting_clips: 65,
  cutting: 98,
}

export const ACTIVE_STATUSES: SourceVideoStatus[] = ["downloading", "transcribing", "selecting_clips", "cutting"]

export interface VideoProgress {
  percent: number
  etaSeconds: number | null
}

export function computeVideoProgress(
  status: SourceVideoStatus,
  processingStartedAt: string | null,
  avgProcessingSeconds: number
): VideoProgress | null {
  if (!ACTIVE_STATUSES.includes(status)) return null

  const floor = STAGE_FLOOR[status] ?? 0
  const ceil = STAGE_CEIL[status] ?? 95

  if (!processingStartedAt) return { percent: floor, etaSeconds: avgProcessingSeconds }

  const elapsedSeconds = (Date.now() - new Date(processingStartedAt).getTime()) / 1000
  const elapsedRatio = avgProcessingSeconds > 0 ? Math.min(1, elapsedSeconds / avgProcessingSeconds) : 0
  const percent = Math.round(Math.min(ceil, Math.max(floor, elapsedRatio * 100)))
  const etaSeconds = Math.max(0, Math.round(avgProcessingSeconds - elapsedSeconds))

  return { percent, etaSeconds }
}

export function formatEta(etaSeconds: number | null): string {
  if (etaSeconds === null) return ""
  if (etaSeconds < 60) return "menos de 1min"
  const minutes = Math.round(etaSeconds / 60)
  if (minutes < 60) return `${minutes}min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest > 0 ? `${hours}h${rest}min` : `${hours}h`
}
