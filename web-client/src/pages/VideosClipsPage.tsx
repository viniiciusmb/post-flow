import { useEffect, useState, type FormEvent } from "react"
import {
  IconChevronDown,
  IconChevronRight,
  IconLink,
  IconClock,
  IconRefresh,
  IconAdjustmentsHorizontal,
  IconPlayerPlay,
  IconPlayerPause,
  IconDownload,
  IconTrash,
  IconUpload,
  IconBrandGoogleDrive,
  IconBrandTiktok,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TonePill } from "@/components/ui/tone-pill"
import { VideoSettingsCard } from "@/components/dashboard/VideoSettingsCard"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { CLIP_STATUS_TONE, SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import { ACTIVE_STATUSES, computeVideoProgress, formatEta } from "@/lib/videoProgress"
import type { Clip, SourceVideo, SourceVideoStatus, TikTokAccountSummary, YoutubeChannel } from "@/types/api"

// So aparece quando o cliente tem 2+ contas TikTok - com 0 ou 1, o backend
// resolve sozinho (ver resolveTiktokAccountIds no sourceVideosApiController).
function TiktokAccountPicker({
  accounts,
  selected,
  onChange,
}: {
  accounts: TikTokAccountSummary[]
  selected: number[]
  onChange: (ids: number[]) => void
}) {
  if (accounts.length < 2) return null

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <Field>
      <FieldLabel>Postar cortes nessa(s) conta(s)</FieldLabel>
      <div className="flex flex-wrap gap-3">
        {accounts.map((a) => (
          <label key={a.id} className="flex items-center gap-1.5 text-xs">
            <Checkbox checked={selected.includes(a.id)} onCheckedChange={() => toggle(a.id)} />
            {a.displayName}
          </label>
        ))}
      </div>
    </Field>
  )
}

