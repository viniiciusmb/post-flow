import { useT } from "@/i18n"
import { useEffect, useState } from "react"
import { IconClock } from "@tabler/icons-react"
import { api } from "@/lib/api"
import type { ClientUsageResponse, DateRangeKey } from "@/types/api"

function formatDay(iso: string) {
  return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })
}

export function UsageCard({ range }: { range: DateRangeKey }) {
  const t = useT()
  const [data, setData] = useState<ClientUsageResponse | null>(null)

  useEffect(() => {
    api.get<ClientUsageResponse>(`/api/client/usage?range=${range}`).then(setData)
  }, [range])

  if (!data) return null

  const activeDays = data.history.filter((h) => h.videosCount > 0).slice(0, 7)

  return (
    // Barra fina, sem moldura própria. O número de vídeos detectados saiu daqui
    // porque já aparece na fileira logo acima: repetir o mesmo dado a 10cm de
    // distância só faz a pessoa conferir duas vezes se são a mesma coisa.
    <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-xl bg-card shadow-[var(--shadow-flat)] dark:border dark:border-border px-4 py-3">
      <div className="flex items-baseline gap-2">
        <IconClock className="size-3.5 self-center text-muted-foreground" />
        <span className="font-heading text-lg font-semibold tabular-nums">{data.minutesInRange}</span>
        <span className="text-xs text-muted-foreground">{t("uso.minutosProcessados")}</span>
      </div>

      {activeDays.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[0.6875rem] text-muted-foreground">
          <span className="font-medium text-foreground">Últimos 30 dias</span>
          {activeDays.map((h) => (
            <span key={h.date} className="tabular-nums">
              {formatDay(h.date)}: {h.videosCount}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
