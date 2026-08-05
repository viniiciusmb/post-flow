import { useT, type ChaveDeTraducao } from "@/i18n"
import { useEffect, useState } from "react"
import { IconReceipt2 } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { TonePill } from "@/components/ui/tone-pill"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import type {
  AdminBillingClient,
  AdminBillingClientsResponse,
  AdminBillingPlansResponse,
  AdminOverageSummaryResponse,
  BillingPlan,
  SubscriptionStatus,
} from "@/types/api"

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const STATUS_TONE: Record<SubscriptionStatus, "success" | "danger" | "neutral"> = {
  ativo: "success",
  inadimplente: "danger",
  cancelado: "neutral",
  sem_plano: "neutral",
}

const STATUS_LABEL: Record<SubscriptionStatus, ChaveDeTraducao> = {
  ativo: "adm.ativo",
  inadimplente: "adm.inadimplente",
  cancelado: "adm.cancelado",
  sem_plano: "adm.semPlano",
}

export function AdminBillingPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [clients, setClients] = useState<AdminBillingClient[] | null>(null)
  const [plans, setPlans] = useState<BillingPlan[] | null>(null)
  const [overage, setOverage] = useState<AdminOverageSummaryResponse["clients"] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [savingClientId, setSavingClientId] = useState<number | null>(null)

  async function load() {
    const [clientsRes, plansRes, overageRes] = await Promise.all([
      api.get<AdminBillingClientsResponse>("/api/admin/billing/clients"),
      api.get<AdminBillingPlansResponse>("/api/admin/billing/plans"),
      api.get<AdminOverageSummaryResponse>("/api/admin/billing/overage"),
    ])
    setClients(clientsRes.clients)
    setPlans(plansRes.plans)
    setOverage(overageRes.clients)
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user])

  if (authLoading || !user) return null

  async function assignPlan(clientUserId: number, planKey: string) {
    setError(null)
    setSavingClientId(clientUserId)
    try {
      await api.post(`/api/admin/billing/clients/${clientUserId}/plan`, { planKey })
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("adm.naoFoiPossivelAtribuir"))
    } finally {
      setSavingClientId(null)
    }
  }

  return (
    <DashboardLayout user={user} onLogout={logout} title="Assinaturas">
      {!clients || !plans || !overage ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("adm.assinaturasClientes")}</CardTitle>
              <CardDescription>
                Atribua um plano manualmente pra ativar um cliente sem depender da Stripe (útil enquanto as chaves
                de pagamento não chegaram, ou pra qualquer ativação manual).
              </CardDescription>
            </CardHeader>
            <CardContent>
              {clients.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum cliente cadastrado ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Cliente</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{t("adm.plano")}</TableHead>
                      <TableHead>{t("adm.excedenteAutomatico")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clients.map((c) => (
                      <TableRow key={c.clientUserId}>
                        <TableCell className="font-medium">{c.businessName || c.email}</TableCell>
                        <TableCell>
                          <TonePill tone={STATUS_TONE[c.status]}>{t(STATUS_LABEL[c.status])}</TonePill>
                        </TableCell>
                        <TableCell>
                          <Select
                            value={c.planKey ?? undefined}
                            onValueChange={(planKey) => assignPlan(c.clientUserId, planKey)}
                            disabled={savingClientId === c.clientUserId}
                          >
                            <SelectTrigger size="sm" className="w-40">
                              <SelectValue placeholder={t("adm.semPlano")} />
                            </SelectTrigger>
                            <SelectContent>
                              {plans.map((p) => (
                                <SelectItem key={p.key} value={p.key}>
                                  {p.name}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </TableCell>
                        <TableCell>
                          <TonePill tone={c.overageCardEnabled ? "success" : "neutral"}>
                            {c.overageCardEnabled ? "Ligado" : "Desligado"}
                          </TonePill>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <IconReceipt2 className="size-4 text-muted-foreground" />{t("adm.faturamentoExcedente")}</CardTitle>
              <CardDescription>{t("adm.quantoAcumulou")}</CardDescription>
            </CardHeader>
            <CardContent>
              {overage.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nenhum excedente registrado ainda.</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Cliente</TableHead>
                      <TableHead>{t("adm.pendenteNoCiclo")}</TableHead>
                      <TableHead>{t("adm.jaFaturadoPago")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overage.map((o) => (
                      <TableRow key={o.clientUserId}>
                        <TableCell className="font-medium">{o.businessName || o.email}</TableCell>
                        <TableCell>
                          {o.pendingCents > 0 ? (
                            <TonePill tone="danger">{formatCents(o.pendingCents)}</TonePill>
                          ) : (
                            formatCents(o.pendingCents)
                          )}
                        </TableCell>
                        <TableCell>{formatCents(o.billedCents)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
