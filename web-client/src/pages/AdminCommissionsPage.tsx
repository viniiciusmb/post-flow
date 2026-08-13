import { useEffect, useState } from "react"
import { IconCoins, IconUsers, IconUserCheck, IconWallet, IconGift } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { PageHeader } from "@/components/dashboard/PageHeader"
import { StatCard } from "@/components/dashboard/StatCard"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useDateRange } from "@/hooks/useDateRange"
import { Card, CardContent, CardHeader, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field, FieldLabel, FieldDescription } from "@/components/ui/field"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useAuth } from "@/hooks/useAuth"
import { api, ApiError } from "@/lib/api"
import { useT, type ChaveDeTraducao } from "@/i18n"
import { data as formatarData } from "@/lib/formatoLocal"
import type {
  AdminAffiliate,
  AdminAffiliateLink,
  AdminAffiliatesResponse,
  AdminAffiliateLinksResponse,
  AdminCommissionsOverviewResponse,
  AdminWithdrawal,
  AdminWithdrawalsResponse,
  AffiliateSettings,
  WithdrawalStatus,
} from "@/types/api"

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

function OverviewTab() {
  const t = useT()
  const { range, setRange } = useDateRange()
  const [overview, setOverview] = useState<AdminCommissionsOverviewResponse | null>(null)

  useEffect(() => {
    api.get<AdminCommissionsOverviewResponse>(`/api/admin/commissions/overview?range=${range}`).then(setOverview)
  }, [range])

  return (
    <div className="flex flex-col gap-4">
      <DateRangeFilter value={range} onChange={setRange} />
      {!overview ? (
        <Skeleton className="h-48" />
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatCard label={t("com.comissaoNoPeriodo")} value={formatCents(overview.periodCommissionCents)} icon={<IconCoins />} />
            <StatCard label={t("com.comissaoHistorica")} value={formatCents(overview.lifetimeCommissionCents)} icon={<IconCoins />} />
            <StatCard label={t("com.totalIndicacoes")} value={overview.totalReferrals} icon={<IconUsers />} />
            <StatCard label={t("com.totalAssinaturasAtivas")} value={overview.totalActiveSubscriptions} icon={<IconUserCheck />} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <StatCard label={t("com.totalAfiliados")} value={overview.affiliateCount} icon={<IconGift />} />
            <StatCard label={t("com.pendenteDeSaque")} value={formatCents(overview.totalPendingWithdrawalCents)} icon={<IconWallet />} />
          </div>
        </>
      )}
    </div>
  )
}

