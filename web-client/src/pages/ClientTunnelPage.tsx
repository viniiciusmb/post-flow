import { dataHora } from "@/lib/formatoLocal"
import { useEffect, useRef, useState, type FormEvent } from "react"
import { IconRouter, IconCircleCheck, IconCircleX, IconRefresh, IconDownload, IconArrowLeft } from "@tabler/icons-react"
import { WindowsMark, AppleMark } from "@/components/os-marks"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { ClientTunnel, ClientTunnelResponse } from "@/types/api"
import { Rico } from "@/components/dashboard/Rico"
import { useT } from "@/i18n"

type Os = "windows" | "mac"

function StepCard({ number, title, children }: { number: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground">
        {number}
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">{title}</p>
        <div className="text-sm text-muted-foreground">{children}</div>
      </div>
    </div>
  )
}

function OsPicker({ onSelect }: { onSelect: (os: Os) => void }) {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("tunel.qualSistema")}</CardTitle>
        <CardDescription>{t("tunel.escolhaOpcao")}</CardDescription>
      </CardHeader>
      {/* w-32 nos dois: sem largura fixa, cada botão se ajusta ao próprio texto
          e "Windows" sai bem maior que "Mac" - dois quadrados de tamanhos
          diferentes lado a lado. */}
      <CardContent className="flex flex-wrap gap-3">
        <Button variant="outline" size="lg" className="h-auto w-32 flex-col gap-2 px-0 py-5" onClick={() => onSelect("windows")}>
          <WindowsMark className="size-6" />
          <span>Windows</span>
        </Button>
        <Button variant="outline" size="lg" className="h-auto w-32 flex-col gap-2 px-0 py-5" onClick={() => onSelect("mac")}>
          <AppleMark className="size-6" />
          <span>Mac</span>
        </Button>
      </CardContent>
    </Card>
  )
}

function BackToOsPicker({ onClick }: { onClick: () => void }) {
  const t = useT()
  return (
    <Button variant="ghost" size="sm" onClick={onClick} className="w-fit gap-1.5 text-muted-foreground">
      <IconArrowLeft className="size-3.5" />
      {t("tunel.trocarSistema")}
    </Button>
  )
}

function UninstallGuide({ os }: { os: Os }) {
  const t = useT()
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t("tunel.querDesinstalar")}</CardTitle>
        <CardDescription>{t("tunel.semProblema")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <StepCard number={1} title={t("tunel.des1Titulo")}>
          <Rico html={t("tunel.des1")} />
        </StepCard>
        <StepCard number={2} title={t("tunel.des2Titulo")}>
          <Rico html={os === "windows" ? t("tunel.des2Windows") : t("tunel.des2Mac")} />
        </StepCard>
        <StepCard number={3} title={t("tunel.des3Titulo")}>
          {t("tunel.des3")}
        </StepCard>
        <StepCard number={4} title={t("tunel.des4Titulo")}>
          <Rico html={os === "windows" ? t("tunel.des4Windows") : t("tunel.des4Mac")} />
        </StepCard>
      </CardContent>
    </Card>
  )
}

function PairingForm({ onPaired }: { onPaired: () => void }) {
  const t = useT()
  const [code, setCode] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    setSaving(true)
    setError(null)
    try {
      await api.post("/api/client/tunnel/pair", { pairingCode: code.trim() })
      setCode("")
      onPaired()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("tunel.naoConseguiConectar"))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field>
        <FieldLabel>{t("tunel.codigoPareamento")}</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder={t("tunel.exemploCodigo")}
            maxLength={6}
            required
            className="font-mono uppercase"
          />
          <Button type="submit" disabled={saving || code.trim().length === 0}>
            {saving ? t("tunel.conectando") : t("tunel.conectar")}
          </Button>
        </div>
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}

