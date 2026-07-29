import { useEffect, useState, type FormEvent } from "react"
import { IconChevronDown, IconChevronRight, IconLink, IconClock, IconRefresh, IconAdjustmentsHorizontal, IconPlayerPlay, IconDownload } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { VideoSettingsCard } from "@/components/dashboard/VideoSettingsCard"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { CLIP_STATUS_TONE, SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import { ACTIVE_STATUSES, computeVideoProgress, formatEta } from "@/lib/videoProgress"
import type { Clip, SourceVideo } from "@/types/api"

function formatDuration(seconds: number | null) {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

function ClipCard({ clip }: { clip: Clip }) {
  const [playing, setPlaying] = useState(false)
  const downloadUrl = `/api/client/source-videos/clips/${clip.id}/download`

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {clip.status === "ready" && playing ? (
        <video src={downloadUrl} controls autoPlay className="aspect-[9/16] w-full bg-black" />
      ) : (
        <div className="relative flex aspect-[9/16] w-full items-center justify-center bg-muted">
          {clip.status === "ready" ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="flex size-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
              title="Assistir"
            >
              <IconPlayerPlay className="size-4" />
            </button>
          ) : (
            <TonePill tone={CLIP_STATUS_TONE[clip.status].tone} spin={CLIP_STATUS_TONE[clip.status].spin} className="px-2 py-0.5 text-[10px]">
              {CLIP_STATUS_TONE[clip.status].label}
            </TonePill>
          )}
        </div>
      )}
      <div className="p-3">
        <p className="mb-2 line-clamp-2 text-sm font-medium">{clip.title}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatDuration(clip.endSeconds - clip.startSeconds)}</span>
          {clip.status === "ready" && (
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1 font-semibold text-primary hover:underline"
              title="Baixar corte"
            >
              <IconDownload className="size-3" />
              Baixar
            </a>
          )}
        </div>
      </div>
    </div>
  )
}

