import { useEffect, useState } from "react"
import { IconClock } from "@tabler/icons-react"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { api } from "@/lib/api"
import type { ClientUsageResponse, DateRangeKey } from "@/types/api"

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function UsageCard({ range }: { range: DateRangeKey }) {
  const [data, setData] = useState<ClientUsageResponse | null>(null)

  useEffect(() => {
    api.get<ClientUsageResponse>(`/api/client/usage?range=${range}`).then(setData)
  }, [range])

  if (!data) return null

  const activeDays = data.history.filter((h) => h.videosCount > 0).slice(0, 7)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconClock className="size-4 text-muted-foreground" />
          Meu uso
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex gap-8">
          <div>
            <div className="font-heading text-2xl font-semibold tabular-nums">{data.minutesInRange}</div>
            <div className="text-xs text-muted-foreground">minutos de vídeo processados no período</div>
          </div>
          <div>
            <div className="font-heading text-2xl font-semibold tabular-nums">{data.videosInRange}</div>
            <div className="text-xs text-muted-foreground">vídeos detectados no período</div>
          </div>
        </div>

        {activeDays.length > 0 && (
          <div className="text-xs text-muted-foreground">
            <div className="mb-1.5 font-medium text-foreground">Últimos 30 dias</div>
            <div className="flex flex-wrap gap-x-4 gap-y-1">
              {activeDays.map((h) => (
                <span key={h.date} className="tabular-nums">
                  {formatDay(h.date)}: {h.videosCount} vídeo{h.videosCount > 1 ? "s" : ""}
                </span>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
