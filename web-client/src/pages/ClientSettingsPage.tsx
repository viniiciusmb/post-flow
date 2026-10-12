import { useT } from "@/i18n"
import { useEffect, useState, type FormEvent } from "react"
import {
  IconAlertTriangle,
  IconBrandGoogleDrive,
  IconChevronRight,
  IconDeviceDesktop,
  IconLanguage,
  IconLock,
  IconMoon,
  IconPlugConnected,
  IconSun,
  IconTrash,
  IconUserCircle,
} from "@tabler/icons-react"
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
import { useTheme } from "@/components/theme-provider"
import { IDIOMAS, useI18n } from "@/i18n"
import { cn } from "@/lib/utils"
import { data as dataCurta } from "@/lib/formatoLocal"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
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
          {t("config.perfil")}
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
                <FieldLabel htmlFor="businessName">{t("config.nomeEmpresa")}</FieldLabel>
                <Input id="businessName" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
              </Field>
              <Field>
                <FieldLabel htmlFor="email">{t("auth.email")}</FieldLabel>
                <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
              </Field>
              <div className="flex items-center gap-3">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? t("comum.salvando") : t("comum.salvar")}
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
          {t("config.trocarSenha")}
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
              <FieldLabel htmlFor="currentPassword">{t("config.senhaAtual")}</FieldLabel>
              <Input
                id="currentPassword"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="newPassword">{t("config.novaSenha")}</FieldLabel>
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
              <FieldLabel htmlFor="confirmPassword">{t("config.confirmarNovaSenha")}</FieldLabel>
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
                {saving ? t("comum.salvando") : t("config.trocarSenha")}
              </Button>
              {saved && <span className="text-xs text-status-posted">{t("config.senhaTrocada")}</span>}
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
        <CardDescription>{t("config.driveOpcional")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {!status ? (
          <Skeleton className="h-10" />
        ) : !status.connected ? (
          <Button asChild size="sm" className="w-fit">
            <a href="/auth/google/connect">{t("config.conectarDrive")}</a>
          </Button>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm">
              <TonePill tone="success">{t("comum.conectado")}</TonePill>
              <span className="text-muted-foreground">{status.googleAccountEmail}</span>
              <Button asChild variant="ghost" size="sm" className="ml-auto">
                <a href="/auth/google/connect">{t("config.trocarDeConta")}</a>
              </Button>
            </div>

            {/* PASTA DE ORIGEM — desligada em 01/09/2026.

                Ela vigiava uma pasta do Drive do cliente esperando vídeo novo,
                e para isso precisava do escopo `drive.readonly`. Esse escopo foi
                removido em 02/08/2026 porque é RESTRITO e obriga auditoria de
                segurança paga todo ano — e a produção mostrava zero clientes
                usando o recurso.

                O que ninguém percebeu é que a tela continuou oferecendo o campo.
                Quem cadastrasse uma pasta aqui via "última checagem" atualizando
                a cada 5 minutos e nunca um vídeo — porque com `drive.file` a
                listagem responde 200 com a lista VAZIA: não dá erro, só não
                enxerga nada. Uma promessa silenciosa.

                Escondido em vez de apagado: o código todo continua aqui, e volta
                a valer no dia em que existir o seletor do Google (que dá acesso
                à pasta escolhida sem escopo restrito). Enquanto isso, oferecer
                seria mentir.

                A pasta de DESTINO (enviar cortes prontos) não é afetada — ela
                usa `drive.file` e agora funciona de verdade, com a pasta criada
                por nós. */}
            <p className="text-sm text-muted-foreground">{t("config.driveSoDestino")}</p>

            <form onSubmit={handleSubmit} hidden>
              <FieldGroup>
                {error && (
                  <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {error}
                  </p>
                )}
                <Field>
                  <FieldLabel htmlFor="folderLink">
                    {status.folder ? t("config.trocarPasta") : t("config.linkOuIdPastaCompartilhada")}
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
                      {saving ? t("comum.salvando") : t("comum.salvar")}
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
  const { user, loading: authLoading, logout, painelNovo } = useAuth()

  if (authLoading || !user) return null

  // Tela nova (12/10/2026): só pra quem testa o painel novo.
  if (painelNovo) {
    return (
      <DashboardLayout user={user} onLogout={logout} title="Configurações">
        <ConfiguracoesNovas ehAdmin={user.role === "admin"} />
      </DashboardLayout>
    )
  }

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

// ---------------------------------------------------------------------------
// Configurações do painel novo (12/10/2026). Mesmas seções de sempre (perfil,
// senha, Drive) num layout com índice ao lado, mais Preferências e a exclusão
// da própria conta.

const SECOES = [
  { id: "perfil", nome: "Perfil", Icone: IconUserCircle },
  { id: "seguranca", nome: "Segurança", Icone: IconLock },
  { id: "integracoes", nome: "Integrações", Icone: IconPlugConnected },
  { id: "preferencias", nome: "Preferências", Icone: IconLanguage },
  { id: "excluir", nome: "Excluir conta", Icone: IconTrash },
] as const

function ConfiguracoesNovas({ ehAdmin }: { ehAdmin: boolean }) {
  const [perfil, setPerfil] = useState<ClientProfileResponse | null>(null)
  useEffect(() => {
    api.get<ClientProfileResponse>("/api/client/profile").then(setPerfil).catch(() => {})
  }, [])
  const nome = perfil?.businessName || perfil?.email || ""

  return (
    <div className="flex min-w-0 flex-col gap-6">
      <header className="flex items-center gap-4">
        <span className="flex size-14 shrink-0 items-center justify-center rounded-2xl bg-foreground text-lg font-semibold text-background">
          {(nome || "?").slice(0, 2).toUpperCase()}
        </span>
        <div className="min-w-0">
          <h1 className="truncate font-heading text-[1.65rem] font-semibold leading-tight tracking-[-0.03em]">Configurações</h1>
          <p className="mt-0.5 truncate text-sm text-muted-foreground">
            {perfil ? (
              <>
                {perfil.email}
                {perfil.criadoEm ? ` · conta criada em ${dataCurta(perfil.criadoEm)}` : ""}
              </>
            ) : (
              "Carregando…"
            )}
          </p>
        </div>
        <Button asChild variant="outline" size="sm" className="ml-auto hidden gap-1 sm:inline-flex">
          <a href="/client/billing">
            Plano e uso
            <IconChevronRight className="size-3.5" />
          </a>
        </Button>
      </header>

      <div className="grid items-start gap-6 lg:grid-cols-[12rem_minmax(0,1fr)]">
        <nav aria-label="Seções" className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:sticky lg:top-4 lg:mx-0 lg:flex-col lg:px-0">
          {SECOES.filter((x) => !(ehAdmin && x.id === "excluir")).map(({ id, nome: rotulo, Icone }) => (
            <a
              key={id}
              href={`#${id}`}
              className={cn(
                "flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground",
                id === "excluir" && "lg:mt-3 hover:text-tone-danger-ink",
              )}
            >
              <Icone className="size-4" />
              {rotulo}
            </a>
          ))}
        </nav>

        <div className="flex min-w-0 flex-col gap-5">
          <section id="perfil" className="scroll-mt-4">
            <ProfileSection />
          </section>
          <section id="seguranca" className="scroll-mt-4">
            {perfil && perfil.temSenha === false ? (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <IconLock className="size-4 text-muted-foreground" />
                    Senha
                  </CardTitle>
                  <CardDescription>
                    Você entra com a sua conta do Google, então não há senha do Post Flow pra trocar. Pra mudar o acesso, use as configurações da sua
                    conta Google.
                  </CardDescription>
                </CardHeader>
              </Card>
            ) : (
              <PasswordSection />
            )}
          </section>
          <section id="integracoes" className="flex scroll-mt-4 flex-col gap-3">
            <DriveSection />
            <Card className="gap-0 divide-y divide-border py-0">
              {[
                { href: "/client/social", titulo: "Redes sociais", texto: "TikTok, Instagram, Facebook, YouTube e outras: contas, filas e horários." },
                { href: "/client/youtube", titulo: "Canais do YouTube", texto: "Canais monitorados, estilo do corte e em quais contas cada canal publica." },
              ].map((l) => (
                <a key={l.href} href={l.href} className="flex items-center gap-3 px-5 py-4 transition-colors hover:bg-muted/40">
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-medium">{l.titulo}</span>
                    <span className="block text-xs text-muted-foreground">{l.texto}</span>
                  </span>
                  <IconChevronRight className="size-4 text-muted-foreground" />
                </a>
              ))}
            </Card>
          </section>
          <section id="preferencias" className="scroll-mt-4">
            <Preferencias />
          </section>
          {!ehAdmin && (
            <section id="excluir" className="scroll-mt-4">
              <ExcluirConta pedeSenhaPadrao={perfil?.temSenha !== false} />
            </section>
          )}
        </div>
      </div>
    </div>
  )
}

function Preferencias() {
  const { theme, setTheme } = useTheme()
  const { idioma, setIdioma } = useI18n()
  const temas = [
    { v: "light", nome: "Claro", Icone: IconSun },
    { v: "dark", nome: "Escuro", Icone: IconMoon },
    { v: "system", nome: "Igual ao aparelho", Icone: IconDeviceDesktop },
  ] as const
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconLanguage className="size-4 text-muted-foreground" />
          Preferências
        </CardTitle>
        <CardDescription>Valem só neste navegador.</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Aparência</span>
          <div role="radiogroup" aria-label="Aparência" className="grid gap-2 sm:grid-cols-3">
            {temas.map(({ v, nome, Icone }) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={theme === v}
                onClick={() => setTheme(v)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  theme === v ? "border-foreground bg-muted/50 font-medium" : "border-border hover:bg-muted/40",
                )}
              >
                <Icone className="size-4" />
                {nome}
              </button>
            ))}
          </div>
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Idioma do painel</span>
          <div role="radiogroup" aria-label="Idioma" className="grid gap-2 sm:grid-cols-3">
            {IDIOMAS.map((op) => (
              <button
                key={op.code}
                type="button"
                role="radio"
                aria-checked={idioma === op.code}
                onClick={() => setIdioma(op.code)}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
                  idioma === op.code ? "border-foreground bg-muted/50 font-medium" : "border-border hover:bg-muted/40",
                )}
              >
                <span aria-hidden>{op.flag}</span>
                {op.label}
              </button>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

type ResumoDaExclusao = {
  canais: number
  videos: number
  contasConectadas: number
  saldoComissaoCentavos: number
  temCobrancaRecorrente: boolean
  pedeSenha: boolean
}

function ExcluirConta({ pedeSenhaPadrao }: { pedeSenhaPadrao: boolean }) {
  const [aberto, setAberto] = useState(false)
  const [resumo, setResumo] = useState<ResumoDaExclusao | null>(null)
  const [confirmacao, setConfirmacao] = useState("")
  const [senha, setSenha] = useState("")
  const [erro, setErro] = useState<string | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  useEffect(() => {
    if (!aberto) return
    setErro(null)
    setConfirmacao("")
    setSenha("")
    api
      .get<ResumoDaExclusao>("/api/client/conta/exclusao")
      .then(setResumo)
      .catch((err) => setErro(err instanceof ApiError ? err.message : "Não foi possível carregar os dados da conta."))
  }, [aberto])

  const pedeSenha = resumo ? resumo.pedeSenha : pedeSenhaPadrao
  const pronto = confirmacao.trim().toUpperCase() === "EXCLUIR" && (!pedeSenha || senha.length > 0)

  async function excluir() {
    setExcluindo(true)
    setErro(null)
    try {
      await api.delete("/api/client/conta", { confirmacao, senha })
      window.location.href = "/?conta=excluida"
    } catch (err) {
      setErro(err instanceof ApiError ? err.message : "Não foi possível excluir a conta.")
      setExcluindo(false)
    }
  }

  return (
    <Card className="border-tone-danger-ink/30">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base text-tone-danger-ink">
          <IconTrash className="size-4" />
          Excluir conta
        </CardTitle>
        <CardDescription>
          Apaga seus canais, vídeos, cortes, filas e as contas conectadas, e cancela a sua assinatura. Não dá pra desfazer. Os registros de pagamento
          ficam guardados sem o seu nome, como a lei exige.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="outline" className="border-tone-danger-ink/40 text-tone-danger-ink hover:bg-tone-danger-wash hover:text-tone-danger-ink" onClick={() => setAberto(true)}>
          Excluir minha conta
        </Button>
      </CardContent>

      <Dialog open={aberto} onOpenChange={(a) => !excluindo && setAberto(a)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Excluir a conta de vez?</DialogTitle>
            <DialogDescription>Isto apaga tudo o que está abaixo e não tem volta.</DialogDescription>
          </DialogHeader>
          {!resumo && !erro ? (
            <Skeleton className="h-24" />
          ) : resumo ? (
            <ul className="flex flex-col gap-1.5 rounded-lg bg-muted/50 px-4 py-3 text-sm">
              <li>
                {resumo.canais} {resumo.canais === 1 ? "canal" : "canais"} do YouTube e {resumo.videos} {resumo.videos === 1 ? "vídeo" : "vídeos"} com os cortes
              </li>
              <li>
                {resumo.contasConectadas} {resumo.contasConectadas === 1 ? "conta conectada" : "contas conectadas"} (TikTok e outras redes), com as filas
              </li>
              {resumo.temCobrancaRecorrente && <li>A sua assinatura é cancelada agora, sem cobranças futuras</li>}
              {resumo.saldoComissaoCentavos > 0 && (
                <li className="flex gap-1.5 text-tone-danger-ink">
                  <IconAlertTriangle className="mt-0.5 size-4 shrink-0" />
                  Você tem R$ {(resumo.saldoComissaoCentavos / 100).toFixed(2).replace(".", ",")} de comissão pra sacar. Peça o saque antes, senão esse
                  saldo é perdido.
                </li>
              )}
            </ul>
          ) : null}
          <div className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              <span>
                Digite <strong>EXCLUIR</strong> pra confirmar
              </span>
              <Input value={confirmacao} onChange={(e) => setConfirmacao(e.target.value)} autoComplete="off" />
            </label>
            {pedeSenha && (
              <label className="flex flex-col gap-1.5 text-sm">
                Sua senha
                <Input type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="current-password" />
              </label>
            )}
          </div>
          {erro && <p className="rounded-md bg-tone-danger-wash px-3 py-2 text-sm text-tone-danger-ink">{erro}</p>}
          <DialogFooter>
            <Button variant="outline" disabled={excluindo} onClick={() => setAberto(false)}>
              Manter minha conta
            </Button>
            <Button variant="destructive" disabled={!pronto || excluindo} onClick={excluir}>
              {excluindo ? "Excluindo..." : "Excluir de vez"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  )
}
