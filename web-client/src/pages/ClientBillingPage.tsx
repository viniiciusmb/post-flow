import { useEffect, useState } from "react"
import { IconCreditCard, IconCircleCheck } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
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

// "1 canal(is)" e "Ilimitado canal(is)" eram o jeito preguiçoso de resolver
// plural. Some do texto e some a palavra "Ilimitado" antes de um substantivo
// singular, que nem português é.
function plural(qtd: number | null, umSo: string, varios: string, semLimite: string) {
  if (qtd === null || qtd === undefined) return semLimite
  return `${qtd} ${qtd === 1 ? umSo : varios}`
}

export function ClientBillingPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<ClientBillingOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)

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

  function buyPackage(bucket: CreditBucket) {
    return runAction(`package-${bucket}`, () => api.post("/api/client/billing/buy-package", { bucket }))
  }

  function setupOverageCard() {
    return runAction("overage-setup", () => api.post("/api/client/billing/overage-card/setup"))
  }

  function disableOverageCard() {
    return runAction("overage-disable", () => api.post("/api/client/billing/overage-card/disable"))
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title="Plano e uso">
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

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconCreditCard className="size-4 text-muted-foreground" />
                Excedente
              </CardTitle>
              <CardDescription>
                Quando o crédito acaba, você escolhe: comprar um pacote avulso, ou deixar o excedente ser cobrado
                automaticamente no cartão.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-2 text-sm sm:grid-cols-2">
                <div>Pela nossa internet: {formatCents(data.overage.rateCentsNormal)} por minuto</div>
                <div>Pela sua internet: {formatCents(data.overage.rateCentsBonus)} por minuto</div>
              </div>
              {data.overage.pendingCents > 0 && (
                <TonePill tone="danger">Excedente acumulado neste ciclo: {formatCents(data.overage.pendingCents)}</TonePill>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyKey === "package-normal"}
                  onClick={() => buyPackage("normal")}
                >
                  Comprar pacote avulso ({data.package.minutes} min por {formatCents(data.package.priceCents)})
                </Button>
                {data.subscription.overageCardEnabled ? (
                  <Button variant="outline" size="sm" disabled={busyKey === "overage-disable"} onClick={disableOverageCard}>
                    Desligar cobrança automática de excedente
                  </Button>
                ) : (
                  <Button variant="outline" size="sm" disabled={busyKey === "overage-setup"} onClick={setupOverageCard}>
                    Cadastrar cartão pra excedente automático
                  </Button>
                )}
              </div>
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
