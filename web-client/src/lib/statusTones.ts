import type { Tone } from "@/components/ui/tone-pill"
import type { ClipStatus, PostingOrigin, PostingStatus, SourceVideoStatus } from "@/types/api"
import type { ChaveDeTraducao } from "@/i18n"

/**
 * Cor e rótulo de cada estado.
 *
 * `label` guarda a CHAVE de tradução, não o texto: estes mapas são lidos por
 * meia dúzia de telas, e traduzir aqui exigiria um hook em cada uma. Quem
 * desenha chama t(label) — uma linha a mais no lugar onde já existe um `t`.
 */
export const POSTING_STATUS_TONE: Record<
  PostingStatus,
  { tone: Tone; label: ChaveDeTraducao; spin?: boolean }
> = {
  pending: { tone: "neutral", label: "status.postagem.pendente" },
  queued: { tone: "cyan", label: "status.postagem.naFila" },
  processing: { tone: "indigo", label: "status.postagem.publicando", spin: true },
  posted: { tone: "success", label: "status.postagem.postado" },
  error: { tone: "danger", label: "status.postagem.erro" },
  skipped: { tone: "neutral", label: "status.postagem.naoPostado" },
}

export const SOURCE_VIDEO_STATUS_TONE: Record<
  SourceVideoStatus,
  { tone: Tone; label: ChaveDeTraducao; spin?: boolean }
> = {
  detected: { tone: "neutral", label: "status.video.detectado" },
  downloading: { tone: "indigo", label: "status.video.baixando", spin: true },
  transcribing: { tone: "cyan", label: "status.video.transcrevendo", spin: true },
  selecting_clips: { tone: "cyan", label: "status.video.selecionando", spin: true },
  cutting: { tone: "violet", label: "status.video.cortando", spin: true },
  ready: { tone: "success", label: "status.video.pronto" },
  error: { tone: "danger", label: "status.video.erro" },
  cancelled: { tone: "neutral", label: "status.video.cancelado" },
  paused: { tone: "neutral", label: "status.video.pausado" },
  aguardando_creditos: { tone: "danger", label: "status.video.aguardandoCredito" },
  aguardando_conexao: { tone: "cyan", label: "status.video.aguardandoConexao" },
}

export const CLIP_STATUS_TONE: Record<
  ClipStatus,
  { tone: Tone; label: ChaveDeTraducao; spin?: boolean }
> = {
  pending: { tone: "neutral", label: "status.corte.naFila" },
  rendering: { tone: "indigo", label: "status.corte.editando", spin: true },
  ready: { tone: "success", label: "status.corte.pronto" },
  error: { tone: "danger", label: "status.corte.erro" },
}

export const ORIGIN_LABEL: Record<PostingOrigin, ChaveDeTraducao> = {
  drive_client: "status.origem.drive",
  youtube_clip: "status.origem.youtube",
}
