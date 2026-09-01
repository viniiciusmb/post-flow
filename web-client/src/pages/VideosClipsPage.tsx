import { data } from "@/lib/formatoLocal"
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
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TonePill } from "@/components/ui/tone-pill"
import { ClipStyleEditorCard } from "@/components/dashboard/ClipStyleEditorCard"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError, csrfToken } from "@/lib/api"
import { CLIP_STATUS_TONE, SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import { ACTIVE_STATUSES, computeVideoProgress, formatEta } from "@/lib/videoProgress"
import type { Clip, SourceVideo, SourceVideoStatus, TikTokAccountSummary, YoutubeChannel } from "@/types/api"
import { useT } from "@/i18n"

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
  const t = useT()
  if (accounts.length < 2) return null

  function toggle(id: number) {
    onChange(selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id])
  }

  return (
    <Field>
      <FieldLabel>{t("cortes.postarNessasContas")}</FieldLabel>
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
  const t = useT()
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
      setDriveError(err instanceof ApiError ? err.message : t("cortes.falhaEnviarDrive"))
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
      setDriveError(err instanceof ApiError ? err.message : t("cortes.naoFoiPossivelSalvarPasta"))
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
              {t(CLIP_STATUS_TONE[clip.status].label)}
            </TonePill>
          )}
        </div>
      )}
      <div className="p-3">
        <p data-conteudo className="mb-2 line-clamp-2 text-sm font-medium">{clip.title}</p>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{formatDuration(clip.endSeconds - clip.startSeconds)}</span>
          {clip.status === "ready" && (
            <a
              href={downloadUrl}
              download
              className="flex items-center gap-1 font-semibold text-primary hover:underline"
              title={t("cortes.baixarCorte")}
            >
              <IconDownload className="size-3" />{t("comum.baixar2")}</a>
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
                {uploading ? "Enviando..." : t("cortes.fazerUploadDrive")}
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setShowPasteFolder((v) => !v)}
                  className="flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline"
                >
                  <IconBrandGoogleDrive className="size-3" />{t("cortes.escolherPasta")}</button>
                {showPasteFolder && (
                  <form onSubmit={handleChooseFolder} className="mt-2 flex flex-col gap-1.5">
                    <Input
                      value={folderLink}
                      onChange={(e) => setFolderLink(e.target.value)}
                      placeholder={t("cortes.linkDaPastaDrive")}
                      required
                      className="h-7 text-[11px]"
                    />
                    <label className="flex items-start gap-1.5 text-[11px] text-muted-foreground">
                      <Checkbox checked={autoMode} onCheckedChange={(c) => setAutoMode(c === true)} className="mt-0.5" />
                      {t("cortes.confirmarPastaCanal", { canal: channel.channelName ?? "" })}
                    </label>
                    <Button type="submit" size="sm" disabled={savingFolder} className="h-7 text-[11px]">
                      {savingFolder ? "Salvando..." : t("comum.salvar")}
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
  const t = useT()
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
        setResult(t("cortes.todosJaEnviados"))
      } else if (data.failed > 0) {
        setResult(`${data.exported} de ${data.total} cortes enviados (${data.failed} falharam).`)
      } else {
        setResult(`${data.exported} corte(s) enviados pro Drive.`)
      }
      onExported()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cortes.falhaEnviarCortes"))
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="button" variant="outline" size="sm" onClick={handleClick} disabled={sending} className="gap-1.5">
        <IconBrandGoogleDrive className="size-3.5" />
        {sending ? t("cortes.enviandoCortes") : t("cortes.exportarTodos")}
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

// O selo "Somente membros" do YouTube: estrela dentro de um círculo, em verde.
//
// Desenhado à mão em SVG em vez de usar o ícone oficial — o selo do YouTube é
// material de marca de terceiro, e carregá-lo obrigaria a buscar um arquivo de
// fora. A forma é o que faz o cliente reconhecer, e ela é genérica.
function SeloDeMembros() {
  const t = useT()
  return (
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-md bg-tone-success-wash px-2 py-1 text-xs font-semibold text-tone-success-ink">
      <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
        <path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm4.6 8.3-2 1.9.5 2.8a.6.6 0 0 1-.9.6L12 14.3l-2.5 1.3a.6.6 0 0 1-.9-.6l.5-2.8-2-1.9a.6.6 0 0 1 .3-1l2.8-.4 1.2-2.5a.6.6 0 0 1 1.1 0l1.2 2.5 2.8.4a.6.6 0 0 1 .3 1Z" />
      </svg>
      {t("cortes.somenteMembros")}
    </span>
  )
}

function VideoRow({
  video,
  avgProcessingSeconds,
  channel,
  onChanged,
  onDeleted,
  selected,
  onToggleSelect,
  mostrarTunel,
}: {
  video: SourceVideo
  avgProcessingSeconds: number
  channel: YoutubeChannel | null
  onChanged: () => void
  onDeleted: () => void
  selected: boolean
  onToggleSelect: () => void
  /** Vem da página (uma consulta só) em vez de cada linha chamar useAuth. */
  mostrarTunel: boolean
}) {
  const t = useT()
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
  const [enqueueing, setEnqueueing] = useState(false)
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

  // Vídeo parado em "detectado" com a fila livre: o job se perdeu entre a
  // detecção e o processamento (o worker reinicia numa janela ruim, por
  // exemplo). O sistema resgata sozinho depois de 30 minutos, mas até lá não
  // havia nada que o cliente pudesse fazer além de esperar sem saber.
  async function processarAgora() {
    setEnqueueing(true)
    try {
      await api.post(`/api/client/source-videos/${video.id}/enqueue`, {})
      onChanged()
    } finally {
      setEnqueueing(false)
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
    if (!confirm(t("cortes.confirmarRemover", { titulo: video.title }))) return
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
      <div className="flex w-full flex-wrap items-center gap-3 p-4 sm:flex-nowrap sm:gap-4">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} className="shrink-0" />
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex min-w-0 items-center gap-3 text-left sm:gap-4"
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
          <p data-conteudo className="truncate text-sm font-medium">{video.title}</p>
          <p className="text-xs text-muted-foreground">
            {video.channelName ?? "Link avulso / upload"} · {formatDuration(video.durationSeconds)}
            {video.publishedAt && ` · ${data(video.publishedAt)}`}
            {video.clipCount > 0 && ` · ${t("cortes.cortesConcluidos", { prontos: video.readyClipCount, total: video.clipCount })}`}
            {progress && progress.etaSeconds !== null && ` · ${t("cortes.faltam", { tempo: formatEta(progress.etaSeconds, t) })}`}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconBrandTiktok className="size-3" />
            {video.tiktokAccountNames.length > 0 ? (
              <>{t("cortes.postarEm", { contas: video.tiktokAccountNames.join(", ") })}</>
            ) : (
              <span className="text-amber-600 dark:text-amber-400">{t("cortes.semContaVinculada")}</span>
            )}
          </p>
        </div>

        {/* Status e acoes num grupo so: no celular ele cai inteiro pra segunda
            linha em vez de espremer (ou estourar) a linha do titulo. */}
        <div className="flex w-full flex-wrap items-center justify-end gap-2 sm:w-auto sm:flex-nowrap">
        <TonePill tone={SOURCE_VIDEO_STATUS_TONE[video.status].tone} spin={SOURCE_VIDEO_STATUS_TONE[video.status].spin}>
          {t(SOURCE_VIDEO_STATUS_TONE[video.status].label)}
        </TonePill>

        {isActive && (
          <Button size="sm" variant="outline" onClick={pause} disabled={pauseRequested} className="h-7 shrink-0 gap-1 text-xs">
            <IconPlayerPause className="size-3" />
            {pauseRequested ? t("cortes.pausando") : t("cortes.pausar")}
          </Button>
        )}
        {isPaused && (
          <Button size="sm" onClick={resume} disabled={resumeRequested} className="h-7 shrink-0 gap-1 text-xs">
            <IconPlayerPlay className="size-3" />
            {resumeRequested ? t("cortes.retomando") : t("cortes.retomar")}
          </Button>
        )}
        {video.status === "detected" && (
          <Button
            size="sm"
            variant="outline"
            onClick={processarAgora}
            disabled={enqueueing}
            className="h-7 shrink-0 gap-1 text-xs"
          >
            <IconPlayerPlay className="size-3" />
            {enqueueing ? t("cortes.enviando") : t("cortes.processarAgora")}
          </Button>
        )}
        <Button variant="ghost" size="icon-sm" onClick={remove} disabled={deleting} title={t("cortes.removerVideo")}>
          <IconTrash className="size-4" />
        </Button>
        </div>
      </div>

      {(video.status === "error" || video.status === "cancelled") && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
          {/* Sem mensagem tecnica aqui. O texto cru do erro nao ajuda quem usa
              o sistema (e assusta), e agora ele vive inteiro no painel de erros
              do admin - que e quem consegue fazer algo com ele. */}
          <p className="text-xs text-destructive">
            {video.status === "cancelled"
              ? "Processamento cancelado."
              : t("cortes.naoDeuProcessar")}
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

      {/* Vídeo exclusivo de membros do canal. Não é erro e não tem nada pra
          consertar: o canal decidiu assim. Explicar isso é o que impede o
          cliente de ficar tentando reprocessar um vídeo que não vai baixar. */}
      {video.status === "somente_membros" && (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-2">
          <SeloDeMembros />
          <p className="text-xs text-muted-foreground">{t("cortes.somenteMembrosTexto")}</p>
        </div>
      )}

      {/* Explicação de vídeo parado esperando o computador do cliente. Some
          inteira quando o admin desliga a exibição do túnel — o pedido foi que
          NADA sobre a internet do cliente aparecesse, e este texto é sobre
          exatamente isso.
          Esconder não deixa ninguém no escuro: o estado só existe pra quem
          escolheu "baixar só pela minha internet" na tela da conexão, que é a
          primeira coisa a sumir. O selo de status do vídeo continua aparecendo
          na linha acima, então ele nunca fica invisível. */}
      {video.status === "aguardando_conexao" && mostrarTunel && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
          <p className="text-xs text-muted-foreground">
            Você escolheu baixar só pela sua internet. Este vídeo começa assim que o seu computador
            estiver ligado e conectado.
          </p>
          <Button variant="outline" size="sm" asChild className="h-7 shrink-0 gap-1 text-xs">
            <a href="/client/tunnel">{t("cortes.verMinhaConexao")}</a>
          </Button>
        </div>
      )}

      {video.status === "aguardando_creditos" && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-4 py-2">
          {/* Duas saídas diferentes: sem crédito é comprar/esperar a semana
              virar; cartão recusado é trocar o cartão. Uma mensagem só mandaria
              metade das pessoas pro lugar errado. */}
          <p className="text-xs text-destructive">
            {video.billingBlockReason === "cobranca_falhou"
              ? t("cortes.naoConsegiCobrar")
              : t("cortes.semCredito")}
          </p>
          <Button variant="outline" size="sm" asChild className="h-7 shrink-0 gap-1 text-xs">
            <a href="/client/billing">
              {video.billingBlockReason === "cobranca_falhou" ? t("cortes.atualizarCartao") : t("cortes.verPlanosECredito")}
            </a>
          </Button>
        </div>
      )}

      {open && (
        <CardContent className="border-t border-border pt-4">
          {!clips ? (
            <Skeleton className="h-16" />
          ) : clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("cortes.nenhumCorteGerado")}</p>
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
  const t = useT()
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
      const created = await api.post<{ id: number; title: string; message?: string }>("/api/client/source-videos/manual", {
        url,
        tiktokAccountIds: selectedAccounts,
      })
      setUrl("")
      setSelectedAccounts([])
      setSuccess(created.message || `"${created.title}" entrou na fila. Acompanhe o progresso na lista abaixo.`)
      onAdded()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cortes.naoFoiPossivelCortar"))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLink className="size-4 text-muted-foreground" />{t("cortes.cortarPorLink")}</CardTitle>
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
              <FieldLabel htmlFor="videoUrl">{t("cortes.linkDoVideo")}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="videoUrl"
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  required
                />
                <Button type="submit" disabled={submitting}>
                  {submitting ? t("cortes.cortando") : t("cortes.cortar")}
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
  const t = useT()
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
    // Upload usa XHR direto (pra ter barra de progresso) em vez do lib/api,
    // então precisa mandar o token anti-CSRF na mão.
    xhr.setRequestHeader("X-CSRF-Token", csrfToken())
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
        setSuccess(`"${data.title}" enviado, entrou na fila de corte.`)
        onAdded()
      } else {
        try {
          setError(JSON.parse(xhr.responseText).error || t("cortes.naoFoiPossivelEnviarVideo"))
        } catch {
          setError(t("cortes.naoFoiPossivelEnviarVideo"))
        }
      }
    }
    xhr.onerror = () => {
      setUploading(false)
      setError(t("cortes.falhaConexaoEnviar"))
    }
    xhr.send(formData)
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconUpload className="size-4 text-muted-foreground" />{t("cortes.enviarDoComputador")}</CardTitle>
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
              <FieldLabel htmlFor="videoFile">{t("cortes.arquivoDeVideo")}</FieldLabel>
              <Input
                id="videoFile"
                type="file"
                accept="video/*"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="videoTitle">{t("cortes.tituloOpcional")}</FieldLabel>
              <div className="flex gap-2">
                <Input
                  id="videoTitle"
                  placeholder={t("cortes.exemploTitulo")}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                />
                <Button type="submit" disabled={!file || uploading}>
                  {uploading ? `Enviando... ${progress}%` : t("cortes.enviarECortar")}
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

const PENDING_STATUSES = ["detected", "paused", "aguardando_creditos", "aguardando_conexao", "somente_membros", ...ACTIVE_STATUSES]
const STAGE_PRIORITY: Record<string, number> = {
  paused: -1,
  cutting: 0,
  selecting_clips: 1,
  transcribing: 2,
  downloading: 3,
  detected: 4,
  aguardando_creditos: 5,
  aguardando_conexao: 5,
  somente_membros: 5,
}

export function VideosClipsPage() {
  const t = useT()
  const { user, loading: authLoading, logout, mostrarTunel } = useAuth()
  const [videos, setVideos] = useState<SourceVideo[] | null>(null)
  const [channels, setChannels] = useState<YoutubeChannel[]>([])
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccountSummary[]>([])
  const [avgProcessingSeconds, setAvgProcessingSeconds] = useState(480)
  // Um painel so pra toda a configuracao de corte. Eram dois ("qualidade" e
  // "estilo visual") ate 23/08/2026, e os dois gravavam a MESMA linha do
  // banco - separar as decisoes obrigava a abrir os dois pra montar uma
  // configuracao unica.
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
    <DashboardLayout user={user} onLogout={logout} title={t("cortes.titulo")}>
      <PageHeader
        title={t("cortes.titulo")}
        description={t("cortes.descricao")}
      />
      <AddManualVideoCard onAdded={load} tiktokAccounts={tiktokAccounts} />

      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="sm" onClick={() => setShowUpload((v) => !v)} className="gap-2">
          <IconUpload className="size-4" />
          {showUpload ? t("cortes.ocultarEnvioArquivo") : t("cortes.enviarVideoPorArquivo")}
        </Button>
        <Button variant="outline" size="sm" onClick={() => setShowStyleEditor((v) => !v)} className="gap-2" data-tour="abrir-config-cortes">
          <IconAdjustmentsHorizontal className="size-4" />
          {showStyleEditor ? t("cortes.ocultarConfigCorte") : t("cortes.configurarCortes")}
        </Button>
      </div>
      {showUpload && <UploadVideoCard onAdded={load} tiktokAccounts={tiktokAccounts} />}
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
              ? t("comum.excluindo")
              : confirmingBulkDelete
                ? `Confirmar exclusão de ${selectedIds.size}?`
                : t("cortes.excluirSelecionados")}
          </Button>
        </div>
      )}

      {channelIdFilter && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">{t("cortes.mostrandoSoVideosDe")}<span className="font-medium text-foreground">{filteredChannelName ?? t("cortes.canalSelecionado")}</span>
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
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t("cortes.vazio")}</div>
      ) : (
        <Tabs defaultValue="in-progress">
          <TabsList>
            <TabsTrigger value="in-progress">{t("cortes.emAndamento", { n: inProgress.length })}</TabsTrigger>
            <TabsTrigger value="finished">{t("cortes.prontos", { n: finished.length })}</TabsTrigger>
          </TabsList>
          <TabsContent value="in-progress" className="flex flex-col gap-3">
            {inProgress.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t("cortes.nenhumEmAndamento")}</div>
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
                  mostrarTunel={mostrarTunel}
                />
              ))
            )}
          </TabsContent>
          <TabsContent value="finished" className="flex flex-col gap-3">
            {finished.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">{t("cortes.nenhumPronto")}</div>
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
                  mostrarTunel={mostrarTunel}
                />
              ))
            )}
          </TabsContent>
        </Tabs>
      )}
    </DashboardLayout>
  )
}