function VideoRow({
  video,
  avgProcessingSeconds,
  onRetried,
}: {
  video: SourceVideo
  avgProcessingSeconds: number
  onRetried: () => void
}) {
  const [open, setOpen] = useState(false)
  const [clips, setClips] = useState<Clip[] | null>(null)
  const [retrying, setRetrying] = useState(false)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !clips) {
      const data = await api.get<{ clips: Clip[] }>(`/api/client/source-videos/${video.id}/clips`)
      setClips(data.clips)
    }
  }

  async function retry() {
    setRetrying(true)
    try {
      await api.post(`/api/client/source-videos/${video.id}/retry`, {})
      onRetried()
    } finally {
      setRetrying(false)
    }
  }

  const progress = computeVideoProgress(video.status, video.processingStartedAt, avgProcessingSeconds)

  return (
    <Card>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-4 p-4 text-left"
        disabled={video.clipCount === 0 && video.status !== "ready"}
      >
        {video.clipCount > 0 || video.status === "ready" ? (
          open ? (
            <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {video.thumbnailUrl && (
          <div className="relative h-12 w-20 shrink-0">
            <img src={video.thumbnailUrl} alt="" className="h-12 w-20 rounded-md object-cover" />
            {progress && (
              <div className="absolute inset-x-0 bottom-0 flex items-center justify-center gap-1 rounded-b-md bg-black/75 px-1 py-0.5 text-[9px] font-semibold text-emerald-400">
                <IconClock className="size-2.5" />
                {progress.percent}%
              </div>
            )}
          </div>
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{video.title}</p>
          <p className="text-xs text-muted-foreground">
            {video.channelName ?? "Link avulso"} · {formatDuration(video.durationSeconds)}
            {video.publishedAt && ` · ${new Date(video.publishedAt).toLocaleDateString("pt-BR")}`}
            {progress && progress.etaSeconds !== null && ` · faltam ~${formatEta(progress.etaSeconds)}`}
          </p>
        </div>

        <TonePill tone={SOURCE_VIDEO_STATUS_TONE[video.status].tone} spin={SOURCE_VIDEO_STATUS_TONE[video.status].spin}>
          {SOURCE_VIDEO_STATUS_TONE[video.status].label}
        </TonePill>
      </button>

      {video.errorMessage && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
          <p className="text-xs text-destructive">{video.errorMessage}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={retry}
            disabled={retrying}
            className="h-7 shrink-0 gap-1 text-xs"
          >
            <IconRefresh className="size-3" />
            {retrying ? "Reiniciando..." : "Tentar novamente"}
          </Button>
        </div>
      )}

      {open && (
        <CardContent className="border-t border-border pt-4">
          {!clips ? (
            <Skeleton className="h-16" />
          ) : clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum corte gerado ainda.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {clips.map((clip) => (
                <ClipCard key={clip.id} clip={clip} />
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function AddManualVideoCard({ onAdded }: { onAdded: () => void }) {
  const [url, setUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const created = await api.post<{ id: number; title: string }>("/api/client/source-videos/manual", { url })
      setUrl("")
      setSuccess(`"${created.title}" entrou na fila — acompanhe o progresso na lista abaixo.`)
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível cortar esse vídeo.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLink className="size-4 text-muted-foreground" />
          Cortar vídeo por link
        </CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit}>
          <FieldGroup>
            {error && (
              <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
            {success && (
              <p className="rounded-md border border-status-posted/30 bg-status-posted/10 px-3 py-2 text-sm text-status-posted">
                {success}
              </p>
            )}
            <Field>
              <FieldLabel htmlFor="videoUrl">Link do vídeo no YouTube</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="videoUrl"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <Button type="submit" disabled={submitting}>
                  {submitting ? "Cortando..." : "Cortar"}
                </Button>
              </div>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

const PENDING_STATUSES = ["detected", ...ACTIVE_STATUSES]

export function VideosClipsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [videos, setVideos] = useState<SourceVideo[] | null>(null)
  const [avgProcessingSeconds, setAvgProcessingSeconds] = useState(480)
  const [showSettings, setShowSettings] = useState(false)
  const [, setTick] = useState(0)
  const channelIdFilter = new URLSearchParams(window.location.search).get("channelId")
  const filteredChannelName = videos?.find((v) => String(v.channelId) === channelIdFilter)?.channelName

  async function load() {
    const query = channelIdFilter ? `?channelId=${channelIdFilter}` : ""
    const data = await api.get<{ videos: SourceVideo[]; avgProcessingSeconds: number }>(`/api/client/source-videos${query}`)
    setVideos(data.videos)
    setAvgProcessingSeconds(data.avgProcessingSeconds)
  }

  useEffect(() => {
    if (!user) return
    load()
  }, [user])

  const hasPending = videos?.some((v) => PENDING_STATUSES.includes(v.status)) ?? false

  // Enquanto tiver video em andamento: busca o status real do servidor a
  // cada 8s, e forca um re-render a cada 1s so pra % e ETA (calculados
  // localmente a partir de processingStartedAt) andarem na tela.
  useEffect(() => {
    if (!hasPending) return
    const refetch = setInterval(load, 8000)
    const tick = setInterval(() => setTick((t) => t + 1), 1000)
    return () => {
      clearInterval(refetch)
      clearInterval(tick)
    }
  }, [hasPending])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeos & Cortes">
      <AddManualVideoCard onAdded={load} />

      <div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowSettings((v) => !v)}
          className="gap-2"
        >
          <IconAdjustmentsHorizontal className="size-4" />
          {showSettings ? "Ocultar configurações de corte" : "Configurar qualidade e estilo dos cortes"}
        </Button>
        {showSettings && (
          <div className="mt-3">
            <VideoSettingsCard />
          </div>
        )}
      </div>

      {channelIdFilter && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          Mostrando só vídeos de <span className="font-medium text-foreground">{filteredChannelName ?? "canal selecionado"}</span>
          <a href="/client/videos-clips" className="font-semibold text-primary hover:underline">
            limpar filtro
          </a>
        </div>
      )}

      {!videos ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhum vídeo detectado ainda. Cole um link acima, cadastre um canal em "Canais do YouTube" ou conecte sua pasta do Drive em "Configurações".
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {videos.map((video) => (
            <VideoRow key={video.id} video={video} avgProcessingSeconds={avgProcessingSeconds} onRetried={load} />
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
