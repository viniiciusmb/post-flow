import { useEffect, useState } from "react"
import { IconUsers, IconListDetails, IconBrandYoutube, IconClockHour4, IconScissors } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
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

  if (authLoading || !user) return null

  const rows: PostingRow[] =
    data?.postings.map((p) => ({
      id: p.id,
      filename: p.filename,
      status: p.status,
      date: p.createdAt,
      clientName: p.clientName,
      origin: p.origin,
    })) ?? []

  return (
    <DashboardLayout user={user} onLogout={logout} title="Painel do Admin">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {data ? (
          <>
            <StatCard
              label="Clientes cadastrados"
              value={data.counts.clients}
              icon={<IconUsers />}
              tone="indigo"
              href="/admin/clients"
              hrefLabel="Ver clientes"
            />
            <StatCard
              label="Postagens registradas"
              value={data.counts.postings}
              icon={<IconListDetails />}
              tone="cyan"
              href="/admin/postings"
              hrefLabel="Ver postagens"
            />
            <StatCard
              label="Canais monitorados"
              value={data.counts.youtubeChannels}
              icon={<IconBrandYoutube />}
              tone="danger"
            />
            <StatCard
              label="Vídeos na fila"
              value={data.counts.videosInProgress}
              icon={<IconClockHour4 />}
              tone="violet"
              href="/admin/queue"
              hrefLabel="Ver fila"
            />
            <StatCard
              label="Cortes gerados hoje"
              value={data.counts.clipsToday}
              icon={<IconScissors />}
              tone="success"
            />
          </>
        ) : (
          <>
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
            <Skeleton className="h-24" />
          </>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Postagens recentes</h2>
        {data ? (
          <PostingsTable
            rows={rows}
            showClient
            showOrigin
            emptyMessage="Nenhuma postagem ainda. Isso vai aparecer aqui assim que a integracao com Drive e TikTok estiver ativa."
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </DashboardLayout>
  )
}
