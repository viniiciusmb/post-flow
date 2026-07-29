import { useEffect, useState, type FormEvent } from "react"
import { IconBrandGoogleDrive, IconVideo } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { ClientVideoSettingsResponse, DriveStatusResponse } from "@/types/api"

const ASPECT_LABELS: Record<string, string> = {
  "9:16": "9:16 (TikTok/Reels)",
  "1:1": "1:1 (quadrado)",
  "16:9": "16:9 (horizontal)",
  "4:5": "4:5 (retrato)",
}
const FRAMING_LABELS: Record<string, string> = {
  crop: "Cortar as bordas (preenche a tela)",
  blur_pad: "Mostrar o vídeo inteiro (fundo desfocado)",
}
const QUALITY_LABELS: Record<string, string> = {
  high: "Alta (mais nítido, arquivo maior)",
  medium: "Média (mais rápido de gerar)",
}
const CAPTION_LABELS: Record<string, string> = {
  classic: "Clássica",
  bold: "Chamativa (amarela, maior)",
  minimal: "Minimalista",
  none: "Sem legenda",
}
const CLIP_LENGTH_LABELS: Record<string, string> = {
  short: "Curtos (15–40s)",
  balanced: "Equilibrados (25–90s)",
  long: "Longos (60–180s)",
}

function DriveSection() {
  const [status, setStatus] = useState<DriveStatusResponse | null>(null)
  const [folderLink, setFolderLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const data = await api.get<DriveStatusResponse>("/api/client/drive")
    setStatus(data)
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.post("/api/client/drive/folder", { folderLink })
      setFolderLink("")
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível salvar a pasta.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconBrandGoogleDrive className="size-4 text-muted-foreground" />
          Minha pasta do Google Drive
        </CardTitle>
        <CardDescription>
          Opcional: conecte seu próprio Google Drive e aponte uma pasta com vídeos — eles são postados
          automaticamente no seu TikTok, sem precisar de canal do YouTube.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!status ? (
          <Skeleton className="h-10" />
        ) : !status.connected ? (
          <Button asChild size="sm" className="w-fit">
            <a href="/auth/google/connect">Conectar Google Drive</a>
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <TonePill tone="success">Conectado</TonePill>
              <span className="text-muted-foreground">{status.googleAccountEmail}</span>
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <a href="/auth/google/connect">Trocar de conta</a>
              </Button>
            </div>

            {status.folder && (
              <p className="text-sm text-muted-foreground">
                Pasta atual: <span className="font-medium text-foreground">{status.folder.name ?? status.folder.id}</span>
                {status.folder.lastPolledAt &&
                  ` — última checagem em ${new Date(status.folder.lastPolledAt).toLocaleString("pt-BR")}`}
              </p>
            )}

            <form onSubmit={handleSubmit}>
              <FieldGroup>
                {error && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Field>
                  <FieldLabel htmlFor="folderLink">
                    {status.folder ? "Trocar pasta" : "Link ou ID da pasta compartilhada"}
                  </FieldLabel>
                  <div className="flex gap-2">
                    <Input
                      id="folderLink"
                      placeholder="https://drive.google.com/drive/folders/..."
                      value={folderLink}
                      onChange={(e) => setFolderLink(e.target.value)}
                      required
                    />
                    <Button type="submit" disabled={saving}>
                      {saving ? "Salvando..." : "Salvar"}
                    </Button>
                  </div>
                  <FieldDescription>
                    A pasta é checada periodicamente — vídeos novos entram na fila de postagem automaticamente.
                  </FieldDescription>
                </Field>
              </FieldGroup>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}

function OptionRow({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string
  value: string
  options: string[]
  labels: Record<string, string>
  onChange: (value: string) => void
}) {
  return (
    <Field>
      <FieldLabel>{label}</FieldLabel>
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(next) => next && onChange(next)}
        className="flex-wrap"
      >
        {options.map((o) => (
          <ToggleGroupItem key={o} value={o} className="text-xs">
            {labels[o] ?? o}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </Field>
  )
}

function VideoSettingsSection() {
  const [settings, setSettings] = useState<ClientVideoSettingsResponse | null>(null)
  const [saving, setSaving] = useState(false)
  const [savedFlash, setSavedFlash] = useState(false)

  useEffect(() => {
    api.get<ClientVideoSettingsResponse>("/api/client/video-settings").then(setSettings)
  }, [])

  async function save(next: ClientVideoSettingsResponse) {
    setSettings(next)
    setSaving(true)
    setSavedFlash(false)
    try {
      await api.put<ClientVideoSettingsResponse>("/api/client/video-settings", next)
      setSavedFlash(true)
      setTimeout(() => setSavedFlash(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <Skeleton className="h-96" />

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconVideo className="size-4 text-muted-foreground" />
          Qualidade e estilo dos cortes
        </CardTitle>
        <CardDescription>
          Como cada corte gerado automaticamente é editado. 9:16 é o padrão recomendado pro TikTok.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldGroup>
          <OptionRow
            label="Proporção"
            value={settings.aspectRatio}
            options={settings.options.aspectRatios}
            labels={ASPECT_LABELS}
            onChange={(v) => save({ ...settings, aspectRatio: v as never })}
          />
          <OptionRow
            label="Enquadramento"
            value={settings.framing}
            options={settings.options.framings}
            labels={FRAMING_LABELS}
            onChange={(v) => save({ ...settings, framing: v as never })}
          />
          <OptionRow
            label="Qualidade"
            value={settings.quality}
            options={settings.options.qualities}
            labels={QUALITY_LABELS}
            onChange={(v) => save({ ...settings, quality: v as never })}
          />
          <OptionRow
            label="Estilo da legenda"
            value={settings.captionStyle}
            options={settings.options.captionStyles}
            labels={CAPTION_LABELS}
            onChange={(v) => save({ ...settings, captionStyle: v as never })}
          />
          <OptionRow
            label="Duração dos cortes"
            value={settings.clipLength}
            options={settings.options.clipLengths}
            labels={CLIP_LENGTH_LABELS}
            onChange={(v) => save({ ...settings, clipLength: v as never })}
          />
          <Field>
            <FieldLabel htmlFor="maxClips">Cortes por vídeo (1 a 8)</FieldLabel>
            <Input
              id="maxClips"
              type="number"
              min={1}
              max={8}
              className="w-24"
              value={settings.maxClips}
              onChange={(e) => save({ ...settings, maxClips: Number(e.target.value) })}
            />
          </Field>
          <p className="text-xs text-muted-foreground">
            {saving ? "Salvando..." : savedFlash ? "Salvo ✓" : "Mudanças valem pros próximos vídeos processados."}
          </p>
        </FieldGroup>
      </CardContent>
    </Card>
  )
}

export function ClientSettingsPage() {
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Configurações">
      <DriveSection />
      <VideoSettingsSection />
    </DashboardLayout>
  )
}
