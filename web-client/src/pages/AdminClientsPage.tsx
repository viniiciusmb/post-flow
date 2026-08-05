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
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminClient, AdminClientsResponse } from "@/types/api"

function initials(name: string) {
  return name.slice(0, 2).toUpperCase()
}

export function AdminClientsPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const [clients, setClients] = useState<AdminClient[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!user) return
    api.get<AdminClientsResponse>("/api/admin/clients").then((data) => setClients(data.clients))
  }, [user])

  if (authLoading || !user) return null

  const filtered = clients?.filter((c) => {
    const q = search.toLowerCase()
    return (c.businessName ?? "").toLowerCase().includes(q) || c.email.toLowerCase().includes(q)
  })

  return (
    <DashboardLayout user={user} onLogout={logout} title={t("menu.clientes")}>
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">{t("adm.clientesDescricao")}</p>
        <Input
          placeholder={t("adm.buscarCliente")}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-60"
        />
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
                <TableHead>{t("tabela.cliente")}</TableHead>
                <TableHead>{t("pub.contaTikTok")}</TableHead>
                <TableHead className="text-center">{t("adm.canaisDoYoutube")}</TableHead>
                <TableHead>{t("adm.cadastradoEm")}</TableHead>
                <TableHead>Status</TableHead>
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
                  <TableCell>
                    <TonePill tone={c.isActive ? "success" : "neutral"}>
                      {c.isActive ? "Ativo" : "Inativo"}
                    </TonePill>
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
