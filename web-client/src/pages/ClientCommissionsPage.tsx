import { useEffect, useState } from "react"
import {
  IconCoins,
  IconUsers,
  IconUserCheck,
  IconWallet,
  IconCopy,
  IconCheck,
  IconGift,
} from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { StatCard } from "@/components/dashboard/StatCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useDateRange } from "@/hooks/useDateRange"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { useT, type ChaveDeTraducao } from "@/i18n"
import { data as formatarData } from "@/lib/formatoLocal"
import type { ClientCommissionsOverviewResponse, PixKeyType, WithdrawalStatus } from "@/types/api"

function formatCents(cents: number) {
  return (cents / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
}

const WITHDRAWAL_TONE: Record<WithdrawalStatus, "success" | "danger" | "neutral"> = {
  pendente: "neutral",
  pago: "success",
  recusado: "danger",
}

const WITHDRAWAL_LABEL: Record<WithdrawalStatus, ChaveDeTraducao> = {
  pendente: "com.statusPendente",
  pago: "com.statusPago",
  recusado: "com.statusRecusado",
}

const PIX_TYPES: { value: PixKeyType; label: ChaveDeTraducao }[] = [
  { value: "cpf", label: "com.pixTipoCpf" },
  { value: "cnpj", label: "com.pixTipoCnpj" },
  { value: "email", label: "com.pixTipoEmail" },
  { value: "telefone", label: "com.pixTipoTelefone" },
  { value: "aleatoria", label: "com.pixTipoAleatoria" },
]

export function ClientCommissionsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [dados, setDados] = useState<ClientCommissionsOverviewResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [info, setInfo] = useState<string | null>(null)
  const [copiado, setCopiado] = useState(false)
  const [pixKeyDraft, setPixKeyDraft] = useState("")
  const [pixTypeDraft, setPixTypeDraft] = useState<PixKeyType | "">("")
  const [busyKey, setBusyKey] = useState<string | null>(null)

  async function load() {
    const res = await api.get<ClientCommissionsOverviewResponse>(`/api/client/commissions/overview?range=${range}`)
    setDados(res)
    setPixKeyDraft(res.pix.key ?? "")
    setPixTypeDraft(res.pix.type ?? "")
  }

  useEffect(() => {
    if (!user) return
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, range])

  if (authLoading || !user) return null

  async function copyLink() {
    if (!dados) return
    await navigator.clipboard.writeText(dados.link.url)
    setCopiado(true)
    setTimeout(() => setCopiado(false), 2000)
  }

  async function savePixKey() {
    setError(null)
    setInfo(null)
    setBusyKey("pix")
    try {
      await api.put("/api/client/commissions/pix-key", { pixKey: pixKeyDraft, pixKeyType: pixTypeDraft })
      setInfo(t("com.chavePixSalva"))
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    } finally {
      setBusyKey(null)
    }
  }

  async function requestWithdrawal() {
    setError(null)
    setInfo(null)
    setBusyKey("saque")
    try {
      await api.post("/api/client/commissions/withdraw")
      setInfo(t("com.saqueSolicitado"))
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    } finally {
      setBusyKey(null)
    }
  }

  const podeSacar = dados ? dados.balance.availableCents >= dados.minWithdrawCents : false
  const faltamCents = dados ? Math.max(0, dados.minWithdrawCents - dados.balance.availableCents) : 0

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("com.clienteTitulo")}>
      <PageHeader title={t("com.clienteTitulo")} description={t("com.clienteIncentivoTexto")} />

      {!dados ? (
        <Skeleton className="h-64" />
      ) : (
        <>
          {error && <p className="text-sm text-destructive">{error}</p>}
          {info && <p className="text-sm text-status-posted">{info}</p>}

          <Card className="border-primary/25 bg-primary/[0.04]">
            <CardContent className="flex flex-col gap-4 py-5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-3">
                <IconGift className="mt-0.5 size-5 shrink-0 text-primary" />
                <div>
                  <p className="font-heading text-base font-semibold">{t("com.clienteIncentivoTitulo")}</p>
                  <p className="mt-1 max-w-xl text-sm text-muted-foreground">{t("com.clienteIncentivoTexto")}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("com.seuLink")}</CardTitle>
              <CardDescription>{t("com.dicaLink")}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input readOnly value={dados.link.url} className="font-mono text-sm" onFocus={(e) => e.target.select()} />
                <Button variant={copiado ? "outline" : "default"} onClick={copyLink} className="shrink-0 gap-1.5">
                  {copiado ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
                  {copiado ? t("com.linkCopiado") : t("com.copiarLink")}
                </Button>
              </div>
            </CardContent>
          </Card>

          <DateRangeFilter value={range} onChange={setRange} />

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("com.comissaoTotal")} value={formatCents(dados.balance.totalEarnedCents)} icon={<IconCoins />} />
            <StatCard label={t("com.indicacoes")} value={dados.referralCount} icon={<IconUsers />} />
            <StatCard label={t("com.assinaturasAtivas")} value={dados.activeSubscriptionCount} icon={<IconUserCheck />} />
            <StatCard label={t("com.saldoDisponivel")} value={formatCents(dados.balance.availableCents)} icon={<IconWallet />} />
          </div>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("com.saqueTitulo")}</CardTitle>
              <CardDescription>{t("com.saqueDescricao")}</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="pixType">{t("com.tipoChavePix")}</FieldLabel>
                  <Select value={pixTypeDraft || undefined} onValueChange={(v) => setPixTypeDraft(v as PixKeyType)}>
                    <SelectTrigger id="pixType" size="sm">
                      <SelectValue placeholder={t("com.escolhaTipo")} />
                    </SelectTrigger>
                    <SelectContent>
                      {PIX_TYPES.map((p) => (
                        <SelectItem key={p.value} value={p.value}>
                          {t(p.label)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </Field>
                <Field>
                  <FieldLabel htmlFor="pixKey">{t("com.chavePix")}</FieldLabel>
                  <Input id="pixKey" value={pixKeyDraft} onChange={(e) => setPixKeyDraft(e.target.value)} />
                </Field>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busyKey === "pix" || !pixKeyDraft || !pixTypeDraft}
                  onClick={savePixKey}
                >
                  {t("com.salvarChavePix")}
                </Button>

                {podeSacar ? (
                  <Button size="sm" disabled={busyKey === "saque" || !dados.pix.key} onClick={requestWithdrawal}>
                    {busyKey === "saque" ? t("com.solicitandoSaque") : t("com.solicitarSaque")}
                  </Button>
                ) : (
                  <TonePill tone="neutral">
                    {t("com.faltamParaSaque", { valor: formatCents(faltamCents), minimo: formatCents(dados.minWithdrawCents) })}
                  </TonePill>
                )}
              </div>
              {podeSacar && !dados.pix.key && (
                <p className="text-xs text-muted-foreground">{t("com.cadastreChaveAntes")}</p>
              )}

              {dados.recentWithdrawals.length > 0 && (
                <div className="mt-2 flex flex-col gap-2 border-t border-border pt-3">
                  <p className="text-xs font-medium text-muted-foreground">{t("com.ultimosSaques")}</p>
                  {dados.recentWithdrawals.map((w) => (
                    <div key={w.id} className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">{formatarData(w.requestedAt)}</span>
                      <span className="tabular-nums">{formatCents(w.amountCents)}</span>
                      <TonePill tone={WITHDRAWAL_TONE[w.status]}>{t(WITHDRAWAL_LABEL[w.status])}</TonePill>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("com.ultimasIndicacoes")}</CardTitle>
            </CardHeader>
            <CardContent>
              {dados.recentReferrals.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("com.nenhumaIndicacaoAinda")}</p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>{t("tabela.cliente")}</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>{t("adm.cadastradoEm")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {dados.recentReferrals.map((r) => (
                      <TableRow key={r.id}>
                        <TableCell className="font-medium">{r.businessName || r.email}</TableCell>
                        <TableCell>
                          <TonePill tone={r.subscriptionStatus === "ativo" ? "success" : "neutral"}>
                            {r.subscriptionStatus === "ativo" ? t("adm.ativo") : t("adm.semPlano")}
                          </TonePill>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{formatarData(r.createdAt)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("com.extratoComissoes")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {dados.recentCommissions.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("com.nenhumaComissaoNoPeriodo")}</p>
              ) : (
                dados.recentCommissions.map((c) => (
                  <div key={c.id} className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">{c.referredBusinessName || c.referredEmail}</span>
                    <span className="tabular-nums text-muted-foreground">{c.commissionPercent}%</span>
                    <span className="tabular-nums font-medium">{formatCents(c.commissionCents)}</span>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </>
      )}
    </DashboardLayout>
  )
}
