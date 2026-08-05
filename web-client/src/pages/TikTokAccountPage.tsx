import { data } from "@/lib/formatoLocal"
import { useEffect, useState } from "react"
import {
  IconBrandTiktok,
  IconHeart,
  IconUsers,
  IconMovie,
  IconTrash,
  IconPlus,
  IconClock,
  IconAlertTriangle,
  IconGripVertical,
  IconSend,
  IconDownload,
  IconEye,
  IconRefresh,
  IconSettings,
} from "@tabler/icons-react"
import {
  DndContext,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core"
import { SortableContext, useSortable, arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import {
  DirectPostOptions,
  PublishDefaultsForm,
  nomeDaPrivacidade,
} from "@/components/dashboard/DirectPostOptions"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Skeleton } from "@/components/ui/skeleton"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { useT, type ChaveDeTraducao } from "@/i18n"
import type {
  ErrorPostingItem,
  PostedItem,
  PostingQueueItem,
  PostingScheduleResponse,
  PublishDefaults,
  TikTokAccountSummary,
  YoutubeChannel,
} from "@/types/api"

// Rótulo em dias. Era um mapa fixo com o texto em português; virou função
// porque "1 dia"/"1 day"/"1 día" mudam com o idioma, e o mapa é montado uma vez
// no carregamento do módulo, antes de existir idioma escolhido.
function rotuloRetencao(horas: number, t: (c: ChaveDeTraducao, v?: Record<string, string | number>) => string) {
  const dias = horas / 24
  return dias === 1 ? t("pub.umDia") : t("pub.nDias", { n: dias })
}

function formatCount(n: number | null | undefined) {
  if (n === null || n === undefined) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}mil`
  return String(n)
}

// Botao de emergencia: se algo der errado e os cortes comecarem a sair um
// atras do outro (ou qualquer outro bug), pausa só o disparo de NOVOS posts
// dessa conta. O que já estava em processamento não é afetado. Fica bem
// visível de propósito, separado das outras configurações de agendamento.
function PauseQueueBar({ accountId }: { accountId: number }) {
  const t = useT()
  const [paused, setPaused] = useState<boolean | null>(null)
  const [saving, setSaving] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setPaused(null)
    setError(null)
    api
      .get<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/schedule`)
      .then((data) => setPaused(data.paused))
      .catch((err) => setError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelCarregar")))
  }, [accountId])

  async function setPausedOnServer(next: boolean) {
    setSaving(true)
    setError(null)
    try {
      const updated = await api.put<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/queue-pause`, {
        paused: next,
      })
      setPaused(updated.paused)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelSalvarTenteDeNovo"))
    } finally {
      setSaving(false)
    }
  }

  // Sem popup nativo (dava problema em alguns navegadores/apps): primeiro
  // clique em t("pub.pausarFila") só arma a confirmação (o botão muda de texto e
  // cor por alguns segundos), segundo clique dentro da janela pausa de
  // verdade. Retomar não precisa dessa confirmação. É reversível na hora.
  function handlePauseClick() {
    if (!confirming) {
      setConfirming(true)
      setTimeout(() => setConfirming(false), 4000)
      return
    }
    setConfirming(false)
    setPausedOnServer(true)
  }

  if (paused === null && !error) return <Skeleton className="h-16" />

  return (
    <div
      className={`flex flex-col items-start gap-3 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between ${
        paused ? "border-destructive/40 bg-destructive/10" : "border-border"
      }`}
    >
      <div className="flex items-start gap-2 text-sm">
        {paused && <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" />}
        <div>
          <p className="font-medium">{paused ? t("pub.filaPausada") : t("pub.filaAtiva")}</p>
          <p className="text-xs text-muted-foreground">
            {paused
              ? t("pub.nenhumCorteNovoSai")
              : t("pub.useIssoSeAlgoDerErrado")}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </div>
      {paused ? (
        <Button size="sm" variant="default" onClick={() => setPausedOnServer(false)} disabled={saving} className="shrink-0">
          {saving ? "Retomando..." : t("pub.retomarPostagem")}
        </Button>
      ) : (
        <Button
          size="sm"
          variant={confirming ? "destructive" : "outline"}
          onClick={handlePauseClick}
          disabled={saving}
          className="shrink-0"
        >
          {saving ? "Pausando..." : confirming ? t("pub.confirmarPausa") : t("pub.pausarFila")}
        </Button>
      )}
    </div>
  )
}

/**
 * Opções de publicação da conta: escolhidas UMA vez, valem pra todos os cortes.
 *
 * Esta é a peça que mantém o sistema automático. A TikTok exige que o criador
 * tenha escolhido privacidade, interações e divulgação comercial - não exige
 * que ele reescolha a cada vídeo. Enquanto não escolher, nada é publicado
 * direto: é isso que o cartão deixa explícito.
 */
function PublishDefaultsCard({
  accountId,
  onChange,
}: {
  accountId: number
  onChange: (d: PublishDefaults) => void
}) {
  const t = useT()
  const [defaults, setDefaults] = useState<PublishDefaults | null>(null)
  const [editando, setEditando] = useState(false)

  useEffect(() => {
    setDefaults(null)
    setEditando(false)
    api.get<PublishDefaults>(`/api/client/tiktok-accounts/${accountId}/publish-defaults`).then((d) => {
      setDefaults(d)
      onChange(d)
      // Sem padrão nenhum, o formulário já abre: é a única coisa que separa a
      // conta de começar a publicar.
      setEditando(!d.definido)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  if (!defaults) return <Skeleton className="h-40" />

  const permitidos = [
    !defaults.disableComment && t("pub.comentar"),
    !defaults.disableDuet && t("pub.dueto"),
    !defaults.disableStitch && t("pub.juncao"),
  ].filter(Boolean) as string[]

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pub.opcoesTitulo")}</CardTitle>
        <CardDescription>{t("pub.opcoesDescricao")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {/* Aparece mesmo com o formulário aberto: é o que explica por que ele
            abriu sozinho e por que a fila está parada. */}
        {!defaults.definido && (
          <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-500">{t("pub.nenhumPublicadoAte")}</p>
        )}

        {defaults.definido && !editando && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
            <span>
              <span className="text-muted-foreground">{t("pub.quemPodeVer")}</span>
              <strong>{nomeDaPrivacidade(defaults.privacyLevel, t)}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">{t("pub.pessoasPodem")}</span>
              <strong>{permitidos.length ? permitidos.join(", ") : t("pub.nada")}</strong>
            </span>
            <span>
              <span className="text-muted-foreground">{t("pub.divulgacaoComercial")}</span>
              <strong>
                {defaults.brandContentToggle
                  ? t("pub.parceriaPaga")
                  : defaults.brandOrganicToggle
                    ? t("pub.suaMarca")
                    : "não"}
              </strong>
            </span>
          </div>
        )}

        {editando ? (
          <PublishDefaultsForm
            accountId={accountId}
            defaults={defaults}
            onSaved={(novo) => {
              setDefaults(novo)
              onChange(novo)
              setEditando(false)
            }}
          />
        ) : (
          <div>
            <Button size="sm" variant="outline" onClick={() => setEditando(true)} className="gap-1.5">
              <IconSettings className="size-3.5" />
              {defaults.definido ? t("pub.alterarOpcoes") : t("pub.definirOpcoes")}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ScheduleCard({ accountId, publishMode }: { accountId: number; publishMode: "inbox" | "direct" }) {
  const t = useT()
  const [settings, setSettings] = useState<PostingScheduleResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Rascunho local pros campos de digitação livre (horários, quantos por
  // dia) - atualiza a tela a cada tecla, mas só salva no servidor quando o
  // campo perde o foco. Sem isso, cada tecla/ajuste do seletor de hora
  // disparava um save() próprio; requisições concorrentes podiam terminar
  // fora de ordem e a mais lenta "vencia" com um valor antigo, dando a
  // impressão de que o horário escolhido não tinha sido salvo.
  const [manualTimesDraft, setManualTimesDraft] = useState<string[]>([])
  const [videosPerDayDraft, setVideosPerDayDraft] = useState(1)

  useEffect(() => {
    setSettings(null)
    api.get<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/schedule`).then((data) => {
      setSettings(data)
      setManualTimesDraft(data.manualTimes)
      setVideosPerDayDraft(data.videosPerDay)
    })
  }, [accountId])

  async function save(next: PostingScheduleResponse) {
    setSettings(next)
    setManualTimesDraft(next.manualTimes)
    setVideosPerDayDraft(next.videosPerDay)
    setSaving(true)
    setError(null)
    setSavedFlash(false)
    try {
      const updated = await api.put<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/schedule`, next)
      setSettings(updated)
      setManualTimesDraft(updated.manualTimes)
      setVideosPerDayDraft(updated.videosPerDay)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelSalvar"))
    } finally {
      setSaving(false)
    }
  }

  function addManualTime() {
    if (!settings) return
    save({ ...settings, manualTimes: [...settings.manualTimes, "12:00"].sort() })
  }

  function removeManualTime(index: number) {
    if (!settings) return
    save({ ...settings, manualTimes: settings.manualTimes.filter((_, i) => i !== index) })
  }

  if (!settings) return <Skeleton className="h-64" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pub.agendamentoTitulo")}</CardTitle>
        {/* O texto acompanha o modo escolhido logo acima. Deixar a explicação
            de rascunho fixa aqui contradizia a opção t("pub.diretoNoPerfilMinusculo") na
            mesma tela. */}
        <CardDescription>
          {publishMode === "direct" ? (
            <>
              {t("pub.agendaDiretoA")} <strong>{t("pub.agendaDiretoForte")}</strong>
              {t("pub.agendaDiretoB")}
            </>
          ) : (
            <>
              {t("pub.agendaRascunhoA")} <strong>{t("pub.agendaRascunhoForte")}</strong>
              {t("pub.agendaRascunhoB")}
            </>
          )}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Field>
          <FieldLabel>{t("pub.comoEscolherHorarios")}</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.mode}
            onValueChange={(next) => next && save({ ...settings, mode: next as "auto" | "manual" })}
          >
            <ToggleGroupItem value="auto" className="text-xs">{t("pub.automatico")}</ToggleGroupItem>
            <ToggleGroupItem value="manual" className="text-xs">{t("pub.euEscolho")}</ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field>
          <FieldLabel htmlFor={`videosPerDay-${accountId}`}>{t("pub.quantosPorDia")}</FieldLabel>
          <Input
            id={`videosPerDay-${accountId}`}
            type="number"
            min={1}
            max={20}
            className="w-24"
            value={videosPerDayDraft}
            onChange={(e) => setVideosPerDayDraft(Number(e.target.value))}
            onBlur={() => {
              if (videosPerDayDraft !== settings.videosPerDay) save({ ...settings, videosPerDay: videosPerDayDraft })
            }}
          />
        </Field>

        {settings.mode === "manual" && (
          <Field>
            <FieldLabel>{t("pub.horarios24h")}</FieldLabel>
            <div className="flex flex-col gap-2">
              {manualTimesDraft.map((time, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="time"
                    className="w-32"
                    value={time}
                    onChange={(e) => {
                      const next = [...manualTimesDraft]
                      next[i] = e.target.value
                      setManualTimesDraft(next)
                    }}
                    onBlur={() => {
                      if (manualTimesDraft[i] && manualTimesDraft[i] !== settings.manualTimes[i]) {
                        save({ ...settings, manualTimes: manualTimesDraft })
                      }
                    }}
                  />
                  <Button variant="ghost" size="icon-sm" onClick={() => removeManualTime(i)}>
                    <IconTrash />
                  </Button>
                </div>
              ))}
              <Button variant="outline" size="sm" className="w-fit" onClick={addManualTime}>
                <IconPlus />{t("pub.adicionarHorario")}</Button>
            </div>
          </Field>
        )}

        <Field>
          <FieldLabel>{t("pub.excluirDepoisPostado")}</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={String(settings.autoDeleteAfterHours ?? "never")}
            onValueChange={(next) =>
              next && save({ ...settings, autoDeleteAfterHours: next === "never" ? null : Number(next) })
            }
            className="flex-wrap"
          >
            <ToggleGroupItem value="never" className="text-xs">
              {t("pub.nunca")}
            </ToggleGroupItem>
            {settings.options.retentionPresetsHours.map((h) => (
              <ToggleGroupItem key={h} value={String(h)} className="text-xs">
                {rotuloRetencao(h, t)}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Field>

        <p className="text-xs text-muted-foreground">{saving ? "Salvando..." : savedFlash ? "Salvo ✓" : ""}</p>
      </CardContent>
    </Card>
  )
}

function formatScheduledFor(iso: string | null) {
  if (!iso) return null
  const date = new Date(iso)
  const now = new Date()
  const isToday = date.toDateString() === now.toDateString()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = date.toDateString() === tomorrow.toDateString()
  const time = date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })
  if (isToday) return `Hoje às ${time}`
  if (isTomorrow) return `Amanhã às ${time}`
  return `${date.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" })} às ${time}`
}

// Painel lateral do botão "Ver": mostra o corte tocando de verdade e a
// legenda que vai sair junto no TikTok, embaixo do vídeo.
function ViewClipSheet({ item, onClose }: { item: PostingQueueItem; onClose: () => void }) {
  const t = useT()
  const videoUrl = `/api/client/source-videos/clips/${item.clipId}/download`
  return (
    <Sheet open onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle className="pr-8">{item.clipTitle}</SheetTitle>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          <video
            src={videoUrl}
            controls
            autoPlay
            className="aspect-[9/16] w-full rounded-md bg-black"
          />
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">{t("pub.legendaQueVai")}</p>
            <p className="whitespace-pre-wrap text-sm">{item.caption || t("pub.semLegenda")}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function QueueRow({
  item,
  accountName,
  draft,
  onDraftChange,
  onSaveCaption,
  confirmingSkip,
  skipping,
  onSkipClick,
  postingNow,
  onPostNow,
  onView,
  accountId,
  publishMode,
  padraoDefinido,
  onOptionsSaved,
}: {
  item: PostingQueueItem
  accountName: string
  accountId: number
  publishMode: "inbox" | "direct"
  /** O padrão da conta já foi escolhido? Sem ele nenhum corte sai. */
  padraoDefinido: boolean
  onOptionsSaved: () => void
  draft: string
  onDraftChange: (value: string) => void
  onSaveCaption: () => void
  confirmingSkip: boolean
  skipping: boolean
  onSkipClick: () => void
  postingNow: boolean
  onPostNow: () => void
  onView: () => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const [abrirOpcoes, setAbrirOpcoes] = useState(false)
  const downloadUrl = `/api/client/source-videos/clips/${item.clipId}/download`

  // Na publicação direta o corte segue o padrão da conta. Ele só fica parado se
  // NINGUÉM definiu esse padrão ainda - o que se resolve uma vez lá em cima, não
  // corte a corte.
  const semPadrao = publishMode === "direct" && !padraoDefinido

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      className={`flex flex-col gap-2 rounded-lg border border-border bg-background p-3 sm:flex-row sm:items-center ${isDragging ? "opacity-50" : ""}`}
    >
      <button
        type="button"
        {...attributes}
        {...listeners}
        className="hidden shrink-0 cursor-grab items-center justify-center self-stretch rounded-md text-muted-foreground hover:bg-accent active:cursor-grabbing sm:flex"
        title={t("pub.arrastarParaReordenar")}
      >
        <IconGripVertical className="size-4" />
      </button>
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.clipTitle}</p>
        <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
          {item.channelName ?? t("pub.videoAvulso")} <span className="mx-1">·</span>{t("pub.vaiPostarEm")}<strong className="font-medium">{accountName}</strong>
        </p>
        {item.scheduledFor && (
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-muted-foreground">
            <IconClock className="size-3" />
            Vai postar {formatScheduledFor(item.scheduledFor)}
          </p>
        )}
        <div className="mt-1 flex gap-2">
          <Input
            value={draft}
            onChange={(e) => onDraftChange(e.target.value)}
            placeholder="Legenda desse corte..."
            className="text-xs"
          />
          <Button size="sm" variant="outline" onClick={onSaveCaption}>
            Salvar
          </Button>
        </div>
        {publishMode === "direct" && (
          <div className="mt-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="xs"
                variant="ghost"
                onClick={() => setAbrirOpcoes((v) => !v)}
                className="gap-1 px-1.5 text-muted-foreground"
              >
                <IconSettings className="size-3" />
                {abrirOpcoes ? t("pub.fecharOpcoesDesteCorte") : t("pub.editarOpcoesDesteCorte")}
              </Button>
              {item.optionsCustom && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                  {t("pub.opcoesProprias")}
                  {nomeDaPrivacidade(item.privacyLevel, t) ? `: ${nomeDaPrivacidade(item.privacyLevel, t)}` : ""}
                </span>
              )}
            </div>
            {semPadrao && !abrirOpcoes && (
              <p className="mt-1 text-[11px] text-amber-600 dark:text-amber-500">{t("pub.nenhumCorteSaiEnquanto")}</p>
            )}
            {abrirOpcoes && (
              <div className="mt-2">
                <DirectPostOptions
                  item={item}
                  accountId={accountId}
                  onSaved={() => {
                    setAbrirOpcoes(false)
                    onOptionsSaved()
                  }}
                  onVoltarAoPadrao={() => {
                    setAbrirOpcoes(false)
                    onOptionsSaved()
                  }}
                />
              </div>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            size="xs"
            variant="outline"
            onClick={onPostNow}
            disabled={postingNow || semPadrao}
            title={semPadrao ? t("pub.definaOpcoesPrimeiro") : undefined}
            className="gap-1"
          >
            <IconSend className="size-3" />
            {postingNow ? t("pub.postando") : t("pub.postarAgora")}
          </Button>
          <Button size="xs" variant="outline" onClick={onView} className="gap-1">
            <IconEye className="size-3" />
            Ver
          </Button>
          <Button size="xs" variant="outline" className="gap-1" asChild>
            <a href={downloadUrl} download>
              <IconDownload className="size-3" />
              Baixar
            </a>
          </Button>
          <Button
            size="xs"
            variant={confirmingSkip ? "destructive" : "ghost"}
            onClick={onSkipClick}
            disabled={skipping}
            className="text-muted-foreground"
          >
            {skipping ? "Cancelando..." : confirmingSkip ? "Confirmar cancelamento?" : "Cancelar postagem"}
          </Button>
        </div>
      </div>
    </div>
  )
}

function QueueCard({
  accountId,
  accountName,
  publishMode,
  padraoDefinido,
}: {
  accountId: number
  accountName: string
  publishMode: "inbox" | "direct"
  padraoDefinido: boolean
}) {
  const t = useT()
  const [items, setItems] = useState<PostingQueueItem[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [fixing, setFixing] = useState(false)
  const [fixedFlash, setFixedFlash] = useState<string | null>(null)
  const [fixError, setFixError] = useState<string | null>(null)
  const [confirmingSkipId, setConfirmingSkipId] = useState<number | null>(null)
  const [skippingId, setSkippingId] = useState<number | null>(null)
  const [skipError, setSkipError] = useState<string | null>(null)
  const [postingNowId, setPostingNowId] = useState<number | null>(null)
  const [postNowError, setPostNowError] = useState<string | null>(null)
  const [viewingItem, setViewingItem] = useState<PostingQueueItem | null>(null)
  const [reordering, setReordering] = useState(false)
  const [orderError, setOrderError] = useState<string | null>(null)

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))

  async function load() {
    const data = await api.get<{ postings: PostingQueueItem[] }>(`/api/client/postings/queue?accountId=${accountId}`)
    setItems(data.postings)
    setDrafts(Object.fromEntries(data.postings.map((p) => [p.id, p.caption ?? ""])))
  }

  useEffect(() => {
    setItems(null)
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  async function saveCaption(id: number) {
    await api.put(`/api/client/postings/${id}/caption`, { caption: drafts[id] ?? "" })
    await load()
  }

  // Sem popup nativo (mesmo padrão já usado pra exclusão em lote de vídeos -
  // deu problema antes com confirm() nativo em alguns navegadores/apps):
  // primeiro clique só arma a confirmação, segundo clique dentro da janela
  // executa de verdade.
  function handleSkipClick(id: number) {
    if (confirmingSkipId !== id) {
      setConfirmingSkipId(id)
      setTimeout(() => setConfirmingSkipId((cur) => (cur === id ? null : cur)), 4000)
      return
    }
    setConfirmingSkipId(null)
    doSkip(id)
  }

  async function doSkip(id: number) {
    setSkippingId(id)
    setSkipError(null)
    try {
      await api.post(`/api/client/postings/${id}/skip`, {})
      await load()
    } catch (err) {
      setSkipError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelRemover"))
    } finally {
      setSkippingId(null)
    }
  }

  async function postNow(id: number) {
    setPostingNowId(id)
    setPostNowError(null)
    try {
      const result = await api.post<{ status: string; errorMessage: string | null }>(`/api/client/postings/${id}/post-now`, {})
      if (result.status === "error") {
        setPostNowError(result.errorMessage || "A TikTok recusou publicar esse corte.")
      }
      await load()
    } catch (err) {
      setPostNowError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelPostarAgora"))
    } finally {
      setPostingNowId(null)
    }
  }

  // Recalcula os horários de toda a fila do zero, preenchendo os buracos
  // deixados por cortes pulados/com erro. Nunca acontece sozinho, só
  // quando alguém clica aqui de propósito.
  async function fixSchedule() {
    setFixing(true)
    setFixedFlash(null)
    setFixError(null)
    try {
      const result = await api.post<{ updated: number }>(`/api/client/tiktok-accounts/${accountId}/fix-schedule`, {})
      setFixedFlash(`${result.updated} horário(s) recalculado(s).`)
      await load()
    } catch (err) {
      setFixError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelCorrigirHorarios"))
    } finally {
      setFixing(false)
    }
  }

  // Arrasta e solta: atualiza a ordem na tela na hora (otimista) e manda a
  // lista completa pro servidor, que recalcula os horários pra bater com a
  // nova ordem. Se falhar, recarrega do zero pra desfazer a mudança visual.
  async function handleDragEnd(event: DragEndEvent) {
    if (!items) return
    const { active, over } = event
    if (!over || active.id === over.id) return

    const oldIndex = items.findIndex((i) => i.id === active.id)
    const newIndex = items.findIndex((i) => i.id === over.id)
    if (oldIndex === -1 || newIndex === -1) return

    const reordered = arrayMove(items, oldIndex, newIndex)
    setItems(reordered)
    setReordering(true)
    setOrderError(null)
    try {
      await api.put(`/api/client/tiktok-accounts/${accountId}/queue-order`, { orderedIds: reordered.map((i) => i.id) })
      await load()
    } catch (err) {
      setOrderError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelSalvarOrdem"))
      await load()
    } finally {
      setReordering(false)
    }
  }

  if (!items) return <Skeleton className="h-32" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pub.filaTitulo")}</CardTitle>
        <CardDescription>{t("pub.filaDescricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("pub.filaVazia")}</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    accountName={accountName}
                    draft={drafts[item.id] ?? ""}
                    onDraftChange={(value) => setDrafts({ ...drafts, [item.id]: value })}
                    onSaveCaption={() => saveCaption(item.id)}
                    confirmingSkip={confirmingSkipId === item.id}
                    skipping={skippingId === item.id}
                    onSkipClick={() => handleSkipClick(item.id)}
                    postingNow={postingNowId === item.id}
                    onPostNow={() => postNow(item.id)}
                    onView={() => setViewingItem(item)}
                    accountId={accountId}
                    publishMode={publishMode}
                    padraoDefinido={padraoDefinido}
                    onOptionsSaved={load}
                  />
                ))}
              </div>
            </SortableContext>
          </DndContext>
        )}
        {reordering && <p className="mt-2 text-xs text-muted-foreground">Salvando nova ordem...</p>}
        {orderError && <p className="mt-2 text-xs text-destructive">{orderError}</p>}
        {skipError && <p className="mt-2 text-xs text-destructive">{skipError}</p>}
        {postNowError && <p className="mt-2 text-xs text-destructive">{postNowError}</p>}
        <div className="mt-4 flex items-center gap-2 border-t border-border pt-3">
          <Button size="xs" variant="ghost" className="text-muted-foreground" onClick={fixSchedule} disabled={fixing}>
            {fixing ? "Corrigindo..." : t("pub.corrigirHorarios")}
          </Button>
          {fixedFlash && <span className="text-xs text-muted-foreground">{fixedFlash}</span>}
          {fixError && <span className="text-xs text-destructive">{fixError}</span>}
        </div>
      </CardContent>
      {viewingItem && <ViewClipSheet item={viewingItem} onClose={() => setViewingItem(null)} />}
    </Card>
  )
}

function ErrorCard({ accountId, accountName }: { accountId: number; accountName: string }) {
  const t = useT()
  const [items, setItems] = useState<ErrorPostingItem[] | null>(null)
  // Canais monitorados do cliente (todos, nao so os que tem erro agora) -
  // sem isso, o filtro so mostrava como opcao o canal que ja tinha erro
  // (ex: sempre "Renato Cariani"), dando a impressao de que os outros
  // canais tinham sumido - na real eles so nao tinham nenhum erro ainda.
  const [allChannels, setAllChannels] = useState<YoutubeChannel[]>([])
  const [selectedChannel, setSelectedChannel] = useState<string>("all")
  const [retryingNowId, setRetryingNowId] = useState<number | null>(null)
  const [requeueingId, setRequeueingId] = useState<number | null>(null)
  const [itemError, setItemError] = useState<Record<number, string>>({})

  async function load() {
    const [data, channelsData] = await Promise.all([
      api.get<{ postings: ErrorPostingItem[] }>(`/api/client/postings/errors?accountId=${accountId}`),
      api.get<{ channels: YoutubeChannel[] }>("/api/client/youtube-channels"),
    ])
    setItems(data.postings)
    setAllChannels(channelsData.channels)
  }

  useEffect(() => {
    setItems(null)
    setSelectedChannel("all")
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accountId])

  // t("pub.enviarProFilaNovamente"): so volta pro status pendente.
  async function requeue(id: number) {
    setRequeueingId(id)
    setItemError((prev) => ({ ...prev, [id]: "" }))
    try {
      await api.post(`/api/client/postings/${id}/retry`, {})
      await load()
    } catch (err) {
      setItemError((prev) => ({ ...prev, [id]: err instanceof ApiError ? err.message : t("pub.naoFoiPossivelReenviar") }))
    } finally {
      setRequeueingId(null)
    }
  }

  // "Tentar postar agora": volta pro pendente e ja tenta publicar na
  // sequencia, sem esperar o proximo ciclo automatico.
  async function retryNow(id: number) {
    setRetryingNowId(id)
    setItemError((prev) => ({ ...prev, [id]: "" }))
    try {
      await api.post(`/api/client/postings/${id}/retry`, {})
      const result = await api.post<{ status: string; errorMessage: string | null }>(`/api/client/postings/${id}/post-now`, {})
      if (result.status === "error") {
        setItemError((prev) => ({ ...prev, [id]: result.errorMessage || t("pub.tiktokRecusouDeNovo") }))
      }
      await load()
    } catch (err) {
      setItemError((prev) => ({ ...prev, [id]: err instanceof ApiError ? err.message : t("pub.naoFoiPossivelTentarPostar") }))
    } finally {
      setRetryingNowId(null)
    }
  }

  if (!items) return <Skeleton className="h-32" />

  const channels = Array.from(
    new Map<string, string>([
      ...allChannels.map((c): [string, string] => [String(c.id), c.channelName ?? "Canal"]),
      ...items.map((i): [string, string] => [String(i.channelId ?? "none"), i.channelName ?? t("pub.videoAvulso")]),
    ]).entries()
  )

  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">{t("pub.semErro")}</CardContent>
      </Card>
    )
  }

  const filtered = selectedChannel === "all" ? items : items.filter((i) => String(i.channelId ?? "none") === selectedChannel)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pub.deramErro")}</CardTitle>
        <CardDescription>{t("pub.tiktokRecusou")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {channels.length > 1 && (
          <ToggleGroup
            type="single"
            variant="outline"
            value={selectedChannel}
            onValueChange={(next) => next && setSelectedChannel(next)}
            className="flex-wrap justify-start"
          >
            <ToggleGroupItem value="all" className="text-xs">
              Geral
            </ToggleGroupItem>
            {channels.map(([id, name]) => (
              <ToggleGroupItem key={id} value={id} className="text-xs">
                {name}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        )}
        <div className="flex flex-col gap-2">
          {filtered.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 sm:flex-row sm:items-start">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm">{item.clipTitle}</p>
                  <TonePill tone="danger">{t("pub.abaErro")}</TonePill>
                </div>
                <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                  {item.channelName ?? t("pub.videoAvulso")} <span className="mx-1">·</span> conta <strong className="font-medium">{accountName}</strong>
                </p>
                {/* Idem: o motivo tecnico fica no painel de erros do admin. */}
                <p className="mt-0.5 text-xs text-muted-foreground">{t("pub.naoDeuPublicar")}</p>
                {itemError[item.id] && <p className="mt-0.5 text-xs text-destructive">{itemError[item.id]}</p>}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => retryNow(item.id)}
                    disabled={retryingNowId === item.id || requeueingId === item.id}
                    className="gap-1"
                  >
                    <IconSend className="size-3" />
                    {retryingNowId === item.id ? "Tentando..." : "Tentar postar agora"}
                  </Button>
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => requeue(item.id)}
                    disabled={retryingNowId === item.id || requeueingId === item.id}
                    className="gap-1"
                  >
                    <IconRefresh className="size-3" />
                    {requeueingId === item.id ? "Enviando..." : t("pub.enviarProFilaNovamente")}
                  </Button>
                </div>
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {data(item.updatedAt)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PostedCard({ accountId }: { accountId: number }) {
  const t = useT()
  const [items, setItems] = useState<PostedItem[] | null>(null)

  useEffect(() => {
    setItems(null)
    api.get<{ postings: PostedItem[] }>(`/api/client/postings/posted?accountId=${accountId}`).then((data) => setItems(data.postings))
  }, [accountId])

  if (!items) return <Skeleton className="h-32" />
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhum corte postado ainda.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("pub.jaPostados")}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <p className="min-w-0 flex-1 truncate text-sm">{item.clipTitle}</p>
              <span className="shrink-0 text-xs text-muted-foreground">
                {data(item.postedAt)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

// Caixa fechada da conta - so informação e resumo, nada aberto/editável
// aqui. Clicar em t("pub.configurarPostagens") que seleciona ela e
// revela o painel de configuração embaixo da lista inteira.
function AccountBox({
  account,
  selected,
  onSelect,
  onChanged,
}: {
  account: TikTokAccountSummary
  selected: boolean
  onSelect: () => void
  onChanged: () => void
}) {
  const t = useT()
  const [deactivating, setDeactivating] = useState(false)
  const hasStats = account.followerCount !== null && account.followerCount !== undefined

  async function disconnect() {
    if (
      !confirm(
        `Desconectar "${account.displayName}"? Canais do YouTube vinculados a essa conta ficam sem conta até você escolher outra.`
      )
    )
      return
    setDeactivating(true)
    try {
      await api.post(`/api/client/tiktok-accounts/${account.id}/deactivate`, {})
      onChanged()
    } finally {
      setDeactivating(false)
    }
  }

  return (
    <Card className={selected ? "ring-2 ring-primary" : undefined}>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <Avatar className="size-11 bg-foreground text-background">
              {account.avatarUrl && <AvatarImage src={account.avatarUrl} alt="" />}
              <AvatarFallback className="bg-foreground text-background">
                <IconBrandTiktok className="size-5" />
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold">{account.displayName}</span>
                <TonePill tone="success">{t("pub.conectada")}</TonePill>
              </div>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Conectada em {data(account.connectedAt)}.
              </p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={disconnect} disabled={deactivating} className="gap-1.5 text-destructive hover:text-destructive">
            <IconTrash className="size-4" />
            {deactivating ? "Desconectando..." : t("pub.desconectar")}
          </Button>
        </div>

        {hasStats && (
          <div className="flex flex-wrap items-center gap-6 border-t border-border pt-4 text-sm">
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconUsers className="size-4 text-muted-foreground" />
              <span className="font-semibold">{formatCount(account.followerCount)}</span>
              <span className="text-muted-foreground">seguidores</span>
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconHeart className="size-4 text-muted-foreground" />
              <span className="font-semibold">{formatCount(account.likesCount)}</span>
              <span className="text-muted-foreground">curtidas</span>
            </span>
            <span className="flex items-center gap-1.5 tabular-nums">
              <IconMovie className="size-4 text-muted-foreground" />
              <span className="font-semibold">{formatCount(account.videoCount)}</span>
              <span className="text-muted-foreground">{t("pub.videosNoPerfil")}</span>
            </span>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
            <span>
              <strong className="font-semibold text-foreground">{account.pendingCount}</strong>{t("pub.naFila")}</span>
            <span>
              <strong className="font-semibold text-foreground">{account.postedCount}</strong> postados
            </span>
            <span className={account.errorCount > 0 ? "text-destructive" : undefined}>
              <strong className="font-semibold">{account.errorCount}</strong>{t("pub.comErro")}</span>
          </div>
          <Button size="sm" variant={selected ? "default" : "outline"} onClick={onSelect}>
            {selected ? t("pub.fecharConfiguracoes") : t("pub.configurarPostagens")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Painel de configuração da conta selecionada - fica FORA da lista de
// caixas, uma unica vez embaixo de tudo (nao dentro de cada card), pra
// deixar claro que so uma conta por vez esta sendo editada.
function AccountDetailPanel({ account, onChanged }: { account: TikTokAccountSummary; onChanged: () => void }) {
  const t = useT()
  const [savingAutoPost, setSavingAutoPost] = useState(false)
  const [autoPostEnabled, setAutoPostEnabled] = useState(account.autoPostEnabled)
  const [publishMode, setPublishMode] = useState(account.publishMode)
  // O cartão de opções gerais informa aqui em cima quando o padrão foi definido,
  // pra fila saber se pode ou não liberar o botão de postar.
  const [padraoDefinido, setPadraoDefinido] = useState(false)
  const [savingMode, setSavingMode] = useState(false)

  useEffect(() => {
    setAutoPostEnabled(account.autoPostEnabled)
    setPublishMode(account.publishMode)
  }, [account.id, account.autoPostEnabled, account.publishMode])

  async function trocarModo(mode: "inbox" | "direct") {
    setSavingMode(true)
    setPublishMode(mode)
    try {
      await api.put(`/api/client/tiktok-accounts/${account.id}/publish-mode`, { mode })
      onChanged()
    } finally {
      setSavingMode(false)
    }
  }

  async function toggleAutoPost(checked: boolean) {
    setSavingAutoPost(true)
    setAutoPostEnabled(checked)
    try {
      await api.put<{ autoPostEnabled: boolean }>(`/api/client/tiktok-accounts/${account.id}/auto-post`, { enabled: checked })
      onChanged()
    } finally {
      setSavingAutoPost(false)
    }
  }

  return (
    <Card className="border-primary/40">
      <CardHeader>
        <CardTitle className="text-base">Configurar postagens de {account.displayName}</CardTitle>
        <CardDescription>{t("pub.configValemSo")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-start gap-3 rounded-lg border border-border p-4">
          <Checkbox
            id={`autoPost-${account.id}`}
            checked={autoPostEnabled}
            onCheckedChange={(checked) => toggleAutoPost(checked === true)}
            disabled={savingAutoPost}
            className="mt-0.5"
          />
          <label htmlFor={`autoPost-${account.id}`} className="cursor-pointer">
            <span className="text-sm font-medium">{t("pub.postarAutomaticamente")}</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Desligado por padrão. Os cortes ficam prontos na tela Cortes mas só entram na fila de postagem
              depois que você ligar isso aqui.
            </p>
          </label>
        </div>

        {/* Rascunho x publicação direta. É decisão do dono da conta, não nossa:
            no rascunho o TikTok pergunta privacidade e interações dentro do
            aplicativo dele; na direta essas escolhas passam a ser feitas aqui,
            corte a corte, antes de qualquer coisa sair. */}
        <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
          <div>
            <p className="text-sm font-medium">{t("pub.comoOCorteChega")}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{t("pub.podeTrocarQuandoQuiser")}</p>
          </div>
          <div className="grid gap-2 sm:grid-cols-2">
            {(
              [
                {
                  valor: "inbox" as const,
                  titulo: t("pub.comoRascunho"),
                  texto:
                    t("pub.comoRascunhoTexto"),
                },
                {
                  valor: "direct" as const,
                  titulo: t("pub.diretoNoPerfil"),
                  texto:
                    t("pub.diretoNoPerfilTexto"),
                },
              ]
            ).map((op) => (
              <button
                key={op.valor}
                type="button"
                disabled={savingMode}
                onClick={() => trocarModo(op.valor)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  publishMode === op.valor
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-muted/60"
                }`}
              >
                <span className="text-sm font-medium">{op.titulo}</span>
                <span className="mt-0.5 block text-xs leading-relaxed text-muted-foreground">{op.texto}</span>
              </button>
            ))}
          </div>
        </div>

        {autoPostEnabled && (
          <>
            <PauseQueueBar accountId={account.id} />
            {publishMode === "direct" && (
              <PublishDefaultsCard
                accountId={account.id}
                onChange={(d) => setPadraoDefinido(d.definido)}
              />
            )}
            <ScheduleCard accountId={account.id} publishMode={publishMode} />
            <Tabs defaultValue="queue">
              <TabsList>
                <TabsTrigger value="queue">{t("pub.abaFila")}</TabsTrigger>
                <TabsTrigger value="posted">{t("pub.abaPostados")}</TabsTrigger>
                <TabsTrigger value="errors">{t("pub.abaErro")}</TabsTrigger>
              </TabsList>
              <TabsContent value="queue">
                <QueueCard
                  accountId={account.id}
                  accountName={account.displayName}
                  publishMode={publishMode}
                  padraoDefinido={padraoDefinido}
                />
              </TabsContent>
              <TabsContent value="posted">
                <PostedCard accountId={account.id} />
              </TabsContent>
              <TabsContent value="errors">
                <ErrorCard accountId={account.id} accountName={account.displayName} />
              </TabsContent>
            </Tabs>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function TikTokAccountPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [accounts, setAccounts] = useState<TikTokAccountSummary[] | null>(null)
  const [selectedAccountId, setSelectedAccountId] = useState<number | null>(null)

  async function load() {
    const data = await api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts")
    setAccounts(data.accounts)
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  // Se a conta selecionada for desconectada (ou de algum jeito sumir da
  // lista), fecha o painel em vez de deixar ele preso numa conta fantasma.
  useEffect(() => {
    if (accounts && selectedAccountId !== null && !accounts.some((a) => a.id === selectedAccountId)) {
      setSelectedAccountId(null)
    }
  }, [accounts, selectedAccountId])

  if (authLoading || !user) return null

  const selectedAccount = accounts?.find((a) => a.id === selectedAccountId) ?? null

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("pub.titulo")}>
      <PageHeader
        title={t("pub.titulo")}
        description={t("pub.descricao")}
      />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {accounts && accounts.length > 0 && (
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t("pub.avisoMesmaConta")}
            </p>
          )}
        </div>
        <Button asChild size="sm" className="shrink-0">
          <a href="/auth/tiktok/connect">
            <IconPlus className="size-4" />
            Conectar {accounts && accounts.length > 0 ? "outra conta" : "conta TikTok"}
          </a>
        </Button>
      </div>

      {!accounts ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-28" />
          <Skeleton className="h-28" />
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhuma conta TikTok conectada ainda.
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-4">
            {accounts.map((account) => (
              <AccountBox
                key={account.id}
                account={account}
                selected={selectedAccountId === account.id}
                onSelect={() => setSelectedAccountId((cur) => (cur === account.id ? null : account.id))}
                onChanged={load}
              />
            ))}
          </div>

          {selectedAccount && <AccountDetailPanel account={selectedAccount} onChanged={load} />}
        </>
      )}
    </DashboardLayout>
  )
}