function formatDuration(seconds: number | null) {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

function ClipCard({
  clip,
  channel,
  onExported,
  onFolderSet,
}: {
  clip: Clip
  channel: YoutubeChannel | null
  onExported: () => void
  onFolderSet: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const [showPasteFolder, setShowPasteFolder] = useState(false)
  const [folderLink, setFolderLink] = useState("")
  const [autoMode, setAutoMode] = useState(false)
  const [savingFolder, setSavingFolder] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [driveError, setDriveError] = useState<string | null>(null)
  const downloadUrl = `/api/client/source-videos/clips/${clip.id}/download`

  async function handleUpload() {
    setUploading(true)
    setDriveError(null)
    try {
      await api.post(`/api/client/source-videos/clips/${clip.id}/export-to-drive`, {})
      onExported()
    } catch (err) {
      setDriveError(err instanceof ApiError ? err.message : "Falha ao enviar pro Drive.")
    } finally {
      setUploading(false)
    }
  }

  async function handleChooseFolder(event: FormEvent) {
    event.preventDefault()
    if (!channel) return
    setSavingFolder(true)
    setDriveError(null)
    try {
      await api.post(`/api/client/youtube-channels/${channel.id}/export-folder`, { folderLink, autoMode })
      setShowPasteFolder(false)
      setFolderLink("")
      onFolderSet()
    } catch (err) {
      setDriveError(err instanceof ApiError ? err.message : "Não foi possível salvar a pasta.")
    } finally {
      setSavingFolder(false)
    }
  }

  return (
    <div className="overflow-hidden rounded-lg border border-border">
      {clip.status === "ready" && playing ? (
        <video src={downloadUrl} poster={clip.thumbnailUrl ?? undefined} controls autoPlay className="aspect-[9/16] w-full bg-black" />
      ) : (
        <div className="relative flex aspect-[9/16] w-full items-center justify-center bg-muted">
          {clip.thumbnailUrl && (
            <img src={clip.thumbnailUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />
          )}
          {clip.status === "ready" ? (
            <button
              type="button"
              onClick={() => setPlaying(true)}
              className="relative flex size-10 items-center justify-center rounded-full bg-black/60 text-white transition hover:bg-black/80"
              title="Assistir"
            >
              <IconPlayerPlay className="size-4" />
            </button>
          ) : clip.status === "rendering" ? (
            <div className="relative flex w-full flex-col items-center gap-1.5 px-4">
              <span className="text-xs font-semibold text-white drop-shadow">{clip.renderProgressPercent}%</span>
              <div className="h-1 w-full overflow-hidden rounded-full bg-white/30">
                <div
                  className="h-full rounded-full bg-emerald-400 transition-all"
                  style={{ width: `${clip.renderProgressPercent}%` }}
                />
              </div>
            </div>
          ) : (
            <TonePill tone={CLIP_STATUS_TONE[clip.status].tone} spin={CLIP_STATUS_TONE[clip.status].spin} className="relative px-2 py-0.5 text-[10px]">
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

        {clip.status === "ready" && channel && (
          <div className="mt-2 border-t border-border pt-2">
            {clip.exportedToDrive ? (
              <p className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <IconBrandGoogleDrive className="size-3" />
                Enviado pro Drive
              </p>
            ) : channel.exportFolder ? (
              <button
                type="button"
                onClick={handleUpload}
                disabled={uploading}
                className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline disabled:opacity-50"
              >
                <IconBrandGoogleDrive className="size-3" />
                {uploading ? "Enviando..." : "Fazer upload no Drive"}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowPasteFolder((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  <IconBrandGoogleDrive className="size-3" />
                  Escolher pasta
                </button>
                {showPasteFolder && (
                  <form onSubmit={handleChooseFolder} className="mt-2 flex flex-col gap-1.5">
                    <Input
                      value={folderLink}
                      onChange={(e) => setFolderLink(e.target.value)}
                      placeholder="Link da pasta do Drive"
                      required
                      className="h-7 text-[11px]"
                    />
                    <label className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Checkbox checked={autoMode} onCheckedChange={(c) => setAutoMode(c === true)} className="mt-0.5" />
                      Salvar todos os vídeos do canal "{channel.channelName}" automaticamente nessa pasta?
                    </label>
                    <Button type="submit" size="sm" disabled={savingFolder} className="h-7 text-[11px]">
                      {savingFolder ? "Salvando..." : "Salvar"}
                    </Button>
                  </form>
                )}
              </>
            )}
            {driveError && <p className="mt-1 text-[11px] text-destructive">{driveError}</p>}
          </div>
        )}
      </div>
    </div>
  )
}

function ExportAllToDriveButton({ videoId, onExported }: { videoId: number; onExported: () => void }) {
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  async function handleClick() {
    setSending(true)
    setError(null)
    setResult(null)
    try {
      const data = await api.post<{ exported: number; failed: number; total: number }>(
        `/api/client/source-videos/${videoId}/export-all-to-drive`,
        {},
      )
      if (data.total === 0) {
        setResult("Todos os cortes já foram enviados pro Drive.")
      } else if (data.failed > 0) {
        setResult(`${data.exported} de ${data.total} cortes enviados (${data.failed} falharam).`)
      } else {
        setResult(`${data.exported} corte(s) enviados pro Drive.`)
      }
      onExported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Falha ao enviar os cortes pro Drive.")
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={sending} className="gap-1.5">
        <IconBrandGoogleDrive className="size-3.5" />
        {sending ? "Enviando cortes..." : "Exportar todos os cortes pro Drive"}
      </Button>
      {result && <span className="text-xs text-muted-foreground">{result}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

// Enquanto o corte esta rendering/pending, o progresso do video-fonte fica
// "cutting" - poll dos clips a cada poucos segundos pra % andar na tela sem
// precisar reabrir o card.
function useClipsPolling(videoId: number, open: boolean, videoStatus: SourceVideoStatus) {
  const [clips, setClips] = useState<Clip[] | null>(null)

  async function load() {
    const data = await api.get<{ clips: Clip[] }>(`/api/client/source-videos/${videoId}/clips`)
    setClips(data.clips)
  }

  useEffect(() => {
    if (!open) return
    load()
    if (videoStatus !== "cutting") return
    const interval = setInterval(load, 4000)
    return () => clearInterval(interval)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, videoStatus])

  return { clips, reload: load }
}

function VideoRow({
  video,
  avgProcessingSeconds,
  channel,
  onChanged,
  onDeleted,
  selected,
  onToggleSelect,
}: {
  video: SourceVideo
  avgProcessingSeconds: number
  channel: YoutubeChannel | null
  onChanged: () => void
  onDeleted: () => void
  selected: boolean
  onToggleSelect: () => void
}) {
  const [open, setOpen] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [deleting, setDeleting] = useState(false)
  // Fica true desde o clique ate o servidor CONFIRMAR (status realmente
  // mudar) - nao so durante a chamada da API, que responde rapido (so seta
  // uma flag no banco) bem antes do worker de fato notar e parar. Sem isso,
  // o botao voltava pra "Pausar" quase na hora, dando a impressao de que
  // nada tinha acontecido, quando na verdade a pausa ainda estava
  // acontecendo em segundo plano.
  const [pauseRequested, setPauseRequested] = useState(false)
  const [resumeRequested, setResumeRequested] = useState(false)
  const { clips, reload: reloadClips } = useClipsPolling(video.id, open, video.status)

  const isActive = ACTIVE_STATUSES.includes(video.status)
  const isPaused = video.status === "paused"

  useEffect(() => {
    if (!isActive) setPauseRequested(false)
    if (!isPaused) setResumeRequested(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [video.status])

  async function retry() {
    setRetrying(true)
    try {
      await api.post(`/api/client/source-videos/${video.id}/retry`, {})
      onChanged()
    } finally {
      setRetrying(false)
    }
  }

  async function pause() {
    setPauseRequested(true)
    try {
      await api.post(`/api/client/source-videos/${video.id}/pause`, {})
      onChanged()
    } catch {
      setPauseRequested(false)
    }
  }

  async function resume() {
    setResumeRequested(true)
    try {
      await api.post(`/api/client/source-videos/${video.id}/resume`, {})
      onChanged()
    } catch {
      setResumeRequested(false)
    }
  }

  async function remove() {
    if (!confirm(`Remover "${video.title}" e todos os cortes gerados dele? Essa ação não pode ser desfeita.`)) return
    setDeleting(true)
    try {
      await api.delete(`/api/client/source-videos/${video.id}`)
      onDeleted()
    } finally {
      setDeleting(false)
    }
  }

  const progress = computeVideoProgress(video.status, video.processingStartedAt, avgProcessingSeconds)

  return (
    <Card>
      <div className="flex w-full items-center gap-4 p-4">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-4 text-left"
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
        </button>

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{video.title}</p>
          <p className="text-xs text-muted-foreground">
            {video.channelName ?? "Link avulso / upload"} · {formatDuration(video.durationSeconds)}
            {video.publishedAt && ` · ${new Date(video.publishedAt).toLocaleDateString("pt-BR")}`}
            {video.clipCount > 0 && ` · ${video.readyClipCount}/${video.clipCount} cortes concluídos`}
            {progress && progress.etaSeconds !== null && ` · faltam ~${formatEta(progress.etaSeconds)}`}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconBrandTiktok className="size-3" />
            {video.tiktokAccountNames.length > 0 ? (
              <>Postar em: {video.tiktokAccountNames.join(", ")}</>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">Sem conta TikTok vinculada</span>
            )}
          </p>
        </div>

        <TonePill tone={SOURCE_VIDEO_STATUS_TONE[video.status].tone} spin={SOURCE_VIDEO_STATUS_TONE[video.status].spin}>
          {SOURCE_VIDEO_STATUS_TONE[video.status].label}
        </TonePill>

        {isActive && (
          <Button size="sm" variant="outline" onClick={pause} disabled={pauseRequested} className="h-7 shrink-0 gap-1 text-xs">
            <IconPlayerPause className="size-3" />
            {pauseRequested ? "Pausando..." : "Pausar"}
          </Button>
        )}
        {isPaused && (
          <Button size="sm" onClick={resume} disabled={resumeRequested} className="h-7 shrink-0 gap-1 text-xs">
            <IconPlayerPlay className="size-3" />
            {resumeRequested ? "Retomando..." : "Retomar"}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={remove} disabled={deleting} title="Remover vídeo">
          <IconTrash className="size-4" />
        </Button>
      </div>

      {(video.status === "error" || video.status === "cancelled") && (
        <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2">
          <p className="text-xs text-destructive">
            {video.errorMessage || "Processamento cancelado."}
          </p>
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
            <>
              {channel?.exportFolder && clips.some((c) => c.status === "ready" && !c.exportedToDrive) && (
                <div className="mb-3">
                  <ExportAllToDriveButton videoId={video.id} onExported={reloadClips} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {clips.map((clip) => (
                  <ClipCard
                    key={clip.id}
                    clip={clip}
                    channel={channel}
                    onExported={reloadClips}
                    onFolderSet={() => {
                      reloadClips()
                      onChanged()
                    }}
                  />
                ))}
              </div>
            </>
          )}
        </CardContent>
      )}
    </Card>
  )
}

function AddManualVideoCard({ onAdded, tiktokAccounts }: { onAdded: () => void; tiktokAccounts: TikTokAccountSummary[] }) {
  const [url, setUrl] = useState("")
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const created = await api.post<{ id: number; title: string }>("/api/client/source-videos/manual", {
        url,
        tiktokAccountIds: selectedAccounts,
      })
      setUrl("")
      setSelectedAccounts([])
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
            <TiktokAccountPicker accounts={tiktokAccounts} selected={selectedAccounts} onChange={setSelectedAccounts} />
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function UploadVideoCard({ onAdded, tiktokAccounts }: { onAdded: () => void; tiktokAccounts: TikTokAccountSummary[] }) {
  const [file, setFile] = useState<File | null>(null)
  const [title, setTitle] = useState("")
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!file) return
    setError(null)
    setSuccess(null)
    setUploading(true)
    setProgress(0)

    const formData = new FormData()
    formData.append("video", file)
    if (title.trim()) formData.append("title", title.trim())
    if (selectedAccounts.length > 0) formData.append("tiktokAccountIds", JSON.stringify(selectedAccounts))

    const xhr = new XMLHttpRequest()
    xhr.open("POST", "/api/client/source-videos/upload")
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      setUploading(false)
      if (xhr.status >= 200 && xhr.status < 300) {
        const data = JSON.parse(xhr.responseText)
        setFile(null)
        setTitle("")
        setSelectedAccounts([])
        setSuccess(`"${data.title}" enviado — entrou na fila de corte.`)
        onAdded()
      } else {
        try {
          setError(JSON.parse(xhr.responseText).error || "Não foi possível enviar o vídeo.")
        } catch {
          setError("Não foi possível enviar o vídeo.")
        }
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setError("Falha de conexão ao enviar o vídeo.")
    }
    xhr.send(formData)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconUpload className="size-4 text-muted-foreground" />
          Enviar vídeo do computador/celular
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
              <FieldLabel htmlFor="videoFile">Arquivo de vídeo</FieldLabel>
              <Input
                id="videoFile"
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="videoTitle">Título (opcional)</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="videoTitle"
                  placeholder="Ex: Live de sábado"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Button type="submit" disabled={!file || uploading}>
                  {uploading ? `Enviando... ${progress}%` : "Enviar e cortar"}
                </Button>
              </div>
            </Field>
            <TiktokAccountPicker accounts={tiktokAccounts} selected={selectedAccounts} onChange={setSelectedAccounts} />
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

const PENDING_STATUSES = ["detected", "paused", ...ACTIVE_STATUSES]
const STAGE_PRIORITY: Record<string, number> = {
  paused: -1,
  cutting: 0,
  selecting_clips: 1,
  transcribing: 2,
  downloading: 3,
  detected: 4,
}

export function VideosClipsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [videos, setVideos] = useState<SourceVideo[] | null>(null)
  const [channels, setChannels] = useState<YoutubeChannel[]>([])
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccountSummary[]>([])
  const [avgProcessingSeconds, setAvgProcessingSeconds] = useState(480)
  const [showSettings, setShowSettings] = useState(false)
  const [showStyleEditor, setShowStyleEditor] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [, setTick] = useState(0)
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set())
  const [confirmingBulkDelete, setConfirmingBulkDelete] = useState(false)
  const [bulkDeleting, setBulkDeleting] = useState(false)
  const channelIdFilter = new URLSearchParams(window.location.search).get("channelId")
  const filteredChannelName = videos?.find((v) => String(v.channelId) === channelIdFilter)?.channelName
  const channelById = new Map(channels.map((c) => [c.id, c]))

  async function load() {
    const query = channelIdFilter ? `?channelId=${channelIdFilter}` : ""
    const [videosData, channelsData, tiktokData] = await Promise.all([
      api.get<{ videos: SourceVideo[]; avgProcessingSeconds: number }>(`/api/client/source-videos${query}`),
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
    ])
    setVideos(videosData.videos)
    setAvgProcessingSeconds(videosData.avgProcessingSeconds)
    setChannels(channelsData.channels)
    setTiktokAccounts(tiktokData.accounts)
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  function toggleSelect(id: number) {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  // Sem popup nativo: primeiro clique so arma a confirmação (o botão muda
  // de texto por alguns segundos), segundo clique dentro da janela exclui
  // de verdade.
  async function handleBulkDeleteClick() {
    if (!confirmingBulkDelete) {
      setConfirmingBulkDelete(true)
      setTimeout(() => setConfirmingBulkDelete(false), 4000)
      return
    }
    setConfirmingBulkDelete(false)
    setBulkDeleting(true)
    try {
      await api.post("/api/client/source-videos/bulk-delete", { ids: [...selectedIds] })
      setSelectedIds(new Set())
      await load()
    } finally {
      setBulkDeleting(false)
    }
  }

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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPending])

  if (authLoading || !user) return null

  const inProgress = (videos ?? [])
    .filter((v) => PENDING_STATUSES.includes(v.status))
    .sort((a, b) => (STAGE_PRIORITY[a.status] ?? 9) - (STAGE_PRIORITY[b.status] ?? 9))
  const finished = (videos ?? []).filter((v) => !PENDING_STATUSES.includes(v.status))

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeos & Cortes">
      <AddManualVideoCard onAdded={load} tiktokAccounts={tiktokAccounts} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowUpload((v) => !v)} className="gap-2">
          <IconUpload className="size-4" />
          {showUpload ? "Ocultar envio de arquivo" : "Enviar vídeo por arquivo"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowSettings((v) => !v)} className="gap-2">
          <IconAdjustmentsHorizontal className="size-4" />
          {showSettings ? "Ocultar configurações de corte" : "Configurar qualidade e estilo dos cortes"}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowStyleEditor((v) => !v)} className="gap-2">
          <IconAdjustmentsHorizontal className="size-4" />
          {showStyleEditor ? "Ocultar estilo visual" : "Estilo visual do corte"}
        </Button>
      </div>
      {showUpload && <UploadVideoCard onAdded={load} tiktokAccounts={tiktokAccounts} />}
      {showSettings && <VideoSettingsCard />}
      {showStyleEditor && <ClipStyleEditorCard />}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3">
          <span className="text-sm text-muted-foreground">
            {selectedIds.size} selecionado{selectedIds.size > 1 ? "s" : ""}
          </span>
          <Button
            size="sm"
            variant={confirmingBulkDelete ? "destructive" : "outline"}
            disabled={bulkDeleting}
            onClick={handleBulkDeleteClick}
            className="ml-auto gap-1.5"
          >
            <IconTrash className="size-3.5" />
            {bulkDeleting
              ? "Excluindo..."
              : confirmingBulkDelete
                ? `Confirmar exclusão de ${selectedIds.size}?`
                : "Excluir selecionados"}
          </Button>
        </div>
      )}

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
          Nenhum vídeo detectado ainda. Cole um link, envie um arquivo, cadastre um canal em "Canais do YouTube" ou conecte sua pasta do Drive em "Configurações".
        </div>
      ) : (
        <Tabs defaultValue="in-progress">
          <TabsList>
            <TabsTrigger value="in-progress">Em andamento ({inProgress.length})</TabsTrigger>
            <TabsTrigger value="finished">Prontos ({finished.length})</TabsTrigger>
          </TabsList>
          <TabsContent value="in-progress" className="flex flex-col gap-3">
            {inProgress.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                Nenhum vídeo em andamento agora.
              </div>
            ) : (
              inProgress.map((video) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  avgProcessingSeconds={avgProcessingSeconds}
                  channel={video.channelId ? (channelById.get(video.channelId) ?? null) : null}
                  onChanged={load}
                  onDeleted={load}
                  selected={selectedIds.has(video.id)}
                  onToggleSelect={() => toggleSelect(video.id)}
                />
              ))
            )}
          </TabsContent>
          <TabsContent value="finished" className="flex flex-col gap-3">
            {finished.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                Nenhum vídeo pronto ainda.
              </div>
            ) : (
              finished.map((video) => (
                <VideoRow
                  key={video.id}
                  video={video}
                  avgProcessingSeconds={avgProcessingSeconds}
                  channel={video.channelId ? (channelById.get(video.channelId) ?? null) : null}
                  onChanged={load}
                  onDeleted={load}
                  selected={selectedIds.has(video.id)}
                  onToggleSelect={() => toggleSelect(video.id)}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </DashboardLayout>
  )
}
