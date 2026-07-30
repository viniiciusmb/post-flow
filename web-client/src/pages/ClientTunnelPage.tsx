import { useEffect, useRef, useState, type FormEvent } from "react"
import { IconRouter, IconCircleCheck, IconCircleX, IconRefresh, IconDownload } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Field, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { ClientTunnel, ClientTunnelResponse } from "@/types/api"

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

function PairingForm({ onPaired }: { onPaired: () => void }) {
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
      setError(err instanceof ApiError ? err.message : "Não consegui conectar com esse código.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <Field>
        <FieldLabel>Código de pareamento (mostrado no programa)</FieldLabel>
        <div className="flex gap-2">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Ex: A3K9QZ"
            maxLength={6}
            required
            className="font-mono uppercase"
          />
          <Button type="submit" disabled={saving || code.trim().length === 0}>
            {saving ? "Conectando..." : "Conectar"}
          </Button>
        </div>
      </Field>
      {error && <p className="text-sm text-destructive">{error}</p>}
    </form>
  )
}

function ConnectedStatus({ tunnel, onChanged }: { tunnel: ClientTunnel; onChanged: () => void }) {
  const [testing, setTesting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
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
          {tunnel.label || "Seu programa"}
        </CardTitle>
        <CardDescription>
          Um teste real: busca o IP de saída direto da VPS e o IP passando pelo seu programa — se forem diferentes,
          está funcionando de verdade.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {result && (
          <div className="flex flex-col gap-2 rounded-lg border border-border p-3 text-sm">
            <div className="flex items-center gap-2">
              {result.success ? (
                <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>
                  Funcionando
                </TonePill>
              ) : (
                <TonePill tone="danger" icon={<IconCircleX className="size-3.5" />}>
                  Não funcionando ainda
                </TonePill>
              )}
              <span className="text-xs text-muted-foreground">
                último teste: {new Date(result.testedAt).toLocaleString("pt-BR")}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              IP direto da VPS: <span className="font-mono text-foreground">{result.directIp ?? result.directError ?? "—"}</span>
            </p>
            <p className="text-xs text-muted-foreground">
              IP pelo seu programa:{" "}
              <span className="font-mono text-foreground">{result.proxiedIp ?? result.proxiedError ?? "—"}</span>
            </p>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={handleTest} disabled={testing} className="w-fit gap-2">
            <IconRefresh className={testing ? "size-4 animate-spin" : "size-4"} />
            {testing ? "Testando..." : "Testar conexão"}
          </Button>
          <Button size="sm" variant="outline" onClick={handleDisconnect} disabled={disconnecting} className="w-fit">
            {disconnecting ? "Desconectando..." : "Desconectar"}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

export function ClientTunnelPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<ClientTunnelResponse | null>(null)

  async function load() {
    const res = await api.get<ClientTunnelResponse>("/api/client/tunnel")
    setData(res)
  }

  useEffect(() => {
    load()
  }, [])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Túnel">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que é isso e pra que serve</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            O YouTube bloqueia downloads vindos do nosso servidor (é um IP "de datacenter", e o YouTube desconfia
            desse tipo de IP). Instalando esse programinha no seu computador, os downloads dos SEUS vídeos passam a
            sair pela sua própria internet — um IP residencial normal não é bloqueado.
          </p>
          <p>
            Enquanto você não instalar, seus downloads continuam funcionando normalmente (usam uma conexão de
            reserva) — instalar é opcional, mas ajuda a evitar bloqueios.
          </p>
        </CardContent>
      </Card>

      {!data ? (
        <Skeleton className="h-40" />
      ) : data.tunnel?.paired ? (
        <ConnectedStatus tunnel={data.tunnel} onChanged={load} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Passo a passo</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <StepCard number={1} title="Baixe o programa pro seu computador">
                <div className="flex flex-wrap gap-2">
                  <a href="/downloads/post-flow-tunnel-windows.zip" download>
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      Windows
                    </Button>
                  </a>
                  <a href="/downloads/post-flow-tunnel-mac" download>
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      Mac
                    </Button>
                  </a>
                </div>
              </StepCard>
              <StepCard number={2} title="Abra o programa">
                No Windows, extraia o arquivo baixado (botão direito → "Extrair tudo") e abra o programa dentro da
                pasta extraída. Se aparecer um aviso de "aplicativo desconhecido", clique em "Mais informações" →
                "Executar assim mesmo" (é normal, o programa ainda não tem uma assinatura digital paga). No Mac, se o
                sistema bloquear na primeira vez, vá em Ajustes → Privacidade e Segurança e permita a abertura.
              </StepCard>
              <StepCard number={3} title="Copie o código que aparece no programa">
                Um ícone novo vai aparecer na barra de tarefas/menu com um código curto de 6 letras/números.
              </StepCard>
              <StepCard number={4} title="Cole o código aqui embaixo">
                Assim que conectar, essa página atualiza sozinha.
              </StepCard>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conectar</CardTitle>
            </CardHeader>
            <CardContent>
              <PairingForm onPaired={load} />
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
