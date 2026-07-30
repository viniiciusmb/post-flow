import { useEffect, useState } from "react"
import { IconBrandTiktok, IconHeart, IconUsers, IconMovie, IconTrash, IconPlus } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { PostedItem, PostingQueueItem, PostingScheduleResponse, TikTokAccountSummary } from "@/types/api"

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

function ScheduleCard({ accountId }: { accountId: number }) {
  const [settings, setSettings] = useState<PostingScheduleResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setSettings(null)
    api.get<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/schedule`).then(setSettings)
  }, [accountId])

  async function save(next: PostingScheduleResponse) {
    setSettings(next)
    setSaving(true)
    setError(null)
    setSavedFlash(false)
    try {
      const updated = await api.put<PostingScheduleResponse>(`/api/client/tiktok-accounts/${accountId}/schedule`, next)
      setSettings(updated)
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

  function updateManualTime(index: number, value: string) {
    if (!settings) return
    const next = [...settings.manualTimes]
    next[index] = value
    save({ ...settings, manualTimes: next })
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
            value={settings.videosPerDay}
            onChange={(e) => save({ ...settings, videosPerDay: Number(e.target.value) })}
          />
        </Field>

        {settings.mode === "manual" && (
          <Field>
            <FieldLabel>Horários (formato 24h)</FieldLabel>
            <div className="flex flex-col gap-2">
              {settings.manualTimes.map((time, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Input
                    type="time"
                    className="w-32"
                    value={time}
                    onChange={(e) => updateManualTime(i, e.target.value)}
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

function QueueCard({ accountId }: { accountId: number }) {
  const [items, setItems] = useState<PostingQueueItem[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})

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

  async function skip(id: number) {
    if (!confirm("Não postar este corte? Ele sai da fila de espera.")) return
    await api.post(`/api/client/postings/${id}/skip`, {})
    await load()
  }

  if (!items) return <Skeleton className="h-32" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Fila de prontos aguardando postar</CardTitle>
        <CardDescription>Revise ou edite a legenda antes de sair — a ordem é por ordem de chegada.</CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhum corte esperando na fila agora.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {items.map((item) => (
              <div key={item.id} className="flex flex-col gap-2 rounded-lg border border-border p-3 sm:flex-row sm:items-center">
                <div className="h-20 w-14 shrink-0 overflow-hidden rounded-md bg-muted">
                  {item.thumbnailUrl && (
                    <img src={item.thumbnailUrl} alt="" className="h-full w-full object-cover" />
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{item.clipTitle}</p>
                  <div className="mt-1 flex gap-2">
                    <Input
                      value={drafts[item.id] ?? ""}
                      onChange={(e) => setDrafts({ ...drafts, [item.id]: e.target.value })}
                      placeholder="Legenda desse corte..."
                      className="text-xs"
                    />
                    <Button size="sm" variant="outline" onClick={() => saveCaption(item.id)}>
                      Salvar
                    </Button>
                  </div>
                </div>
                <Button size="sm" variant="ghost" onClick={() => skip(item.id)} className="shrink-0">
                  Não postar
                </Button>
              </div>
            ))}
          </div>
        )}
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
  if (items.length === 0) return null

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
          <ScheduleCard accountId={account.id} />
          <QueueCard accountId={account.id} />
          <PostedCard accountId={account.id} />
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
