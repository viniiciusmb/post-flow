import { useEffect, useState, type FormEvent } from "react"
import { IconTrash, IconArrowRight, IconMovie, IconBrandGoogleDrive } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import type { DriveStatusResponse, SourceVideo, TikTokAccountResponse, YoutubeChannel } from "@/types/api"

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function ChannelVideoThumb({ video }: { video: SourceVideo }) {
  const tone = SOURCE_VIDEO_STATUS_TONE[video.status]
  return (
    <a
      href={`/client/videos-clips?channelId=${video.channelId}`}
      className="flex w-32 shrink-0 flex-col gap-1.5"
      title={video.title}
    >
      <div className="relative h-18 w-32 overflow-hidden rounded-md bg-muted">
        {video.thumbnailUrl ? (
          <img src={video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <IconMovie className="size-5 text-muted-foreground" />
          </div>
        )}
        <div className="absolute right-1 top-1">
          <TonePill tone={tone.tone} spin={tone.spin} className="px-1.5 py-0.5 text-[9px]">
            {tone.label}
          </TonePill>
        </div>
      </div>
      <p className="line-clamp-2 text-xs leading-snug font-medium">{video.title}</p>
      <p className="text-[10px] text-muted-foreground">
        {video.clipCount} {video.clipCount === 1 ? "corte" : "cortes"}
      </p>
    </a>
  )
}

function ChannelCard({
  channel,
  videos,
  autoPostEnabled,
  hasTiktokAccount,
  hasDriveConnection,
  onToggleActive,
  onToggleAutoPost,
  onSetExportFolder,
  onSetDriveExportMode,
  onRemove,
}: {
  channel: YoutubeChannel
  videos: SourceVideo[]
  autoPostEnabled: boolean
  hasTiktokAccount: boolean
  hasDriveConnection: boolean
  onToggleActive: (checked: boolean) => Promise<void>
  onToggleAutoPost: (checked: boolean) => Promise<void>
  onSetExportFolder: (folderLink: string, autoMode: boolean) => Promise<void>
  onSetDriveExportMode: (mode: "auto" | "manual") => Promise<void>
  onRemove: () => void
}) {
  const recent = videos.slice(0, 6)
  const [savingActive, setSavingActive] = useState(false)
  const [savingAutoPost, setSavingAutoPost] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportFolderLink, setExportFolderLink] = useState("")
  const [autoModeOnCreate, setAutoModeOnCreate] = useState(false)
  const [savingExportFolder, setSavingExportFolder] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [savingExportMode, setSavingExportMode] = useState(false)

  async function handleToggleActive() {
    setError(null)
    setSavingActive(true)
    try {
      await onToggleActive(!channel.isActive)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.")
    } finally {
      setSavingActive(false)
    }
  }

  async function handleToggleAutoPost() {
    setError(null)
    setSavingAutoPost(true)
    try {
      await onToggleAutoPost(!autoPostEnabled)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.")
    } finally {
      setSavingAutoPost(false)
    }
  }

  async function handleSetExportFolder(event: FormEvent) {
    event.preventDefault()
    setExportError(null)
    setSavingExportFolder(true)
    try {
      await onSetExportFolder(exportFolderLink, autoModeOnCreate)
      setExportFolderLink("")
      setAutoModeOnCreate(false)
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Não foi possível salvar a pasta.")
    } finally {
      setSavingExportFolder(false)
    }
  }

  async function handleToggleExportMode() {
    setExportError(null)
    setSavingExportMode(true)
    try {
      await onSetDriveExportMode(channel.driveExportMode === "auto" ? "manual" : "auto")
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Não foi possível salvar.")
    } finally {
      setSavingExportMode(false)
    }
  }

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 p-4">
        <div className="flex items-center gap-3">
          <Avatar className="size-10">
            {channel.avatarUrl && <AvatarImage src={channel.avatarUrl} alt="" />}
            <AvatarFallback>{initials(channel.channelName || "YT")}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <a
              href={channel.channelUrl}
              target="_blank"
              rel="noreferrer"
              className="font-medium hover:underline"
            >
              {channel.channelName || channel.channelUrl}
            </a>
            <p className="text-xs text-muted-foreground">
              {videos.length > 0 ? `${videos.length} vídeo${videos.length > 1 ? "s" : ""} processado${videos.length > 1 ? "s" : ""}` : "Nenhum vídeo ainda"}
              {channel.lastPolledAt && ` · checado ${new Date(channel.lastPolledAt).toLocaleString("pt-BR")}`}
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} title="Remover canal">
            <IconTrash />
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {channel.isActive ? "Baixando e cortando automaticamente" : "Automação pausada"}
              </p>
              <p className="text-xs text-muted-foreground">
                {channel.isActive
                  ? "Vídeos novos deste canal entram na fila de corte assim que são detectados."
                  : "Vídeos novos deste canal não são baixados nem cortados até você retomar."}
              </p>
            </div>
            <Button
              size="sm"
              variant={channel.isActive ? "outline" : "default"}
              onClick={handleToggleActive}
              disabled={savingActive}
              className="shrink-0"
            >
              {savingActive ? "Salvando..." : channel.isActive ? "Pausar" : "Retomar"}
            </Button>
          </div>

          <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {!hasTiktokAccount
                  ? "Postagem automática no TikTok"
                  : autoPostEnabled
                    ? "Postando automaticamente no TikTok"
                    : "Postagem automática pausada"}
              </p>
              <p className="text-xs text-muted-foreground">
                {!hasTiktokAccount ? (
                  <>
                    Conecte a{" "}
                    <a href="/client/tiktok-account" className="text-primary hover:underline">
                      conta TikTok
                    </a>{" "}
                    pra habilitar (vale pra todos os canais).
                  </>
                ) : autoPostEnabled ? (
                  "Cortes prontos de qualquer canal entram na fila de postagem do TikTok."
                ) : (
                  "Cortes ficam prontos, mas não são enviados pro TikTok até você ligar isso."
                )}
              </p>
            </div>
            <Button
              size="sm"
              variant={autoPostEnabled ? "outline" : "default"}
              onClick={handleToggleAutoPost}
              disabled={savingAutoPost || !hasTiktokAccount}
              className="shrink-0"
            >
              {savingAutoPost ? "Salvando..." : autoPostEnabled ? "Pausar" : "Ligar"}
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBrandGoogleDrive className="size-4 text-muted-foreground" />
            Enviar cortes prontos deste canal pro Google Drive
          </div>
          {!hasDriveConnection ? (
            <p className="text-xs text-muted-foreground">
              Conecte seu{" "}
              <a href="/client/settings" className="text-primary hover:underline">
                Google Drive
              </a>{" "}
              em Configurações pra habilitar.
            </p>
          ) : (
            <>
              {channel.exportFolder ? (
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">
                      Pasta atual: <span className="text-foreground">{channel.exportFolder.name ?? channel.exportFolder.id}</span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {channel.driveExportMode === "auto"
                        ? "Todo corte pronto é enviado sozinho."
                        : "Você escolhe corte a corte em Vídeos & Cortes."}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleExportMode}
                    disabled={savingExportMode}
                    className="shrink-0"
                  >
                    {savingExportMode ? "Salvando..." : channel.driveExportMode === "auto" ? "Tornar manual" : "Tornar automático"}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Opcional — cada corte pronto gerado desse canal pode ser salvo nessa pasta.
                </p>
              )}
              <form onSubmit={handleSetExportFolder} className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    placeholder="Link ou ID da pasta do Drive"
                    value={exportFolderLink}
                    onChange={(e) => setExportFolderLink(e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                  <Button type="submit" size="sm" disabled={savingExportFolder} className="shrink-0">
                    {savingExportFolder ? "Salvando..." : channel.exportFolder ? "Trocar" : "Salvar"}
                  </Button>
                </div>
                {!channel.exportFolder && (
                  <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={autoModeOnCreate} onCheckedChange={(c) => setAutoModeOnCreate(c === true)} className="mt-0.5" />
                    Salvar todos os vídeos do canal "{channel.channelName}" automaticamente nessa pasta?
                  </label>
                )}
              </form>
              {exportError && <p className="text-xs text-destructive">{exportError}</p>}
            </>
          )}
        </div>

        {recent.length > 0 && (
          <div className="border-t border-border pt-3">
            <div className="flex gap-3 overflow-x-auto pb-1">
              {recent.map((v) => (
                <ChannelVideoThumb key={v.id} video={v} />
              ))}
            </div>
            <a
              href={`/client/videos-clips?channelId=${channel.id}`}
              className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
            >
              Ver vídeos <IconArrowRight className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function YouTubeChannelsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [channels, setChannels] = useState<YoutubeChannel[] | null>(null)
  const [videos, setVideos] = useState<SourceVideo[]>([])
  const [tiktokAccount, setTiktokAccount] = useState<TikTokAccountResponse | null>(null)
  const [driveStatus, setDriveStatus] = useState<DriveStatusResponse | null>(null)
  const [channelUrl, setChannelUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  async function load() {
    const [channelsData, videosData, tiktokData, driveData] = await Promise.all([
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
      api.get<{ videos: SourceVideo[] }>("/api/client/source-videos"),
      api.get<TikTokAccountResponse>("/api/client/tiktok-account"),
      api.get<DriveStatusResponse>("/api/client/drive"),
    ])
    setChannels(channelsData.channels)
    setVideos(videosData.videos)
    setTiktokAccount(tiktokData)
    setDriveStatus(driveData)
  }

  useEffect(() => {
    if (user) load()
  }, [user])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      await api.post("/api/client/youtube-channels", { channelUrl })
      setChannelUrl("")
      setSuccess('Canal adicionado, ainda "Pausado" — marque "Baixar e cortar automaticamente" abaixo pra ativar.')
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Nao foi possivel adicionar o canal.")
    } finally {
      setSubmitting(false)
    }
  }

  async function toggleActive(channel: YoutubeChannel, checked: boolean) {
    await api.post(`/api/client/youtube-channels/${channel.id}/active`, { isActive: checked })
    await load()
  }

  async function toggleAutoPost(checked: boolean) {
    await api.put("/api/client/tiktok-account/auto-post", { enabled: checked })
    await load()
  }

  async function setExportFolder(channel: YoutubeChannel, folderLink: string, autoMode: boolean) {
    await api.post(`/api/client/youtube-channels/${channel.id}/export-folder`, { folderLink, autoMode })
    await load()
  }

  async function setDriveExportMode(channel: YoutubeChannel, mode: "auto" | "manual") {
    await api.post(`/api/client/youtube-channels/${channel.id}/drive-export-mode`, { mode })
    await load()
  }

  async function removeChannel(channel: YoutubeChannel) {
    if (!confirm(`Remover o canal "${channel.channelName}"? Isso nao apaga os cortes ja gerados.`)) return
    await api.delete(`/api/client/youtube-channels/${channel.id}`)
    await load()
  }

  if (authLoading || !user) return null

  const hasTiktokAccount = tiktokAccount?.connected === true
  const autoPostEnabled = tiktokAccount?.connected === true && tiktokAccount.autoPostEnabled
  const hasDriveConnection = driveStatus?.connected === true

  return (
    <DashboardLayout user={user} onLogout={logout} title="Canais do YouTube">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Adicionar canal</CardTitle>
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
                <FieldLabel htmlFor="channelUrl">Link ou @handle do canal</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="channelUrl"
                    placeholder="https://www.youtube.com/@seucanal"
                    value={channelUrl}
                    onChange={(e) => setChannelUrl(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={submitting}>
                    {submitting ? "Adicionando..." : "Adicionar"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Só entram no corte automático os vídeos publicados depois de adicionar — o histórico do canal não é baixado.
                </p>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Canais cadastrados</h2>
        {!channels ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : channels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            Nenhum canal cadastrado ainda.
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                videos={videos.filter((v) => v.channelId === channel.id)}
                autoPostEnabled={autoPostEnabled}
                hasTiktokAccount={hasTiktokAccount}
                hasDriveConnection={hasDriveConnection}
                onToggleActive={(checked) => toggleActive(channel, checked)}
                onToggleAutoPost={toggleAutoPost}
                onSetExportFolder={(folderLink, autoMode) => setExportFolder(channel, folderLink, autoMode)}
                onSetDriveExportMode={(mode) => setDriveExportMode(channel, mode)}
                onRemove={() => removeChannel(channel)}
              />
            ))}
          </div>
        )}
      </div>
    </DashboardLayout>
  )
}
