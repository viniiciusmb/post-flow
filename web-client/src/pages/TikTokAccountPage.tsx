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
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
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
import type { ErrorPostingItem, PostedItem, PostingQueueItem, PostingScheduleResponse, TikTokAccountSummary } from "@/types/api"

const RETENTION_LABELS: Record<number, string> = {
  24: "1 dia",
  72: "3 dias",
  168: "7 dias",
  720: "30 dias",
}

function formatCount(n: number | null | undefined) {
  if (n === null || n === undefined) return "—"
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}mil`
  return String(n)
}

// Botao de emergencia: se algo der errado e os cortes comecarem a sair um
// atras do outro (ou qualquer outro bug), pausa só o disparo de NOVOS posts
// dessa conta — o que já estava em processamento não é afetado. Fica bem
// visível de propósito, separado das outras configurações de agendamento.
function PauseQueueBar({ accountId }: { accountId: number }) {
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
      .catch((err) => setError(err instanceof ApiError ? err.message : "Não foi possível carregar."))
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
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar. Tente de novo.")
    } finally {
      setSaving(false)
    }
  }

  // Sem popup nativo (dava problema em alguns navegadores/apps): primeiro
  // clique em "Pausar fila" só arma a confirmação (o botão muda de texto e
  // cor por alguns segundos), segundo clique dentro da janela pausa de
  // verdade. Retomar não precisa dessa confirmação — é reversível na hora.
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
          <p className="font-medium">{paused ? "Fila de postagem pausada" : "Fila de postagem ativa"}</p>
          <p className="text-xs text-muted-foreground">
            {paused
              ? "Nenhum corte novo sai pro TikTok até você retomar a postagem automática."
              : "Use isso se algo der errado e os cortes começarem a sair rápido demais ou fora do esperado."}
          </p>
          {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
        </div>
      </div>
      {paused ? (
        <Button size="sm" variant="default" onClick={() => setPausedOnServer(false)} disabled={saving} className="shrink-0">
          {saving ? "Retomando..." : "Retomar postagem automática"}
        </Button>
      ) : (
        <Button
          size="sm"
          variant={confirming ? "destructive" : "outline"}
          onClick={handlePauseClick}
          disabled={saving}
          className="shrink-0"
        >
          {saving ? "Pausando..." : confirming ? "Confirmar pausa da fila?" : "Pausar fila"}
        </Button>
      )}
    </div>
  )
}

function ScheduleCard({ accountId }: { accountId: number }) {
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
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar.")
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
        <CardTitle className="text-base">Agendamento de postagem</CardTitle>
        <CardDescription>
          O TikTok do Post Flow ainda está em modo de testes (sandbox) — cada corte é enviado como{" "}
          <strong>rascunho pra caixa de entrada do seu TikTok</strong>, e você ainda precisa abrir o app e confirmar a
          publicação por lá. O agendamento abaixo controla só quando o rascunho chega na sua caixa de entrada, pra não
          chegar tudo de uma vez.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        )}

        <Field>
          <FieldLabel>Como escolher os horários</FieldLabel>
          <ToggleGroup
            type="single"
            variant="outline"
            value={settings.mode}
            onValueChange={(next) => next && save({ ...settings, mode: next as "auto" | "manual" })}
          >
            <ToggleGroupItem value="auto" className="text-xs">
              Automático
            </ToggleGroupItem>
            <ToggleGroupItem value="manual" className="text-xs">
              Eu escolho os horários
            </ToggleGroupItem>
          </ToggleGroup>
        </Field>

        <Field>
          <FieldLabel htmlFor={`videosPerDay-${accountId}`}>Quantos por dia</FieldLabel>
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
            <FieldLabel>Horários (formato 24h)</FieldLabel>
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
                <IconPlus /> Adicionar horário
              </Button>
            </div>
          </Field>
        )}

        <Field>
          <FieldLabel>Excluir automaticamente depois de postado</FieldLabel>
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
              Nunca
            </ToggleGroupItem>
            {settings.options.retentionPresetsHours.map((h) => (
              <ToggleGroupItem key={h} value={String(h)} className="text-xs">
                {RETENTION_LABELS[h] ?? `${h}h`}
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
            <p className="mb-1 text-xs font-medium text-muted-foreground">Legenda que vai no TikTok</p>
            <p className="whitespace-pre-wrap text-sm">{item.caption || "Sem legenda."}</p>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}

function QueueRow({
  item,
  draft,
  onDraftChange,
  onSaveCaption,
  confirmingSkip,
  skipping,
  onSkipClick,
  postingNow,
  onPostNow,
  onView,
}: {
  item: PostingQueueItem
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id })
  const downloadUrl = `/api/client/source-videos/clips/${item.clipId}/download`

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
        title="Arraste pra reordenar a fila"
      >
        <IconGripVertical className="size-4" />
      </button>
      <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{item.clipTitle}</p>
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
        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button size="xs" variant="outline" onClick={onPostNow} disabled={postingNow} className="gap-1">
            <IconSend className="size-3" />
            {postingNow ? "Postando..." : "Postar agora"}
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

function QueueCard({ accountId }: { accountId: number }) {
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
      setSkipError(err instanceof ApiError ? err.message : "Não foi possível remover esse corte da fila.")
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
      setPostNowError(err instanceof ApiError ? err.message : "Não foi possível postar agora.")
    } finally {
      setPostingNowId(null)
    }
  }

  // Recalcula os horários de toda a fila do zero, preenchendo os buracos
  // deixados por cortes pulados/com erro — nunca acontece sozinho, só
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
      setFixError(err instanceof ApiError ? err.message : "Não foi possível corrigir os horários. Tente de novo.")
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
      setOrderError(err instanceof ApiError ? err.message : "Não foi possível salvar a nova ordem.")
      await load()
    } finally {
      setReordering(false)
    }
  }

  if (!items) return <Skeleton className="h-32" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fila de prontos aguardando postar</CardTitle>
        <CardDescription>
          Revise ou edite a legenda antes de sair — arraste pelo ícone à esquerda pra mudar a ordem em que saem.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum corte esperando na fila agora.</p>
        ) : (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
              <div className="flex flex-col gap-3">
                {items.map((item) => (
                  <QueueRow
                    key={item.id}
                    item={item}
                    draft={drafts[item.id] ?? ""}
                    onDraftChange={(value) => setDrafts({ ...drafts, [item.id]: value })}
                    onSaveCaption={() => saveCaption(item.id)}
                    confirmingSkip={confirmingSkipId === item.id}
                    skipping={skippingId === item.id}
                    onSkipClick={() => handleSkipClick(item.id)}
                    postingNow={postingNowId === item.id}
                    onPostNow={() => postNow(item.id)}
                    onView={() => setViewingItem(item)}
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
            {fixing ? "Corrigindo..." : "Corrigir horários de posts"}
          </Button>
          {fixedFlash && <span className="text-xs text-muted-foreground">{fixedFlash}</span>}
          {fixError && <span className="text-xs text-destructive">{fixError}</span>}
        </div>
      </CardContent>
      {viewingItem && <ViewClipSheet item={viewingItem} onClose={() => setViewingItem(null)} />}
    </Card>
  )
}

function ErrorCard({ accountId }: { accountId: number }) {
  const [items, setItems] = useState<ErrorPostingItem[] | null>(null)

  useEffect(() => {
    setItems(null)
    api.get<{ postings: ErrorPostingItem[] }>(`/api/client/postings/errors?accountId=${accountId}`).then((data) => setItems(data.postings))
  }, [accountId])

  if (!items) return <Skeleton className="h-32" />
  if (items.length === 0) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          Nenhum corte com erro de postagem.
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Deram erro ao postar</CardTitle>
        <CardDescription>A TikTok recusou publicar esses cortes — não são reenviados sozinhos.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-2">
          {items.map((item) => (
            <div key={item.id} className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5">
              <div className="h-14 w-10 shrink-0 overflow-hidden rounded-md bg-muted">
                {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm">{item.clipTitle}</p>
                  <TonePill tone="danger">Erro</TonePill>
                </div>
                {item.errorMessage && <p className="mt-0.5 text-xs text-muted-foreground">{item.errorMessage}</p>}
              </div>
              <span className="shrink-0 text-xs text-muted-foreground">
                {new Date(item.updatedAt).toLocaleDateString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function PostedCard({ accountId }: { accountId: number }) {
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
        <CardTitle className="text-base">Já postados</CardTitle>
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
                {new Date(item.postedAt).toLocaleDateString("pt-BR")}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function AccountCard({ account, onChanged }: { account: TikTokAccountSummary; onChanged: () => void }) {
  const [savingAutoPost, setSavingAutoPost] = useState(false)
  const [autoPostEnabled, setAutoPostEnabled] = useState(account.autoPostEnabled)
  const [deactivating, setDeactivating] = useState(false)
  const hasStats = account.followerCount !== null && account.followerCount !== undefined

  async function toggleAutoPost(checked: boolean) {
    setSavingAutoPost(true)
    setAutoPostEnabled(checked)
    try {
      await api.put<{ autoPostEnabled: boolean }>(`/api/client/tiktok-accounts/${account.id}/auto-post`, { enabled: checked })
    } finally {
      setSavingAutoPost(false)
    }
  }

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
    <div className="flex flex-col gap-4">
      <Card>
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
                  <TonePill tone="success">Conectada</TonePill>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Conectada em {new Date(account.connectedAt).toLocaleDateString("pt-BR")}.
                </p>
              </div>
            </div>
            <Button variant="ghost" size="sm" onClick={disconnect} disabled={deactivating} className="gap-1.5 text-destructive hover:text-destructive">
              <IconTrash className="size-4" />
              {deactivating ? "Desconectando..." : "Desconectar"}
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
                <span className="text-muted-foreground">vídeos no perfil</span>
              </span>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="flex items-start gap-3 py-5">
          <Checkbox
            id={`autoPost-${account.id}`}
            checked={autoPostEnabled}
            onCheckedChange={(checked) => toggleAutoPost(checked === true)}
            disabled={savingAutoPost}
            className="mt-0.5"
          />
          <label htmlFor={`autoPost-${account.id}`} className="cursor-pointer">
            <span className="text-sm font-medium">Postar automaticamente</span>
            <p className="mt-0.5 text-xs text-muted-foreground">
              Desligado por padrão — os cortes ficam prontos em "Vídeos & Cortes" mas só entram na fila de postagem
              depois que você ligar isso aqui.
            </p>
          </label>
        </CardContent>
      </Card>

      {autoPostEnabled && (
        <>
          <PauseQueueBar accountId={account.id} />
          <ScheduleCard accountId={account.id} />
          <Tabs defaultValue="queue">
            <TabsList>
              <TabsTrigger value="queue">Fila</TabsTrigger>
              <TabsTrigger value="posted">Postados</TabsTrigger>
              <TabsTrigger value="errors">Erro</TabsTrigger>
            </TabsList>
            <TabsContent value="queue">
              <QueueCard accountId={account.id} />
            </TabsContent>
            <TabsContent value="posted">
              <PostedCard accountId={account.id} />
            </TabsContent>
            <TabsContent value="errors">
              <ErrorCard accountId={account.id} />
            </TabsContent>
          </Tabs>
        </>
      )}
    </div>
  )
}

export function TikTokAccountPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [accounts, setAccounts] = useState<TikTokAccountSummary[] | null>(null)

  async function load() {
    const data = await api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts")
    setAccounts(data.accounts)
  }

  useEffect(() => {
    if (user) load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Contas TikTok">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          Cada conta conectada aqui pode ser vinculada a canais do YouTube diferentes, com seu próprio agendamento.
        </p>
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
        <div className="flex flex-col gap-6">
          {accounts.map((account) => (
            <AccountCard key={account.id} account={account} onChanged={load} />
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
