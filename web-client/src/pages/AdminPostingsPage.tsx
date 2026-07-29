import { useEffect, useState } from "react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Input } from "@/components/ui/input"
import { Skeleton } from "@/components/ui/skeleton"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminPostingsResponse } from "@/types/api"

export function AdminPostingsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [rows, setRows] = useState<PostingRow[] | null>(null)
  const [search, setSearch] = useState("")

  useEffect(() => {
    if (!user) return
    api.get<AdminPostingsResponse>("/api/admin/postings").then((data) =>
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
  }, [user])

  if (authLoading || !user) return null

  const filtered = rows?.filter((r) => {
    const q = search.toLowerCase()
    return r.filename.toLowerCase().includes(q) || (r.clientName ?? "").toLowerCase().includes(q)
  })

  return (
    <DashboardLayout user={user} onLogout={logout} title="Postagens">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-foreground">Todas as postagens, de todos os clientes.</p>
        <Input
          placeholder="Buscar postagem..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-60"
        />
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
              ? "Nenhuma postagem ainda."
              : "Nenhuma postagem encontrada pra essa busca."
          }
        />
      )}
    </DashboardLayout>
  )
}
