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
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="flex flex-col gap-2 py-4 text-sm">
              <p className="font-semibold">Não se preocupe se você nunca instalou um programa assim antes.</p>
              <p className="text-muted-foreground">
                O passo a passo abaixo explica cada clique. Escolha o sistema do SEU computador (Windows ou Mac) e
                siga só aquela parte. Se travar em algum passo, é só voltar aqui depois — nada quebra, e dá pra tentar
                de novo quantas vezes precisar.
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">💻 Se o seu computador é Windows</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <StepCard number={1} title="Baixe o programa">
                <div className="flex flex-col gap-2">
                  <a href="/downloads/post-flow-tunnel-windows.zip" download className="w-fit">
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      Baixar pra Windows
                    </Button>
                  </a>
                  <p>
                    O arquivo baixado normalmente vai pra uma pasta chamada <strong className="text-foreground">Downloads</strong> no
                    seu computador. Se não souber onde encontrar, digite "Downloads" na busca do Windows (o ícone de
                    lupa, geralmente perto do botão Iniciar) e abra a pasta que aparecer.
                  </p>
                </div>
              </StepCard>
              <StepCard number={2} title='"Extraia" o arquivo baixado'>
                O arquivo baixado tem uma "pasta compactada" dentro dele (é assim que ele fica menor pra baixar mais
                rápido) — antes de usar, precisa abrir essa compactação. Clique com o{" "}
                <strong className="text-foreground">botão direito do mouse</strong> em cima do arquivo baixado (o nome
                é parecido com <code className="rounded bg-muted px-1">post-flow-tunnel-windows.zip</code>) e escolha a
                opção <strong className="text-foreground">"Extrair tudo..."</strong>. Vai abrir uma janela pequena — só
                clique no botão <strong className="text-foreground">"Extrair"</strong> dela, sem mudar nada.
              </StepCard>
              <StepCard number={3} title="Abra a pasta nova e execute o programa">
                Depois de extrair, vai aparecer uma pasta nova com o mesmo nome. Abra ela (duplo clique) e procure
                dentro um arquivo chamado{" "}
                <code className="rounded bg-muted px-1">post-flow-tunnel-windows.exe</code>. Dê um{" "}
                <strong className="text-foreground">duplo clique</strong> nesse arquivo.
              </StepCard>
              <StepCard number={4} title='Se aparecer uma tela azul de aviso, não é vírus'>
                É bem comum o Windows mostrar uma tela dizendo{" "}
                <strong className="text-foreground">"O Windows protegeu o computador"</strong>. Isso acontece com
                qualquer programa novo que ainda não pagou por um "certificado" — não significa que tem vírus. Pra
                continuar: clique no texto pequeno{" "}
                <strong className="text-foreground">"Mais informações"</strong>, e depois no botão que vai aparecer
                escrito <strong className="text-foreground">"Executar assim mesmo"</strong>.
              </StepCard>
              <StepCard number={5} title="Procure o ícone perto do relógio">
                O programa não abre uma janela — ele fica rodando "escondido" perto do relógio, no canto inferior
                direito da tela. Se não ver um ícone novo ali, clique na setinha{" "}
                <strong className="text-foreground">"^"</strong> pra mostrar os ícones escondidos. Vai ter um círculo
                colorido novo — esse é o programa.
              </StepCard>
              <StepCard number={6} title="Veja o código">
                Clique nesse ícone. Vai aparecer um código curto de 6 letras/números — é esse código que você vai
                colar no campo lá embaixo desta página.
              </StepCard>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">🍎 Se o seu computador é Mac</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-5">
              <StepCard number={1} title="Baixe o programa">
                <div className="flex flex-col gap-2">
                  <a href="/downloads/post-flow-tunnel-mac" download className="w-fit">
                    <Button size="sm" variant="outline" className="gap-2">
                      <IconDownload className="size-4" />
                      Baixar pra Mac
                    </Button>
                  </a>
                  <p>
                    O arquivo baixado normalmente vai pra pasta{" "}
                    <strong className="text-foreground">Downloads</strong> — o próprio navegador costuma mostrar um
                    aviso "Download concluído" com um atalho pra ele.
                  </p>
                </div>
              </StepCard>
              <StepCard number={2} title="Abra o arquivo baixado">
                Dê um <strong className="text-foreground">duplo clique</strong> no arquivo que você baixou (o nome é
                parecido com <code className="rounded bg-muted px-1">post-flow-tunnel-mac</code>).
              </StepCard>
              <StepCard number={3} title='Se o Mac bloquear, não é vírus'>
                É bem comum aparecer uma mensagem tipo{" "}
                <strong className="text-foreground">"não é possível abrir porque é de um desenvolvedor não
                identificado"</strong>. Isso acontece com qualquer programa novo que ainda não pagou pela
                "identificação" da Apple — não significa que tem vírus. Pra resolver: clique no ícone da maçã (canto
                superior esquerdo) → <strong className="text-foreground">Ajustes do Sistema</strong> →{" "}
                <strong className="text-foreground">Privacidade e Segurança</strong> → role a tela pra baixo até achar
                uma frase mencionando o programa bloqueado → clique em{" "}
                <strong className="text-foreground">"Abrir Assim Mesmo"</strong>.
              </StepCard>
              <StepCard number={4} title="Abra o arquivo de novo">
                Volte na pasta Downloads e dê duplo clique no arquivo mais uma vez — agora ele deve abrir
                normalmente.
              </StepCard>
              <StepCard number={5} title="Procure o ícone no topo da tela">
                O programa não abre uma janela — ele fica rodando "escondido" na barra de menu, bem no topo da tela
                (ao lado do relógio, Wi-Fi, etc). Vai ter um círculo colorido novo ali — esse é o programa.
              </StepCard>
              <StepCard number={6} title="Veja o código">
                Clique nesse ícone. Vai aparecer um código curto de 6 letras/números — é esse código que você vai
                colar no campo lá embaixo desta página.
              </StepCard>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Conectar</CardTitle>
              <CardDescription>Cole aqui o código de 6 caracteres que apareceu no programa.</CardDescription>
            </CardHeader>
            <CardContent>
              <PairingForm onPaired={load} />
            </CardContent>
          </Card>

          <Card>
            <CardContent className="py-4 text-sm text-muted-foreground">
              <strong className="text-foreground">Uma coisa importante:</strong> pra isso funcionar, seu computador
              precisa estar ligado e conectado à internet. Se ele desligar, hibernar ou perder a internet, não tem
              problema nenhum — os downloads simplesmente voltam a usar a conexão de reserva até seu computador
              voltar a ficar disponível.
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
