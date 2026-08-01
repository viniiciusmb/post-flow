import type { Tone } from "@/components/ui/tone-pill"
import type { ClipStatus, PostingOrigin, PostingStatus, SourceVideoStatus } from "@/types/api"

export const POSTING_STATUS_TONE: Record<PostingStatus, { tone: Tone; label: string; spin?: boolean }> = {
  pending: { tone: "neutral", label: "Pendente" },
  queued: { tone: "cyan", label: "Na fila" },
  processing: { tone: "indigo", label: "Publicando", spin: true },
  posted: { tone: "success", label: "Postado" },
  error: { tone: "danger", label: "Erro" },
  skipped: { tone: "neutral", label: "Não postado" },
}

export const SOURCE_VIDEO_STATUS_TONE: Record<SourceVideoStatus, { tone: Tone; label: string; spin?: boolean }> = {
  detected: { tone: "neutral", label: "Detectado" },
  downloading: { tone: "indigo", label: "Baixando vídeo", spin: true },
  transcribing: { tone: "cyan", label: "Transcrevendo", spin: true },
  selecting_clips: { tone: "cyan", label: "Selecionando cortes", spin: true },
  cutting: { tone: "violet", label: "Gerando cortes", spin: true },
  ready: { tone: "success", label: "Pronto" },
  error: { tone: "danger", label: "Erro" },
  cancelled: { tone: "neutral", label: "Cancelado" },
  paused: { tone: "neutral", label: "Pausado" },
  aguardando_creditos: { tone: "danger", label: "Aguardando crédito" },
}

export const CLIP_STATUS_TONE: Record<ClipStatus, { tone: Tone; label: string; spin?: boolean }> = {
  pending: { tone: "neutral", label: "Na fila" },
  rendering: { tone: "indigo", label: "Editando", spin: true },
  ready: { tone: "success", label: "Pronto" },
  error: { tone: "danger", label: "Erro" },
}

export const ORIGIN_LABEL: Record<PostingOrigin, string> = {
  drive_client: "Drive do Cliente",
  youtube_clip: "YouTube",
}
