import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { AdminPostingsResponse } from "@/types/api"

export function AdminPostingsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [rows, setRows] = useState<PostingRow[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!user) return
    setRows(null)
    api.get<AdminPostingsResponse>(`/api/admin/postings?range=${range}`).then((data) =>
      setRows(
        data.postings.map((p) => ({
          id: p.id,
          filename: p.filename,
          status: p.status,
          date: p.createdAt,
          clientName: p.clientName,
          origin: p.origin,
          channelName: p.channelName,
          tiktokDisplayName: p.tiktokDisplayName,
        }))
      )
    )
  }, [user, range])

  if (authLoading || !user) return null

  const filtered = rows?.filter((r) => {
    const q = search.toLowerCase()
    return r.filename.toLowerCase().includes(q) || (r.clientName ?? "").toLowerCase().includes(q)
  })

  return (
    <DashboardLayout user={user} onLogout={logout} title="Postagens">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Todas as postagens, de todos os clientes, no período.</p>
        <div className="flex flex-wrap items-center gap-3">
          <DateRangeFilter value={range} onChange={setRange} />
          <Input
            placeholder="Buscar postagem..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="max-w-60"
          />
        </div>
      </div>

      {!rows ? (
        <Skeleton className="h-64" />
      ) : (
        <PostingsTable
          rows={filtered ?? []}
          showClient
          showOrigin
          showChannel
          showTiktokProfile
          emptyMessage={
            rows.length === 0
              ? "Nenhuma postagem nesse período."
              : "Nenhuma postagem encontrada pra essa busca."
          }
        />
      )}
    </DashboardLayout>
  )
}
