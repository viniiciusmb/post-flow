import { useEffect, useRef, useState } from "react"
import { IconRouter, IconCircleCheck, IconCircleX, IconRefresh } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"

interface TailscaleTestResult {
  testedAt: string
  configured: boolean
  directIp?: string
  directError?: string
  proxiedIp?: string
  proxiedError?: string
  success: boolean
}

interface TailscaleStatusResponse {
  configured: boolean
  lastResult: TailscaleTestResult | null
}

function StatusCard() {
  const [data, setData] = useState<TailscaleStatusResponse | null>(null)
  const [testing, setTesting] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  async function load() {
    const res = await api.get<TailscaleStatusResponse>("/api/admin/tailscale/status")
    setData(res)
    return res
  }

  useEffect(() => {
    load()
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [])

  async function handleTest() {
    setTesting(true)
    const before = data?.lastResult?.testedAt ?? null
    await api.post("/api/admin/tailscale/test", {})

    let attempts = 0
    pollRef.current = setInterval(async () => {
      attempts++
      const res = await load()
      if ((res.lastResult && res.lastResult.testedAt !== before) || attempts >= 15) {
        if (pollRef.current) clearInterval(pollRef.current)
        setTesting(false)
      }
    }, 2000)
  }

  if (!data) return <Skeleton className="h-40" />

  const result = data.lastResult

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconRouter className="size-4 text-muted-foreground" />
          Status do relé
        </CardTitle>
        <CardDescription>
          Um teste real: busca o IP de saída direto da VPS e o IP de saída passando pelo relé — se forem diferentes,
          o relé está funcionando de verdade.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex items-center gap-2">
          <TonePill tone={data.configured ? "success" : "neutral"}>
            {data.configured ? "Configurado na VPS" : "Ainda não configurado na VPS"}
          </TonePill>
        </div>

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
              IP via relé Tailscale:{" "}
              <span className="font-mono text-foreground">{result.proxiedIp ?? result.proxiedError ?? "—"}</span>
            </p>
          </div>
        )}

        <Button size="sm" onClick={handleTest} disabled={testing} className="w-fit gap-2">
          <IconRefresh className={testing ? "size-4 animate-spin" : "size-4"} />
          {testing ? "Testando..." : "Testar conexão"}
        </Button>
      </CardContent>
    </Card>
  )
}

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

export function AdminTailscalePage() {
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Tailscale">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">O que é isso e pra que serve</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 text-sm text-muted-foreground">
          <p>
            O YouTube bloqueia downloads vindos do IP da nossa VPS (é um IP "de datacenter", e o YouTube desconfia
            desse tipo de IP). A forma gratuita de resolver isso é fazer o download sair pela internet de um{" "}
            <strong className="text-foreground">aparelho seu</strong> (celular, computador) em vez de sair direto da
            VPS — um IP residencial normal não é bloqueado.
          </p>
          <p>
            <strong className="text-foreground">Importante: isso é um aparelho SEU, não do seu cliente final.</strong>{" "}
            Um único aparelho seu serve pra todos os clientes ao mesmo tempo — não precisa (e não faz sentido) pedir
            pra cada cliente instalar nada. O aparelho escolhido precisa ficar ligado e conectado à internet sempre
            que quiser que os downloads funcionem — se ele desligar ou perder conexão, os downloads simplesmente
            esperam (não quebra nada, só não funciona enquanto ele estiver fora do ar).
          </p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Passo a passo (uma vez só, leva uns 5 minutos)</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <StepCard number={1} title="Instale o app Tailscale no aparelho escolhido">
            Baixe o app "Tailscale" na loja de aplicativos (App Store no iPhone, Play Store no Android, ou{" "}
            <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" className="text-primary hover:underline">
              tailscale.com/download
            </a>{" "}
            pra computador). É gratuito pra uso pessoal.
          </StepCard>
          <StepCard number={2} title="Crie uma conta gratuita">
            Abra o app e entre com seu e-mail, Google ou Microsoft — o que for mais fácil pra você. Isso já deixa o
            aparelho conectado à "rede" privada do Tailscale (chamada de "tailnet").
          </StepCard>
          <StepCard number={3} title="Ative esse aparelho como 'saída' (exit node)">
            Dentro do app, procure uma opção chamada <strong className="text-foreground">"Use as Exit Node"</strong>{" "}
            ou <strong className="text-foreground">"Executar como nó de saída"</strong> (geralmente em
            Configurações/Settings) e ative. Se não encontrar essa opção no celular, tente instalar num computador —
            a função aparece mais fácil lá.
          </StepCard>
          <StepCard number={4} title="Aprove o aparelho como saída no site do Tailscale">
            Entre em{" "}
            <a
              href="https://login.tailscale.com/admin/machines"
              target="_blank"
              rel="noreferrer"
              className="text-primary hover:underline"
            >
              login.tailscale.com/admin/machines
            </a>{" "}
            (mesmo login que você usou no app). Vai aparecer o nome do seu aparelho na lista — clique nele, procure
            "Edit route settings" e marque a opção pra permitir que ele seja usado como nó de saída (exit node).
          </StepCard>
          <StepCard number={5} title="Gere uma chave de acesso pra VPS entrar na mesma rede">
            Ainda no site, vá em <strong className="text-foreground">Settings → Keys → Generate auth key</strong>.
            Marque como "Reusable" (reutilizável) e copie a chave gerada (começa com <code>tskey-auth-...</code>).
            Me envie essa chave — eu configuro o lado da VPS com ela (isso eu faço por você, você só precisa gerar e
            copiar).
          </StepCard>
          <StepCard number={6} title="Deixe o aparelho ligado e conectado">
            Pronto — a partir daqui, sempre que esse aparelho estiver ligado, com o app do Tailscale aberto/ativo e
            com internet, os downloads vão sair por ele. Depois que eu terminar a configuração do lado da VPS, use o
            botão "Testar conexão" abaixo pra confirmar que está tudo funcionando de verdade.
          </StepCard>
        </CardContent>
      </Card>

      <StatusCard />
    </DashboardLayout>
  )
}