function AffiliatesTab() {
  const t = useT()
  const [affiliates, setAffiliates] = useState<AdminAffiliate[] | null>(null)
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [savingId, setSavingId] = useState<number | null>(null)

  async function load() {
    const res = await api.get<AdminAffiliatesResponse>("/api/admin/commissions/affiliates")
    setAffiliates(res.affiliates)
  }

  useEffect(() => {
    load()
  }, [])

  function draftFor(a: AdminAffiliate) {
    return drafts[a.userId] ?? (a.commissionPercentOverride !== null ? String(a.commissionPercentOverride) : "")
  }

  async function savePercent(a: AdminAffiliate) {
    const raw = draftFor(a).trim()
    const percent = raw === "" ? null : Number(raw)
    if (percent !== null && (Number.isNaN(percent) || percent < 0 || percent > 100)) return
    setSavingId(a.userId)
    try {
      await api.put(`/api/admin/commissions/affiliates/${a.userId}/percent`, { percent })
      await load()
    } finally {
      setSavingId(null)
    }
  }

  if (!affiliates) return <Skeleton className="h-64" />

  return (
    <Card>
      <CardContent className="pt-6">
        {affiliates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("com.nenhumaIndicacaoAinda")}</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>{t("com.tabelaAfiliado")}</TableHead>
                <TableHead>{t("com.indicacoes")}</TableHead>
                <TableHead>{t("com.assinaturasAtivas")}</TableHead>
                <TableHead>{t("com.comissaoTotal")}</TableHead>
                <TableHead>{t("com.saldoDisponivel")}</TableHead>
                <TableHead>{t("com.percentualIndividual")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {affiliates.map((a) => (
                <TableRow key={a.userId}>
                  <TableCell className="font-medium">{a.businessName || a.email}</TableCell>
                  <TableCell>{a.referralCount}</TableCell>
                  <TableCell>{a.activeSubscriptionCount}</TableCell>
                  <TableCell className="tabular-nums">{formatCents(a.totalEarnedCents)}</TableCell>
                  <TableCell className="tabular-nums">{formatCents(a.balanceAvailableCents)}</TableCell>
                  <TableCell>
                    <Input
                      type="number"
                      min={0}
                      max={100}
                      step={0.5}
                      placeholder={t("com.usaPadrao")}
                      value={draftFor(a)}
                      disabled={savingId === a.userId}
                      onChange={(e) => setDrafts((d) => ({ ...d, [a.userId]: e.target.value }))}
                      onBlur={() => savePercent(a)}
                      className="w-24"
                    />
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}

function WithdrawalsTab() {
  const t = useT()
  const [status, setStatus] = useState<WithdrawalStatus | "todos">("pendente")
  const [withdrawals, setWithdrawals] = useState<AdminWithdrawal[] | null>(null)
  const [notes, setNotes] = useState<Record<number, string>>({})
  const [busyId, setBusyId] = useState<number | null>(null)

  async function load() {
    const qs = status === "todos" ? "" : `?status=${status}`
    const res = await api.get<AdminWithdrawalsResponse>(`/api/admin/commissions/withdrawals${qs}`)
    setWithdrawals(res.withdrawals)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status])

  async function resolve(id: number, action: "approve" | "reject") {
    setBusyId(id)
    try {
      await api.post(`/api/admin/commissions/withdrawals/${id}/${action}`, { note: notes[id] || undefined })
      await load()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Select value={status} onValueChange={(v) => setStatus(v as WithdrawalStatus | "todos")}>
        <SelectTrigger size="sm" className="w-48">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="pendente">{t("com.statusPendente")}</SelectItem>
          <SelectItem value="pago">{t("com.statusPago")}</SelectItem>
          <SelectItem value="recusado">{t("com.statusRecusado")}</SelectItem>
          <SelectItem value="todos">{t("com.todosOsStatus")}</SelectItem>
        </SelectContent>
      </Select>

      {!withdrawals ? (
        <Skeleton className="h-48" />
      ) : withdrawals.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {status === "pendente" ? t("com.nenhumSaquePendente") : t("com.nenhumSaqueComEsseStatus")}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {withdrawals.map((w) => (
            <Card key={w.id}>
              <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-medium">{w.businessName || w.email}</p>
                  <p className="text-sm text-muted-foreground">
                    {formatCents(w.amountCents)} · {w.pixKeyType.toUpperCase()}: {w.pixKey} · {formatarData(w.requestedAt)}
                  </p>
                  {w.adminNote && <p className="mt-1 text-xs text-muted-foreground">{w.adminNote}</p>}
                </div>
                <div className="flex items-center gap-2">
                  <TonePill tone={WITHDRAWAL_TONE[w.status]}>{t(WITHDRAWAL_LABEL[w.status])}</TonePill>
                  {w.status === "pendente" && (
                    <>
                      <Input
                        placeholder={t("com.observacaoOpcional")}
                        className="h-8 w-40 text-xs"
                        value={notes[w.id] || ""}
                        onChange={(e) => setNotes((n) => ({ ...n, [w.id]: e.target.value }))}
                      />
                      <Button size="sm" variant="outline" disabled={busyId === w.id} onClick={() => resolve(w.id, "reject")}>
                        {t("com.recusar")}
                      </Button>
                      <Button size="sm" disabled={busyId === w.id} onClick={() => resolve(w.id, "approve")}>
                        {t("com.aprovar")}
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

function LinksTab() {
  const t = useT()
  const [links, setLinks] = useState<AdminAffiliateLink[] | null>(null)
  const [code, setCode] = useState("")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await api.get<AdminAffiliateLinksResponse>("/api/admin/commissions/links")
    setLinks(res.links)
  }

  useEffect(() => {
    load()
  }, [])

  async function createLink() {
    setBusy(true)
    setError(null)
    try {
      await api.post("/api/admin/commissions/links", { code, label })
      setCode("")
      setLabel("")
      await load()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t("comum.erroGenerico"))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardHeader>
          <CardDescription>{t("com.meusLinksDescricao")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="linkCode">{t("com.codigoDoLink")}</FieldLabel>
              <Input id="linkCode" placeholder={t("com.codigoDoLinkPlaceholder")} value={code} onChange={(e) => setCode(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="linkLabel">{t("com.rotuloDoLink")}</FieldLabel>
              <Input id="linkLabel" placeholder={t("com.rotuloDoLinkPlaceholder")} value={label} onChange={(e) => setLabel(e.target.value)} />
            </Field>
          </div>
          <Button size="sm" className="w-fit" disabled={busy || !code} onClick={createLink}>
            {busy ? t("com.criandoLink") : t("com.criarLink")}
          </Button>
        </CardContent>
      </Card>

      {!links ? (
        <Skeleton className="h-32" />
      ) : links.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t("com.nenhumLinkAinda")}</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>{t("com.rotuloDoLink")}</TableHead>
              <TableHead>{t("com.codigoDoLink")}</TableHead>
              <TableHead>{t("com.indicacoes")}</TableHead>
              <TableHead>{t("com.assinaturasAtivas")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {links.map((l) => (
              <TableRow key={l.id}>
                <TableCell className="font-medium">{l.label || "—"}</TableCell>
                <TableCell className="font-mono text-xs">{l.code}</TableCell>
                <TableCell>{l.referralCount}</TableCell>
                <TableCell>{l.activeCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  )
}

function SettingsTab() {
  const t = useT()
  const [settings, setSettings] = useState<AffiliateSettings | null>(null)
  const [percentDraft, setPercentDraft] = useState("")
  const [minWithdrawDraft, setMinWithdrawDraft] = useState("")
  const [maxMonthsDraft, setMaxMonthsDraft] = useState("")
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    api.get<AffiliateSettings>("/api/admin/commissions/settings").then((s) => {
      setSettings(s)
      setPercentDraft(String(s.percentDefault))
      setMinWithdrawDraft((s.minWithdrawCents / 100).toFixed(2))
      setMaxMonthsDraft(String(s.maxMonths))
    })
  }, [])

  async function save() {
    setBusy(true)
    setSaved(false)
    try {
      const res = await api.put<AffiliateSettings>("/api/admin/commissions/settings", {
        percentDefault: Number(percentDraft),
        minWithdrawCents: Math.round(Number(minWithdrawDraft) * 100),
        maxMonths: Number(maxMonthsDraft),
      })
      setSettings(res)
      setSaved(true)
    } finally {
      setBusy(false)
    }
  }

  if (!settings) return <Skeleton className="h-64" />

  return (
    <Card>
      <CardContent className="flex flex-col gap-4 pt-6">
        {saved && <p className="text-sm text-status-posted">{t("com.configuracoesSalvas")}</p>}
        <Field>
          <FieldLabel htmlFor="percentDefault">{t("com.configPercentualPadrao")}</FieldLabel>
          <Input
            id="percentDefault"
            type="number"
            min={0}
            max={100}
            step={0.5}
            className="w-32"
            value={percentDraft}
            onChange={(e) => setPercentDraft(e.target.value)}
          />
          <FieldDescription>{t("com.configPercentualPadraoDescricao")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="minWithdraw">{t("com.configSaqueMinimo")}</FieldLabel>
          <Input
            id="minWithdraw"
            type="number"
            min={0}
            step={0.01}
            className="w-32"
            value={minWithdrawDraft}
            onChange={(e) => setMinWithdrawDraft(e.target.value)}
          />
          <FieldDescription>{t("com.configSaqueMinimoDescricao")}</FieldDescription>
        </Field>
        <Field>
          <FieldLabel htmlFor="maxMonths">{t("com.configTetoMeses")}</FieldLabel>
          <Input
            id="maxMonths"
            type="number"
            min={0}
            className="w-32"
            value={maxMonthsDraft}
            onChange={(e) => setMaxMonthsDraft(e.target.value)}
          />
          <FieldDescription>
            {t("com.configTetoMesesDescricao")} {maxMonthsDraft === "0" && `(${t("com.semLimite")})`}
          </FieldDescription>
        </Field>
        <Button className="w-fit" disabled={busy} onClick={save}>
          {t("com.salvarConfiguracoes")}
        </Button>
      </CardContent>
    </Card>
  )
}

export function AdminCommissionsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("com.adminTitulo")}>
      <PageHeader title={t("com.adminTitulo")} description={t("com.adminDescricao")} />

      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">{t("com.abaVisaoGeral")}</TabsTrigger>
          <TabsTrigger value="affiliates">{t("com.abaAfiliados")}</TabsTrigger>
          <TabsTrigger value="withdrawals">{t("com.abaSaques")}</TabsTrigger>
          <TabsTrigger value="links">{t("com.abaMeusLinks")}</TabsTrigger>
          <TabsTrigger value="settings">{t("com.abaConfiguracoes")}</TabsTrigger>
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="affiliates">
          <AffiliatesTab />
        </TabsContent>
        <TabsContent value="withdrawals">
          <WithdrawalsTab />
        </TabsContent>
        <TabsContent value="links">
          <LinksTab />
        </TabsContent>
        <TabsContent value="settings">
          <SettingsTab />
        </TabsContent>
      </Tabs>
    </DashboardLayout>
  )
}
