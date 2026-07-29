import { useEffect, useState } from "react"
import { AppShell } from "@/components/shell/AppShell"
import { StatCard } from "@/components/dashboard/StatCard"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import type { AdminDashboardResponse } from "@/types/api"

export function AdminDashboardPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [data, setData] = useState<AdminDashboardResponse | null>(null)

  useEffect(() => {
    if (!user) return
    api.get<AdminDashboardResponse>("/api/admin/dashboard").then(setData)
  }, [user])

  if (authLoading) return null

  const rows: PostingRow[] =
    data?.postings.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      date: p.createdAt,
      clientName: p.clientName,
    })) ?? []

  return (
    <AppShell user={user} onLogout={logout} title="Painel do Admin">
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        {data ? (
          <>
            <StatCard label="Clientes cadastrados" value={data.counts.clients} />
            <StatCard label="Postagens registradas" value={data.counts.postings} />
          </>
        ) : (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        )}
      </div>

      <h2 className="mb-3 text-sm font-medium text-muted-foreground">Postagens recentes</h2>
      {data ? (
        <PostingsTable
          rows={rows}
          showClient
          emptyMessage="Nenhuma postagem ainda. Isso vai aparecer aqui assim que a integracao com Drive e TikTok estiver ativa."
        />
      ) : (
        <Skeleton className="h-64" />
      )}
    </AppShell>
  )
}