function ConnectedStatus({ tunnel, onChanged }: { tunnel: ClientTunnel; onChanged: () => void }) {
  const t = useT()
  const [testing, setTesting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [requireTunnel, setRequireTunnel] = useState(tunnel.requireClientTunnel)
  const [savingPolicy, setSavingPolicy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => () => { if (pollRef.current) clearInterval(pollRef.current) }, [])

  async function handleTest() {
    setTesting(true)
    const before = tunnel.lastTestResult?.testedAt ?? null
    await api.post("/api/client/tunnel/test", {})

    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      const res = await api.get<ClientTunnelResponse>("/api/client/tunnel")
      if ((res.tunnel?.lastTestResult && res.tunnel.lastTestResult.testedAt !== before) || attempts >= 15) {
        if (pollRef.current) clearInterval(pollRef.current)
        setTesting(false)
        onChanged()
      }
    }, 2000)
  }

  useEffect(() => {
    setRequireTunnel(tunnel.requireClientTunnel)
  }, [tunnel.requireClientTunnel])

  async function handlePolicy(valor: boolean) {
    setSavingPolicy(true)
    setRequireTunnel(valor)
    try {
      await api.put("/api/client/tunnel/require-tunnel", { requireClientTunnel: valor })
      onChanged()
    } finally {
      setSavingPolicy(false)
    }
  }

  async function handleDisconnect() {
    setDisconnecting(true)
    try {
      await api.delete("/api/client/tunnel")
      onChanged()
    } finally {
      setDisconnecting(false)
    }
  }

  const result = tunnel.lastTestResult

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconRouter className="size-4 text-muted-foreground" />
          {tunnel.label || t("tunel.seuPrograma")}
        </CardTitle>
        <CardDescription>{t("tunel.testeReal")}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center gap-2">
              {result.success ? (
                <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>
                  {t("tunel.funcionando")}
                </TonePill>
              ) : (
                <TonePill tone="danger" icon={<IconCircleX className="size-3.5" />}>
                  {t("tunel.naoFuncionandoAinda")}
                </TonePill>
              )}
              <span className="text-xs text-muted-foreground">
                {t("tunel.ultimoTeste", { quando: dataHora(result.testedAt) })}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("tunel.ipDireto")} <span className="font-mono text-foreground">{result.directIp ?? result.directError ?? "—"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("tunel.ipPeloPrograma")}{" "}
              <span className="font-mono text-foreground">{result.proxiedIp ?? result.proxiedError ?? "—"}</span>
            </p>
          </div>
        )}

        {/* A parte que mais gera dúvida: o túnel não é "ligado pra sempre". Ele
            existe só enquanto o computador está ligado, conectado e com o
            programa aberto. Quem não entende isso descobre pela fatura. */}
        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">{t("tunel.quandoInternetUsada")}</p>
          <Rico
            className="mt-1 block text-sm leading-relaxed text-muted-foreground"
            html={t("tunel.quandoInternetUsadaTexto")}
          />

          <div className="mt-4 flex flex-col gap-2">
            <p className="text-sm font-medium">{t("tunel.oQueFazer")}</p>
            {(
              [
                {
                  valor: false,
                  titulo: t("tunel.baixarMesmoAssim"),
                  texto: t("tunel.baixarMesmoAssimTexto"),
                },
                {
                  valor: true,
                  titulo: t("tunel.esperarComputador"),
                  texto: t("tunel.esperarComputadorTexto"),
                },
              ] as const
            ).map((op) => (
              <button
                key={String(op.valor)}
                type="button"
                disabled={savingPolicy}
                onClick={() => handlePolicy(op.valor)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  requireTunnel === op.valor
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

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleTest} disabled={testing} className="w-fit gap-2">
            <IconRefresh className={testing ? "size-4 animate-spin" : "size-4"} />
            {testing ? t("tunel.testando") : t("tunel.testarConexao")}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={disconnecting} className="w-fit">
            {disconnecting ? t("tunel.desconectando") : t("pub.desconectar")}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ClientTunnelPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<ClientTunnelResponse | null>(null)
  const [selectedOs, setSelectedOs] = useState<Os | null>(null)

  async function load() {
    const res = await api.get<ClientTunnelResponse>("/api/client/tunnel")
    setData(res)
  }

  useEffect(() => {
    load()
  }, [])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("tunel.titulo")}>
      <PageHeader
        title={t("tunel.titulo")}
        description={t("tunel.descricao")}
      />
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("tunel.oQueE")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>{t("tunel.oQueETexto1")}</p>
          <p>{t("tunel.oQueETexto2")}</p>
        </CardContent>
      </Card>

      {!data ? (
        <Skeleton className="h-40" />
      ) : data.tunnel?.paired ? (
        <ConnectedStatus tunnel={data.tunnel} onChanged={load} />
      ) : (
        <>
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-2 py-4 text-sm">
              <p className="font-semibold">{t("tunel.naoSePreocupe")}</p>
              <p className="text-muted-foreground">{t("tunel.naoSePreocupeTexto")}</p>
            </CardContent>
          </Card>

          {!selectedOs && <OsPicker onSelect={setSelectedOs} />}

          {selectedOs === "windows" && <BackToOsPicker onClick={() => setSelectedOs(null)} />}
          {selectedOs === "windows" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <WindowsMark className="size-4 text-muted-foreground" />
                {t("tunel.instalandoWindows")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <StepCard number={1} title={t("tunel.baixeOPrograma")}>
                <div className="flex flex-col gap-2">
                  <a href="/downloads/post-flow-tunnel-windows.zip" download className="w-fit">
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      {t("tunel.baixarWindows")}
                    </Button>
                  </a>
                  <Rico html={t("tunel.win1")} />
                </div>
              </StepCard>
              <StepCard number={2} title={t("tunel.win2Titulo")}>
                <Rico html={t("tunel.win2")} />
              </StepCard>
              <StepCard number={3} title={t("tunel.win3Titulo")}>
                <Rico html={t("tunel.win3")} />
              </StepCard>
              <StepCard number={4} title={t("tunel.win4Titulo")}>
                <Rico html={t("tunel.win4")} />
              </StepCard>
              <StepCard number={5} title={t("tunel.win5Titulo")}>
                <Rico html={t("tunel.win5")} />
              </StepCard>
              <StepCard number={6} title={t("tunel.vejaOCodigo")}>
                {t("tunel.vejaOCodigoTexto")}
              </StepCard>
            </CardContent>
          </Card>
          )}

          {selectedOs === "mac" && <BackToOsPicker onClick={() => setSelectedOs(null)} />}
          {selectedOs === "mac" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AppleMark className="size-4 text-muted-foreground" />
                {t("tunel.instalandoMac")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <StepCard number={1} title={t("tunel.baixeOPrograma")}>
                <div className="flex flex-col gap-2">
                  <a href="/downloads/post-flow-tunnel-mac" download className="w-fit">
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      {t("tunel.baixarMac")}
                    </Button>
                  </a>
                  <Rico html={t("tunel.mac1")} />
                </div>
              </StepCard>
              <StepCard number={2} title={t("tunel.mac2Titulo")}>
                <Rico html={t("tunel.mac2")} />
              </StepCard>
              <StepCard number={3} title={t("tunel.mac3Titulo")}>
                <Rico html={t("tunel.mac3")} />
              </StepCard>
              <StepCard number={4} title={t("tunel.mac4Titulo")}>
                {t("tunel.mac4")}
              </StepCard>
              <StepCard number={5} title={t("tunel.mac5Titulo")}>
                {t("tunel.mac5")}
              </StepCard>
              <StepCard number={6} title={t("tunel.vejaOCodigo")}>
                {t("tunel.vejaOCodigoTexto")}
              </StepCard>
            </CardContent>
          </Card>
          )}

          {selectedOs && (
            <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{t("tunel.conectar")}</CardTitle>
                  <CardDescription>{t("tunel.coleOCodigo")}</CardDescription>
                </CardHeader>
                <CardContent>
                  <PairingForm onPaired={load} />
                </CardContent>
              </Card>

              <Card>
                <CardContent className="py-4 text-sm text-muted-foreground">
                  <strong className="text-foreground">{t("tunel.umaCoisaImportante")}</strong>{" "}
                  {t("tunel.umaCoisaImportanteTexto")}
                </CardContent>
              </Card>

              <UninstallGuide os={selectedOs} />
            </>
          )}
        </>
      )}
    </DashboardLayout>
  )
}
