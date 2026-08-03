import { useEffect, useState } from "react"
import { IconCreditCard, IconCircleCheck, IconCoins } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type { ClientBillingOverviewResponse, CreditBucket, CreditBucketView } from "@/types/api"

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

function BucketMeter({ label, bucket }: { label: string; bucket: CreditBucketView }) {
  const totalPool = bucket.quotaMinutes + bucket.extraMinutes
  const usedPercent = totalPool > 0 ? Math.min(100, (bucket.usedMinutes / totalPool) * 100) : 0
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between">
        <span className="text-sm font-medium">{label}</span>
        <span className="font-heading text-lg font-semibold tabular-nums">{bucket.availableMinutes} min disponíveis</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full rounded-full bg-primary" style={{ width: `${usedPercent}%` }} />
      </div>
      <div className="text-xs text-muted-foreground">
        {bucket.usedMinutes} de {bucket.quotaMinutes} min da cota semanal usados
        {bucket.extraMinutes > 0 && ` · +${bucket.extraMinutes} min avulsos`}
      </div>
    </div>
  )
}

function RateBox({
  titulo,
  valor,
  detalhe,
  destaque,
}: {
  titulo: string
  valor: string
  detalhe: string
  destaque?: boolean
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${destaque ? "border-primary/30 bg-primary/[0.04]" : "border-border"}`}
    >
      <div className="text-xs text-muted-foreground">{titulo}</div>
      <div className="font-heading mt-0.5 text-lg font-semibold tabular-nums">{valor}</div>
      <div className="mt-0.5 text-xs leading-snug text-muted-foreground">{detalhe}</div>
    </div>
  )
}

// input type="range" nativo em vez de um componente novo: ja vem com teclado,
// leitor de tela e toque funcionando, e o visual sai todo do accent-color, que
// segue o tema claro/escuro sozinho.
function MinutosSlider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
}) {
  const percentual = ((value - min) / (max - min)) * 100
  return (
    <div className="flex flex-col gap-1.5">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label="Quantos minutos comprar"
        onChange={(e) => onChange(Number(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--primary) 0%, var(--primary) ${percentual}%, var(--muted) ${percentual}%, var(--muted) 100%)`,
        }}
        className="accent-primary h-2 w-full cursor-pointer appearance-none rounded-full
          [&::-webkit-slider-thumb]:size-5 [&::-webkit-slider-thumb]:appearance-none
          [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:border-2
          [&::-webkit-slider-thumb]:border-background [&::-webkit-slider-thumb]:bg-primary
          [&::-webkit-slider-thumb]:shadow-sm
          [&::-moz-range-thumb]:size-5 [&::-moz-range-thumb]:rounded-full
          [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-background
          [&::-moz-range-thumb]:bg-primary"
      />
      <div className="flex justify-between text-[11.5px] text-muted-foreground tabular-nums">
        <span>{min} min</span>
        <span>{max} min</span>
      </div>
    </div>
  )
}

// "1 canal(is)" e "Ilimitado canal(is)" eram o jeito preguiçoso de resolver
// plural. Some do texto e some a palavra "Ilimitado" antes de um substantivo
// singular, que nem português é.
function plural(qtd: number | null, umSo: string, varios: string, semLimite: string) {
  if (qtd === null || qtd === undefined) return semLimite
  return `${qtd} ${qtd === 1 ? umSo : varios}`
}

// Minutos do vídeo usado no exemplo de preço. Um número redondo e realista:
// o cliente consegue comparar de cabeça com o vídeo dele.
const VIDEO_EXEMPLO_MIN = 30

// Traduz minutos em "quantos vídeos". Abaixo do vídeo de exemplo a divisão dá
// zero, e "cerca de 0 vídeos" logo acima de um botão de compra parece defeito -
// então nesse caso a frase muda em vez de mostrar o zero.
function estimativaVideos(minutos: number) {
  const quantos = Math.floor(minutos / VIDEO_EXEMPLO_MIN)
  if (quantos < 1) return `Dá pra processar um vídeo de até ${minutos} minutos.`
  return `Dá pra processar cerca de ${quantos} vídeo${quantos === 1 ? "" : "s"} de ${VIDEO_EXEMPLO_MIN} minutos.`
}

