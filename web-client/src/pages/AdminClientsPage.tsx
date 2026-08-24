import { useT } from "@/i18n"
import { data } from "@/lib/formatoLocal"
import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Avatar, AvatarFallback } from "@/components/ui/avatar"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminClient, AdminClientsResponse, DateRangeKey, OrdemDeCliente } from "@/types/api"

// Dólar com 2 casas some com custos pequenos: um cliente que gerou US$ 0,004
// apareceria como "US$ 0,00", indistinguível de quem não gerou nada. Abaixo de
// um centavo mostramos mais casas.
function dinheiro(usd: number) {
  if (usd === 0) return "US$ 0,00"
  const casas = usd < 0.01 ? 4 : 2
  return `US$ ${usd.toFixed(casas).replace(".", ",")}`
}

function hoje() {
  return new Date().toISOString().slice(0, 10)
}

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function AdminClientsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [search, setSearch] = useState("")
  const [range, setRange] = useState<DateRangeKey>("all")
  const [ordem, setOrdem] = useState<OrdemDeCliente>("recentes")
  const [de, setDe] = useState(hoje())
  const [ate, setAte] = useState(hoje())

  useEffect(() => {
    if (!user) return
    setClients(null)
    const params = new URLSearchParams({ range, ordem })
    if (range === "custom") {
      params.set("since", de)
      params.set("until", ate)
    }
    api.get<AdminClientsResponse>(`/api/admin/clients?${params}`).then((data) => setClients(data.clients))
  }, [user, range, ordem, de, ate])

  if (authLoading || !user) return null

  const filtered = clients?.filter((c) => {
    const q = search.toLowerCase()
    return (c.businessName ?? "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.clientes")}>
      <p className="text-sm text-muted-foreground">{t("adm.clientesDescricao")}</p>

      {/* Os filtros ficam numa faixa que quebra linha: no celular eles descem
          um sob o outro em vez de espremer ou empurrar a página de lado. */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
            {t("adm.custoNoPeriodo")}
          </span>
          <DateRangeFilter value={range} onChange={setRange} extras={["all", "custom"]} />
        </div>

        {range === "custom" && (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="date" value={de} max={ate} onChange={(e) => setDe(e.target.value)} className="w-auto" />
            <span className="text-sm text-muted-foreground">{t("comum.ate")}</span>
            <Input type="date" value={ate} min={de} max={hoje()} onChange={(e) => setAte(e.target.value)} className="w-auto" />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Select value={ordem} onValueChange={(v) => setOrdem(v as OrdemDeCliente)}>
            <SelectTrigger className="w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recentes">{t("adm.ordemRecentes")}</SelectItem>
              <SelectItem value="antigos">{t("adm.ordemAntigos")}</SelectItem>
              <SelectItem value="maior_custo">{t("adm.ordemMaiorCusto")}</SelectItem>
            </SelectContent>
          </Select>
          <Input
            placeholder={t("adm.buscarCliente")}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-60"
          />
        </div>
      </div>

      {!clients ? (
        <Skeleton className="h-64" />
      ) : filtered && filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          {clients.length === 0
            ? t("adm.nenhumClienteCadastradoLongo")
            : t("adm.nenhumClienteEncontrado")}
        </div>
      ) : (
        <div className="rounded-lg border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                {/* Plano, custo e postados vêm logo depois do nome: são o
                    que se vem procurar aqui, e numa tabela larga a última
                    coluna fica fora da tela até alguém rolar de lado. */}
                <TableHead>{t("tabela.cliente")}</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right whitespace-nowrap">{t("adm.custoGerado")}</TableHead>
                <TableHead className="text-center whitespace-nowrap">{t("adm.cortesPostados")}</TableHead>
                <TableHead>{t("pub.contaTikTok")}</TableHead>
                <TableHead className="text-center">{t("adm.canaisDoYoutube")}</TableHead>
                <TableHead>{t("adm.cadastradoEm")}</TableHead>
                <TableHead>{t("adm.origem")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered?.map((c) => (
                <TableRow key={c.id}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      <Avatar className="size-9">
                        <AvatarFallback>{initials(c.businessName || c.email)}</AvatarFallback>
                      </Avatar>
                      <div>
                        <div className="font-medium">{c.businessName || "—"}</div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex flex-wrap items-center gap-1.5">
                      {/* Plano primeiro: é o que o admin vem procurar aqui.
                          Sem assinatura ativa aparece "Free", não em branco. */}
                      <TonePill tone={c.plano.chave === "free" ? "neutral" : "success"}>
                        {c.plano.nome}
                      </TonePill>
                      {c.plano.status === "inadimplente" && (
                        <TonePill tone="danger">{t("adm.inadimplente")}</TonePill>
                      )}
                      {!c.isActive && <TonePill tone="neutral">Inativo</TonePill>}
                    </div>
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap">
                    {dinheiro(c.custoUsd)}
                  </TableCell>
                  <TableCell className="text-center font-heading font-bold">
                    {c.clipsPosted}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                      <span
                        className={`size-1.5 rounded-full ${c.tiktokConnected ? "bg-status-posted" : "bg-muted-foreground/40"}`}
                      />
                      {c.tiktokConnected ? c.tiktokDisplayName : t("adm.naoConectado")}
                    </span>
                  </TableCell>
                  <TableCell className="text-center">
                    <a href="/admin/queue" className="font-heading font-bold text-primary hover:underline">
                      {c.channelCount}
                    </a>
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {data(c.createdAt)}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {c.origin?.referrerName ? (
                      t("adm.indicadoPor", { nome: c.origin.referrerName })
                    ) : c.origin?.affiliateLinkLabel ? (
                      c.origin.affiliateLinkLabel
                    ) : c.origin?.utmSource ? (
                      c.origin.utmSource
                    ) : (
                      t("adm.origemDireta")
                    )}
                  </TableCell>

                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </DashboardLayout>
  )
}
