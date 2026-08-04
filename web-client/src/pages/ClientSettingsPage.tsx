import { useT } from "@/i18n"
import { dataHora } from "@/lib/formatoLocal"
import { useEffect, useState, type FormEvent } from "react"
import { IconBrandGoogleDrive, IconUserCircle, IconLock } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Field, FieldGroup, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { ClientProfileResponse, DriveStatusResponse, TikTokAccountSummary } from "@/types/api"

function ProfileSection() {
  const t = useT()
  const [profile, setProfile] = useState<ClientProfileResponse | null>(null)
  const [businessName, setBusinessName] = useState("")
  const [email, setEmail] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    api.get<ClientProfileResponse>("/api/client/profile").then((data) => {
      setProfile(data)
      setBusinessName(data.businessName ?? "")
      setEmail(data.email)
    })
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    setSaving(true)
    try {
      const updated = await api.put<ClientProfileResponse>("/api/client/profile", { businessName, email })
      setProfile(updated)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("pub.naoFoiPossivelSalvar"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconUserCircle className="size-4 text-muted-foreground" />
          Perfil
        </CardTitle>
        <CardDescription>{t("config.perfilDescricao")}</CardDescription>
      </CardHeader>
      <CardContent>
        {!profile ? (
          <Skeleton className="h-24" />
        ) : (
          <form onSubmit={handleSubmit}>
            <FieldGroup>
              {error && (
                <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
                </p>
              )}
              <Field>
                <FieldLabel htmlFor="businessName">Nome / empresa</FieldLabel>
                <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? "Salvando..." : "Salvar"}
                </Button>
                {saved && <span className="text-xs text-status-posted">Salvo ✓</span>}
              </div>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  )
}

function PasswordSection() {
  const t = useT()
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaved(false)
    if (newPassword !== confirmPassword) {
      setError(t("config.confirmacaoNaoBate"))
      return
    }
    setSaving(true)
    try {
      await api.put("/api/client/password", { currentPassword, newPassword })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("config.naoFoiPossivelTrocarSenha"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLock className="size-4 text-muted-foreground" />
          Trocar senha
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
            <Field>
              <FieldLabel htmlFor="currentPassword">Senha atual</FieldLabel>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">Nova senha</FieldLabel>
              <Input
                id="newPassword"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
              />
              <FieldDescription>Pelo menos 8 caracteres.</FieldDescription>
            </Field>
            <Field>
              <FieldLabel htmlFor="confirmPassword">Confirmar nova senha</FieldLabel>
              <Input
                id="confirmPassword"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </Field>
            <div className="flex items-center gap-3">
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? "Salvando..." : "Trocar senha"}
              </Button>
              {saved && <span className="text-xs text-status-posted">Senha trocada ✓</span>}
            </div>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}

function DriveSection() {
  const t = useT()
  const [status, setStatus] = useState<DriveStatusResponse | null>(null)
  const [tiktokAccounts, setTiktokAccounts] = useState<TikTokAccountSummary[]>([])
  const [folderLink, setFolderLink] = useState("")
  const [selectedAccounts, setSelectedAccounts] = useState<number[]>([])
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  async function load() {
    const [driveData, tiktokData] = await Promise.all([
      api.get<DriveStatusResponse>("/api/client/drive"),
      api.get<{ accounts: TikTokAccountSummary[] }>("/api/client/tiktok-accounts"),
    ])
    setStatus(driveData)
    setTiktokAccounts(tiktokData.accounts)
    setSelectedAccounts(driveData.folder?.tiktokAccountIds ?? [])
  }

  useEffect(() => {
    load()
  }, [])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setError(null)
    setSaving(true)
    try {
      await api.post("/api/client/drive/folder", { folderLink, tiktokAccountIds: selectedAccounts })
      setFolderLink("")
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("cortes.naoFoiPossivelSalvarPasta"))
    } finally {
      setSaving(false)
    }
  }

  function toggleAccount(id: number) {
    setSelectedAccounts((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconBrandGoogleDrive className="size-4 text-muted-foreground" />{t("config.minhaPasta")}</CardTitle>
        <CardDescription>
          Opcional: conecte seu próprio Google Drive e aponte uma pasta com vídeos, eles são postados
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
                <a href="/auth/google/connect">{t("config.trocarDeConta")}</a>
              </Button>
            </div>

            {status.folder && (
              <p className="text-sm text-muted-foreground">
                Pasta atual: <span className="font-medium text-foreground">{status.folder.name ?? status.folder.id}</span>
                {status.folder.lastPolledAt &&
                  `. Última checagem em ${dataHora(status.folder.lastPolledAt)}`}
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
                    {status.folder ? "Trocar pasta" : t("config.linkOuIdPastaCompartilhada")}
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
                  <FieldDescription>{t("config.pastaChecada")}</FieldDescription>
                </Field>
                {tiktokAccounts.length > 1 && (
                  <Field>
                    <FieldLabel>{t("config.postarDessaPasta")}</FieldLabel>
                    <div className="flex flex-wrap gap-3">
                      {tiktokAccounts.map((a) => (
                        <label key={a.id} className="flex items-center gap-1.5 text-xs">
                          <Checkbox checked={selectedAccounts.includes(a.id)} onCheckedChange={() => toggleAccount(a.id)} />
                          {a.displayName}
                        </label>
                      ))}
                    </div>
                  </Field>
                )}
              </FieldGroup>
            </form>
          </>
        )}
      </CardContent>
    </Card>
  )
}

export function ClientSettingsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("config.titulo")}>
      <PageHeader
        title={t("config.titulo")}
        description={t("config.descricao")}
      />
      <ProfileSection />
      <PasswordSection />
      <DriveSection />
    </DashboardLayout>
  )
}
