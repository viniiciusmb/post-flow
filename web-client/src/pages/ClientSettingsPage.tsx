import { useEffect, useState, type FormEvent } from "react"
import { IconBrandGoogleDrive } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { DriveStatusResponse } from "@/types/api"

function DriveSection() {
  const [status, setStatus] = useState<DriveStatusResponse | null>(null)
  const [folderLink, setFolderLink] = useState("")
  const [exportFolderLink, setExportFolderLink] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [savingExport, setSavingExport] = useState(false)

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

  async function handleExportSubmit(event: FormEvent) {
    event.preventDefault()
    setExportError(null)
    setSavingExport(true)
    try {
      await api.post("/api/client/drive/export-folder", { folderLink: exportFolderLink })
      setExportFolderLink("")
      await load()
    } catch (err) {
      setExportError(err instanceof ApiError ? err.message : "Não foi possível salvar a pasta.")
    } finally {
      setSavingExport(false)
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

            <div className="border-t border-border pt-4">
              <p className="mb-3 text-sm font-medium">Pasta de destino dos cortes prontos (opcional)</p>
              <p className="mb-3 text-xs text-muted-foreground">
                Cópia de segurança: cada corte pronto é enviado automaticamente pra essa pasta, separada da pasta de
                origem acima.
              </p>

              {status.exportFolder && (
                <p className="mb-3 text-sm text-muted-foreground">
                  Pasta atual:{" "}
                  <span className="font-medium text-foreground">
                    {status.exportFolder.name ?? status.exportFolder.id}
                  </span>
                </p>
              )}

              <form onSubmit={handleExportSubmit}>
                <FieldGroup>
                  {exportError && (
                    <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                      {exportError}
                    </p>
                  )}
                  <Field>
                    <FieldLabel htmlFor="exportFolderLink">
                      {status.exportFolder ? "Trocar pasta de destino" : "Link ou ID da pasta de destino"}
                    </FieldLabel>
                    <div className="flex gap-2">
                      <Input
                        id="exportFolderLink"
                        placeholder="https://drive.google.com/drive/folders/..."
                        value={exportFolderLink}
                        onChange={(e) => setExportFolderLink(e.target.value)}
                        required
                      />
                      <Button type="submit" disabled={savingExport}>
                        {savingExport ? "Salvando..." : "Salvar"}
                      </Button>
                    </div>
                  </Field>
                </FieldGroup>
              </form>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ClientSettingsPage() {
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Configurações">
      <p className="-mt-2 text-sm text-muted-foreground">
        As configurações de qualidade e estilo dos cortes agora ficam em "Vídeos & Cortes".
      </p>
      <DriveSection />
    </DashboardLayout>
  )
}