export function ClientBillingPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<ClientBillingOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [minutosAvulsos, setMinutosAvulsos] = useState<number | null>(null)

  async function load() {
    const res = await api.get<ClientBillingOverviewResponse>("/api/client/billing/overview")
    setData(res)
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (authLoading || !user) return null

  async function runAction(key: string, action: () => Promise<{ checkoutUrl: string } | void>) {
    setError(null)
    setBusyKey(key)
    try {
      const result = await action()
      if (result && result.checkoutUrl) {
        window.location.href = result.checkoutUrl
        return
      }
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Não foi possível completar essa ação agora.")
    } finally {
      setBusyKey(null)
    }
  }

  function subscribe(planKey: string) {
    return runAction(`subscribe-${planKey}`, () => api.post("/api/client/billing/subscribe", { planKey }))
  }

  function buyPackage(bucket: CreditBucket, minutes: number) {
    return runAction(`package-${bucket}`, () =>
      api.post("/api/client/billing/buy-package", { bucket, minutes })
    )
  }

  function setupOverageCard() {
    return runAction("overage-setup", () => api.post("/api/client/billing/overage-card/setup"))
  }

  function disableOverageCard() {
    return runAction("overage-disable", () => api.post("/api/client/billing/overage-card/disable"))
  }

  // Os limites da barra só chegam com a resposta da API, então o estado começa
  // em null e cai no mínimo até lá - assim nenhum valor "chutado" aparece na
  // tela antes de a gente saber o preço de verdade.
  const minutos = data ? (minutosAvulsos ?? data.package.minMinutes) : 0
  const totalAvulso = data ? minutos * data.package.centsPerMinute : 0

  return (
    <DashboardLayout user={user} onLogout={logout} title="Plano e uso">
      <PageHeader
        title="Plano e uso"
        description="Quantos minutos você tem, quanto já usou e como conseguir mais."
      />
      {!data ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}

          {!data.stripeConfigured && (
            <TonePill tone="neutral">Pagamento por cartão ainda não está disponível - fale com o suporte.</TonePill>
          )}

          {data.subscription.status === "sem_plano" && (
            <TonePill tone="danger">
              Você ainda não tem um plano ativo - escolha um abaixo ou fale com o suporte pra ativar.
            </TonePill>
          )}
          {data.subscription.status === "inadimplente" && (
            <TonePill tone="danger">Sua última cobrança falhou - atualize o cartão pra manter a assinatura ativa.</TonePill>
          )}

          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Créditos normais</CardTitle>
                <CardDescription>Cota semanal do seu plano. É a que roda quando o download sai pela nossa internet.</CardDescription>
              </CardHeader>
              <CardContent>
                <BucketMeter label="Normais" bucket={data.credits.normal} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Créditos bônus</CardTitle>
                <CardDescription>Cota extra, liberada quando o programa do seu computador está conectado.</CardDescription>
              </CardHeader>
              <CardContent>
                <BucketMeter label="Bônus" bucket={data.credits.bonus} />
              </CardContent>
            </Card>
          </div>

          {/* As duas formas de nao ficar sem credito no meio do mes ficam
              ACIMA dos planos: quem chega nesta tela quase sempre chega porque
              o credito esta acabando agora, nao pra comparar plano. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCreditCard className="size-4 text-muted-foreground" />
                  Cartão para cobrança automática
                </CardTitle>
                <CardDescription>
                  Sua máquina de views não para quando o crédito acaba. Com um cartão cadastrado, o vídeo continua
                  sendo processado e você paga só o que passou do plano.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="grid gap-2 sm:grid-cols-2">
                  <RateBox
                    titulo="Pela nossa internet"
                    valor={`${formatCents(data.overage.rateCentsNormal)} / min`}
                    detalhe="Sem instalar nada. É o padrão."
                  />
                  <RateBox
                    titulo="Pela sua internet"
                    valor={`${formatCents(data.overage.rateCentsBonus)} / min`}
                    detalhe="Com o programa instalado no seu computador."
                    destaque
                  />
                </div>

                <div className="rounded-lg border border-border bg-muted/40 p-3.5 text-sm">
                  <p className="font-medium">Como a conta é feita</p>
                  <p className="mt-1 leading-relaxed text-muted-foreground">
                    A cobrança é por <strong className="text-foreground">minuto de vídeo processado</strong>, e
                    acontece a cada vídeo. Não importa quantos cortes saírem dele: um vídeo de{" "}
                    {VIDEO_EXEMPLO_MIN} minutos que vira 3 cortes custa o mesmo que um que vira 12.
                  </p>
                  <div className="mt-2.5 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                    <span>
                      Vídeo de {VIDEO_EXEMPLO_MIN} min, nossa internet:{" "}
                      <strong className="tabular-nums">
                        {formatCents(data.overage.rateCentsNormal * VIDEO_EXEMPLO_MIN)}
                      </strong>
                    </span>
                    <span>
                      Pela sua internet:{" "}
                      <strong className="tabular-nums">
                        {formatCents(data.overage.rateCentsBonus * VIDEO_EXEMPLO_MIN)}
                      </strong>
                    </span>
                  </div>
                </div>

                {data.overage.pendingCents > 0 && (
                  <TonePill tone="danger">
                    Excedente acumulado neste ciclo: {formatCents(data.overage.pendingCents)}
                  </TonePill>
                )}

                <div className="mt-auto flex flex-wrap items-center gap-2">
                  {data.subscription.overageCardEnabled ? (
                    <>
                      <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>
                        Cartão ativo
                      </TonePill>
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyKey === "overage-disable"}
                        onClick={disableOverageCard}
                      >
                        Desligar cobrança automática
                      </Button>
                    </>
                  ) : (
                    <Button disabled={busyKey === "overage-setup"} onClick={setupOverageCard}>
                      Cadastrar cartão
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <IconCoins className="size-4 text-muted-foreground" />
                  Comprar créditos
                </CardTitle>
                <CardDescription>
                  Prefere pagar adiantado? Compre minutos avulsos e use quando quiser. Eles não expiram e não somem
                  na virada da semana.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4">
                <div className="rounded-lg border border-border p-4">
                  <div className="flex items-end justify-between gap-4">
                    <div>
                      <div className="text-xs text-muted-foreground">Quantos minutos</div>
                      <div className="font-heading text-3xl leading-tight font-semibold tabular-nums">
                        {minutos} min
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground">Você paga</div>
                      <div className="font-heading text-3xl leading-tight font-semibold tabular-nums">
                        {formatCents(totalAvulso)}
                      </div>
                    </div>
                  </div>

                  <div className="mt-4">
                    <MinutosSlider
                      value={minutos}
                      min={data.package.minMinutes}
                      max={data.package.maxMinutes}
                      step={data.package.stepMinutes}
                      onChange={setMinutosAvulsos}
                    />
                  </div>

                  <p className="mt-3 text-xs leading-relaxed text-muted-foreground">
                    {formatCents(data.package.centsPerMinute)} por minuto, o mesmo preço do excedente pela nossa
                    internet. {estimativaVideos(minutos)}
                  </p>
                </div>

                {/* Atalhos pros valores mais pedidos: arrastar até um número
                    exato é chato, e a barra sozinha deixava um vazio aqui. */}
                <div className="flex flex-wrap gap-2">
                  {[25, 100, 250, 500].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setMinutosAvulsos(v)}
                      className={`rounded-full border px-3 py-1.5 text-[13px] font-medium tabular-nums transition-colors ${
                        minutos === v
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border text-muted-foreground hover:bg-muted"
                      }`}
                    >
                      {v} min
                    </button>
                  ))}
                </div>

                <Button
                  className="mt-auto"
                  disabled={busyKey === "package-normal"}
                  onClick={() => buyPackage("normal", minutos)}
                >
                  Comprar {minutos} min por {formatCents(totalAvulso)}
                </Button>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Seu plano</CardTitle>
              <CardDescription>
                {data.subscription.planName
                  ? `Plano atual: ${data.subscription.planName}`
                  : "Escolha um plano pra começar a processar vídeos."}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-3">
              {data.plans.map((plan) => {
                const isCurrent = plan.key === data.subscription.planKey
                return (
                  <div
                    key={plan.key}
                    className={`flex flex-col gap-3 rounded-lg border p-4 ${isCurrent ? "border-primary bg-primary/5" : "border-border"}`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="font-heading text-base font-semibold">{plan.name}</span>
                      {isCurrent && (
                        <TonePill tone="success" icon={<IconCircleCheck className="size-3.5" />}>
                          Atual
                        </TonePill>
                      )}
                    </div>
                    <div className="font-heading text-2xl font-semibold tabular-nums">
                      {formatCents(plan.priceCents)}
                      <span className="text-xs font-normal text-muted-foreground">/mês</span>
                    </div>
                    <ul className="flex flex-1 flex-col gap-1 text-xs text-muted-foreground">
                      <li>{plan.weeklyMinutesNormal} minutos por semana</li>
                      <li>{plan.weeklyMinutesBonus} minutos usando sua internet</li>
                      <li>{plural(plan.maxYoutubeChannels, "canal do YouTube", "canais do YouTube", "Canais do YouTube ilimitados")}</li>
                      <li>{plural(plan.maxTiktokAccounts, "conta do TikTok", "contas do TikTok", "Contas do TikTok ilimitadas")}</li>
                    </ul>
                    <Button
                      variant={isCurrent ? "outline" : "default"}
                      size="sm"
                      disabled={isCurrent || busyKey === `subscribe-${plan.key}`}
                      onClick={() => subscribe(plan.key)}
                    >
                      {isCurrent ? "Plano atual" : "Assinar / trocar de plano"}
                    </Button>
                  </div>
                )
              })}
            </CardContent>
          </Card>

          {data.recentTransactions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Consumo recente</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.recentTransactions.map((t) => (
                  <div key={t.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Vídeo #{t.sourceVideoId}</span>
                    <span>
                      {t.minutesCharged} min · bolso {t.bucket === "bonus" ? "bônus" : "normal"}
                    </span>
                    <TonePill tone={t.status === "confirmado" ? "success" : t.status === "liberado" ? "neutral" : "cyan"}>
                      {t.status}
                    </TonePill>
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </>
      )}
    </DashboardLayout>
  )
}
