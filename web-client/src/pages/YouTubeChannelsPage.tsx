import { dataHora } from "@/lib/formatoLocal"
import { useEffect, useState, type FormEvent } from "react"
import { IconTrash, IconArrowRight, IconMovie, IconBrandGoogleDrive, IconBrandTiktok, IconAlertTriangle } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import type { DriveStatusResponse, LatestChannelVideo, SourceVideo, TikTokAccountSummary, YoutubeChannel } from "@/types/api"
import { useT } from "@/i18n"

function formatDuration(seconds: number | null) {
  if (!seconds) return null
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return `${minutes}:${String(rest).padStart(2, "0")}`
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

function ChannelVideoThumb({ video }: { video: SourceVideo }) {
  const t = useT()
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
            {t(tone.label)}
          </TonePill>
        </div>
      </div>
      <p data-conteudo className="line-clamp-2 text-xs leading-snug font-medium">{video.title}</p>
      <p className="text-[10px] text-muted-foreground">
        {video.clipCount === 1 ? t("cortes.umCorte") : t("cortes.nCortes", { n: video.clipCount })}
      </p>
    </a>
  )
}

function ChannelCard({
  channel,
  videos,
  tiktokAccounts,
  hasDriveConnection,
  onToggleActive,
  onSetTiktokAccount,
  onSetExportFolder,
  onSetDriveExportMode,
  onRemove,
}: {
  channel: YoutubeChannel
  videos: SourceVideo[]
  tiktokAccounts: TikTokAccountSummary[]
  hasDriveConnection: boolean
  onToggleActive: (checked: boolean) => Promise<void>
  onSetTiktokAccount: (tiktokAccountId: number | null) => Promise<void>
  onSetExportFolder: (folderLink: string, autoMode: boolean) => Promise<void>
  onSetDriveExportMode: (mode: "auto" | "manual") => Promise<void>
  onRemove: () => void
}) {
  const t = useT()
  const recent = videos.slice(0, 6)
  const [savingActive, setSavingActive] = useState(false)
  const [savingQueueGate, setSavingQueueGate] = useState(false)
  // Espelho local pra caixa reagir no clique, sem esperar a volta do servidor.
  const [queueGate, setQueueGate] = useState(channel.processOnlyWhenQueueClear)
  const [savingTiktokAccount, setSavingTiktokAccount] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportFolderLink, setExportFolderLink] = useState("")
  const [autoModeOnCreate, setAutoModeOnCreate] = useState(false)
  const [savingExportFolder, setSavingExportFolder] = useState(false)
  const [exportError, setExportError] = useState<string | null>(null)
  const [savingExportMode, setSavingExportMode] = useState(false)

  const linkedAccount = tiktokAccounts.find((a) => a.id === channel.tiktokAccountId) ?? null

  async function handleToggleActive() {
    setError(null)
    setSavingActive(true)
    try {
      await onToggleActive(!channel.isActive)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelSalvar"))
    } finally {
      setSavingActive(false)
    }
  }

  async function handleToggleQueueGate(marcado: boolean) {
    setError(null)
    setQueueGate(marcado)
    setSavingQueueGate(true)
    try {
      await api.post(`/api/client/youtube-channels/${channel.id}/queue-gate`, { ativo: marcado })
    } catch (err) {
      setQueueGate(!marcado) // desfaz na tela se o servidor recusou
      setError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelSalvar"))
    } finally {
      setSavingQueueGate(false)
    }
  }

  async function handleSelectTiktokAccount(value: string) {
    setError(null)
    setSavingTiktokAccount(true)
    try {
      await onSetTiktokAccount(value === "none" ? null : Number(value))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelSalvar"))
    } finally {
      setSavingTiktokAccount(false)
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
      setExportError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelSalvarPasta"))
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
      setExportError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelSalvar"))
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
              {videos.length > 0
                ? videos.length === 1
                  ? t("canais.umVideoProcessado")
                  : t("canais.nVideosProcessados", { n: videos.length })
                : t("canais.nenhumVideoAinda")}
              {channel.lastPolledAt && ` · ${t("canais.checadoEm", { quando: dataHora(channel.lastPolledAt) })}`}
            </p>
            {/* A checagem roda a cada 20 min. Quando ela falha, a data acima
                congela e parece que o sistema parou - por isso o aviso diz o
                que aconteceu de verdade em vez de deixar o cliente adivinhar. */}
            {channel.isActive && channel.lastCheckOk === false && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-amber-600 dark:text-amber-500">
                <IconAlertTriangle className="mt-px size-3.5 shrink-0" />
                <span className="min-w-0">
                  {channel.checkFailCount > 3
                    ? `A checagem vem falhando (${channel.checkFailCount} vezes seguidas). Vamos continuar tentando a cada 20 minutos.`
                    : t("canais.checagemFalhou")}
                </span>
              </p>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onRemove} title={t("canais.removerCanal")}>
            <IconTrash />
          </Button>
        </div>

        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">
                {channel.isActive ? t("canais.baixandoAutomaticamente") : t("canais.automacaoPausada")}
              </p>
              <p className="text-xs text-muted-foreground">
                {channel.isActive
                  ? t("canais.videosNovosEntram")
                  : t("canais.videosNovosNaoBaixados")}
              </p>
            </div>
            <Button
              size="sm"
              variant={channel.isActive ? "outline" : "default"}
              onClick={handleToggleActive}
              disabled={savingActive}
              className="shrink-0"
            >
              {savingActive ? t("comum.salvando") : channel.isActive ? t("canais.pausar") : t("canais.retomar")}
            </Button>
          </div>

          {/* Freio de engarrafamento, logo abaixo do liga/desliga porque é a
              mesma decisão: QUANDO pegar vídeo novo. Sem ele, um canal que
              publica todo dia gera cortes mais rápido do que a fila publica, a
              fila só cresce, e o corte que finalmente sai já está velho. */}
          <label className="-mt-1 flex cursor-pointer items-start gap-2.5 rounded-lg border border-border bg-muted/30 p-3">
            <Checkbox
              checked={queueGate}
              disabled={savingQueueGate}
              onCheckedChange={(v) => handleToggleQueueGate(v === true)}
              className="mt-0.5"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium">{t("canais.esperarFilaBaixar")}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">
                {t("canais.esperarFilaBaixarTexto")}
              </span>
            </span>
          </label>

          <div className="flex flex-col gap-2 border-t border-border pt-3">
            <div className="flex items-center gap-2 text-sm font-medium">
              <IconBrandTiktok className="size-4 text-muted-foreground" />{t("canais.postarNaConta")}</div>
            {tiktokAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t("canais.nenhumaContaAinda")}{" "}
                <a href="/client/tiktok-account" className="text-primary hover:underline">{t("canais.conecteUma")}</a>{" "}
                {t("canais.praPoderPostar")}
              </p>
            ) : (
              <>
                <Select
                  value={channel.tiktokAccountId ? String(channel.tiktokAccountId) : "none"}
                  onValueChange={handleSelectTiktokAccount}
                  disabled={savingTiktokAccount}
                >
                  <SelectTrigger size="sm" className="w-full max-w-xs text-xs">
                    <SelectValue placeholder={t("canais.escolhaUmaConta")} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t("canais.nenhumaNaoPosta")}</SelectItem>
                    {tiktokAccounts.map((a) => (
                      <SelectItem key={a.id} value={String(a.id)}>
                        {a.displayName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {linkedAccount && (
                  <p className="text-xs text-muted-foreground">
                    {linkedAccount.autoPostEnabled ? t("canais.postagemLigada") : t("canais.postagemDesligada")}{" "}
                    <a href="/client/tiktok-account" className="text-primary hover:underline">{t("canais.gerenciarEmPublicacao")}</a>
                  </p>
                )}
                <a href="/client/tiktok-account" className="text-xs font-semibold text-primary hover:underline">
                  + {t("pub.conectarOutraConta")}
                </a>
              </>
            )}
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex flex-col gap-2 rounded-lg border border-border px-3 py-3">
          <div className="flex items-center gap-2 text-sm font-medium">
            <IconBrandGoogleDrive className="size-4 text-muted-foreground" />{t("canais.enviarProDrive")}</div>
          {!hasDriveConnection ? (
            <p className="text-xs text-muted-foreground">
              {t("canais.conecteSeu")}{" "}
              <a href="/client/settings" className="text-primary hover:underline">
                Google Drive
              </a>{" "}
              {t("canais.emConfiguracoes")}
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
                        ? t("canais.todoCortePronto")
                        : t("canais.vocEscolheCorteACorte")}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={handleToggleExportMode}
                    disabled={savingExportMode}
                    className="shrink-0"
                  >
                    {savingExportMode ? "Salvando..." : channel.driveExportMode === "auto" ? "Tornar manual" : t("canais.tornarAutomatico")}
                  </Button>
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{t("canais.opcionalPasta")}</p>
              )}
              <form onSubmit={handleSetExportFolder} className="flex flex-col gap-2">
                <div className="flex gap-2">
                  <Input
                    placeholder={t("canais.linkOuIdPasta")}
                    value={exportFolderLink}
                    onChange={(e) => setExportFolderLink(e.target.value)}
                    required
                    className="h-8 text-xs"
                  />
                  <Button type="submit" size="sm" disabled={savingExportFolder} className="shrink-0">
                    {savingExportFolder ? "Salvando..." : channel.exportFolder ? t("canais.trocar") : t("comum.salvar")}
                  </Button>
                </div>
                {!channel.exportFolder && (
                  <label className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Checkbox checked={autoModeOnCreate} onCheckedChange={(c) => setAutoModeOnCreate(c === true)} className="mt-0.5" />
                    {t("cortes.confirmarPastaCanal", { canal: channel.channelName ?? "" })}
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
            >{t("canais.verVideos")}<IconArrowRight className="size-3" />
            </a>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function YouTubeChannelsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [channels, setChannels] = useState<YoutubeChannel[] | null>(null)
  const [videos, setVideos] = useState<SourceVideo[]>([])
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccountSummary[]>([])
  const [driveStatus, setDriveStatus] = useState<DriveStatusResponse | null>(null)
  const [channelUrl, setChannelUrl] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  // Popup "quer processar o video mais recente agora?" - so aparece quando o
  // canal recem-cadastrado tem um video pra sugerir (ver latestVideo na
  // resposta de POST /api/client/youtube-channels).
  const [latestVideoPrompt, setLatestVideoPrompt] = useState<{ channelId: number; video: LatestChannelVideo } | null>(null)
  const [processingLatest, setProcessingLatest] = useState(false)
  const [latestVideoError, setLatestVideoError] = useState<string | null>(null)
  // Pedir um canal sem ter onde publicar produz um canal que baixa, corta e
  // depois trava - o corte fica pronto e nao tem conta pra receber. Melhor
  // parar aqui e explicar do que deixar a pessoa descobrir sozinha dois dias
  // depois, com o disco ja cheio de corte parado.
  const [precisaDoTiktok, setPrecisaDoTiktok] = useState(false)

  async function load() {
    const [channelsData, videosData, tiktokData, driveData] = await Promise.all([
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
      api.get<{ videos: SourceVideo[] }>("/api/client/source-videos"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
      api.get<DriveStatusResponse>("/api/client/drive"),
    ])
    setChannels(channelsData.channels)
    setVideos(videosData.videos)
    setTiktokAccounts(tiktokData.accounts)
    setDriveStatus(driveData)
  }

  useEffect(() => {
    if (user) load()
  }, [user])

  function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSuccess(null)
    if (tiktokAccounts.length === 0) {
      setPrecisaDoTiktok(true)
      return
    }
    void adicionarCanal()
  }

  // Separado do handleSubmit porque o diálogo "só quero o Drive" precisa
  // chegar aqui direto, sem passar de novo pela checagem que o abriu.
  async function adicionarCanal() {
    setError(null)
    setSuccess(null)
    setSubmitting(true)
    try {
      const created = await api.post<{ channel: YoutubeChannel; latestVideo: LatestChannelVideo | null }>(
        "/api/client/youtube-channels",
        { channelUrl }
      )
      setChannelUrl("")
      setSuccess('Canal adicionado, ainda "Pausado". Marque t("canais.baixarECortar") abaixo pra ativar.')
      await load()
      if (created.latestVideo) {
        setLatestVideoPrompt({ channelId: created.channel.id, video: created.latestVideo })
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelAdicionar"))
    } finally {
      setSubmitting(false)
    }
  }

  async function acceptLatestVideo() {
    if (!latestVideoPrompt) return
    setProcessingLatest(true)
    setLatestVideoError(null)
    try {
      await api.post(`/api/client/youtube-channels/${latestVideoPrompt.channelId}/process-latest-video`, {})
      setLatestVideoPrompt(null)
      await load()
      setSuccess(t("canais.videoMaisRecenteEntrou"))
    } catch (err) {
      // Fica com o popup aberto mostrando o erro (em vez de fechar
      // silenciosamente) - sem isso o cliente via o popup so sumir sem
      // explicação nenhuma quando a chamada falhava (ex: video ja
      // processado antes por engano, canal bloqueado etc).
      setLatestVideoError(err instanceof ApiError ? err.message : t("canais.naoFoiPossivelProcessar"))
    } finally {
      setProcessingLatest(false)
    }
  }

  async function toggleActive(channel: YoutubeChannel, checked: boolean) {
    await api.post(`/api/client/youtube-channels/${channel.id}/active`, { isActive: checked })
    await load()
  }

  async function setTiktokAccount(channel: YoutubeChannel, tiktokAccountId: number | null) {
    await api.post(`/api/client/youtube-channels/${channel.id}/tiktok-account`, { tiktokAccountId })
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
    if (!confirm(t("canais.confirmarRemover", { nome: channel.channelName ?? "" }))) return
    await api.delete(`/api/client/youtube-channels/${channel.id}`)
    await load()
  }

  if (authLoading || !user) return null

  const hasDriveConnection = driveStatus?.connected === true

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("canais.titulo")}>
      <PageHeader
        title={t("canais.titulo")}
        description={t("canais.descricao")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("canais.adicionarCanal")}</CardTitle>
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
                <FieldLabel htmlFor="channelUrl">{t("canais.linkOuHandle")}</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="channelUrl"
                    data-tour="canal-endereco"
                    placeholder="https://www.youtube.com/@seucanal"
                    value={channelUrl}
                    onChange={(e) => setChannelUrl(e.target.value)}
                    required
                  />
                  <Button type="submit" disabled={submitting} data-tour="canal-adicionar">
                    {submitting ? t("canais.adicionando") : t("canais.adicionar")}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{t("canais.soEntramDepois")}</p>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("canais.cadastrados")}</h2>
        {!channels ? (
          <div className="flex flex-col gap-3">
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </div>
        ) : channels.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t("canais.nenhumCanalCadastrado")}</div>
        ) : (
          <div className="flex flex-col gap-3">
            {channels.map((channel) => (
              <ChannelCard
                key={channel.id}
                channel={channel}
                videos={videos.filter((v) => v.channelId === channel.id)}
                tiktokAccounts={tiktokAccounts}
                hasDriveConnection={hasDriveConnection}
                onToggleActive={(checked) => toggleActive(channel, checked)}
                onSetTiktokAccount={(tiktokAccountId) => setTiktokAccount(channel, tiktokAccountId)}
                onSetExportFolder={(folderLink, autoMode) => setExportFolder(channel, folderLink, autoMode)}
                onSetDriveExportMode={(mode) => setDriveExportMode(channel, mode)}
                onRemove={() => removeChannel(channel)}
              />
            ))}
          </div>
        )}
      </div>

      <Dialog
        open={latestVideoPrompt !== null}
        onOpenChange={(open) => {
          if (!open) {
            setLatestVideoPrompt(null)
            setLatestVideoError(null)
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("canais.jaComecar")}</DialogTitle>
            <DialogDescription>
              Encontramos o vídeo mais recente desse canal. Quer que a gente já processe ele agora (baixar, cortar e
              deixar pronto pra postar)? Se preferir não, o canal continua monitorado normalmente. Só os próximos
              vídeos publicados a partir de agora entram na fila sozinhos.
            </DialogDescription>
          </DialogHeader>
          {latestVideoError && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {latestVideoError}
            </p>
          )}
          {latestVideoPrompt && (
            <div className="flex gap-3 rounded-lg border border-border p-3">
              <div className="h-16 w-28 shrink-0 overflow-hidden rounded-md bg-muted">
                {latestVideoPrompt.video.thumbnailUrl ? (
                  <img src={latestVideoPrompt.video.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <IconMovie className="size-5 text-muted-foreground" />
                  </div>
                )}
              </div>
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-medium">{latestVideoPrompt.video.title}</p>
                {formatDuration(latestVideoPrompt.video.durationSeconds) && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {formatDuration(latestVideoPrompt.video.durationSeconds)}
                  </p>
                )}
              </div>
            </div>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setLatestVideoPrompt(null)
                setLatestVideoError(null)
              }}
              disabled={processingLatest}
            >
              {latestVideoError ? t("comum.fechar2") : t("canais.naoSoApartirDeAgora")}
            </Button>
            <Button onClick={acceptLatestVideo} disabled={processingLatest}>
              {processingLatest ? "Enviando..." : latestVideoError ? t("canais.tentarDeNovo") : t("canais.simProcessar")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Conecte o TikTok primeiro.

          Nao e um bloqueio absoluto: da pra usar o Post Flow so pra receber os
          cortes numa pasta do Drive, sem publicar em lugar nenhum. Por isso a
          saida secundaria existe - mas discreta, porque nao e o caminho que a
          maioria quer. */}
      <Dialog open={precisaDoTiktok} onOpenChange={setPrecisaDoTiktok}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("canais.precisaTiktokTitulo")}</DialogTitle>
            <DialogDescription>{t("canais.precisaTiktokTexto")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 rounded-lg border border-border p-3">
            <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-foreground text-background">
              <IconBrandTiktok className="size-5" />
            </span>
            <p className="min-w-0 text-sm text-muted-foreground">{t("canais.precisaTiktokDetalhe")}</p>
          </div>
          <DialogFooter className="sm:justify-between">
            <Button
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => {
                setPrecisaDoTiktok(false)
                void adicionarCanal()
              }}
            >
              {t("canais.soQueroDrive")}
            </Button>
            <Button asChild>
              <a href="/client/tiktok-account">{t("canais.conectarAgora")}</a>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </DashboardLayout>
  )
}
