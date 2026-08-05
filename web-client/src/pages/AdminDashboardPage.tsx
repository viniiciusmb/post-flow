import { useT } from "@/i18n"
import { useEffect, useState } from "react"
import { IconUsers, IconListDetails, IconBrandYoutube, IconClockHour4, IconScissors } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { StatCard } from "@/components/dashboard/StatCard"
import { PostingsTable, type PostingRow } from "@/components/dashboard/PostingsTable"
import { DateRangeFilter } from "@/components/dashboard/DateRangeFilter"
import { Skeleton } from "@/components/ui/skeleton"
import { useAuth } from "@/hooks/useAuth"
import { useDateRange } from "@/hooks/useDateRange"
import { api } from "@/lib/api"
import type { AdminDashboardResponse } from "@/types/api"

export function AdminDashboardPage() {
  const t = useT()
  const { user, loading: authLoading, logout } = useAuth()
  const { range, setRange } = useDateRange()
  const [data, setData] = useState<AdminDashboardResponse | null>(null)

  useEffect(() => {
    if (!user) return
    setData(null)
    api.get<AdminDashboardResponse>(`/api/admin/dashboard?range=${range}`).then(setData)
  }, [user, range])

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
    <DashboardLayout user={user} onLogout={logout} title={t("menu.inicio")}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-muted-foreground">{t("inicio.periodo")}</h2>
        <DateRangeFilter value={range} onChange={setRange} />
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {data ? (
          <>
            <StatCard
              label={t("adm.clientesCadastrados")}
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
              label={t("adm.canaisMonitorados")}
              value={data.counts.youtubeChannels}
              icon={<IconBrandYoutube />}
              tone="danger"
            />
            <StatCard
              label={t("adm.videosNaFila")}
              value={data.counts.videosInProgress}
              icon={<IconClockHour4 />}
              tone="violet"
              href="/admin/queue"
              hrefLabel="Ver fila"
            />
            <StatCard
              label={t("inicio.cortesGerados")}
              value={data.counts.clipsInRange}
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
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">{t("adm.postagensNoPeriodo")}</h2>
        {data ? (
          <PostingsTable
            rows={rows}
            showClient
            showOrigin
            emptyMessage={t("adm.nenhumaPostagem")}
          />
        ) : (
          <Skeleton className="h-64" />
        )}
      </div>
    </DashboardLayout>
  )
}
