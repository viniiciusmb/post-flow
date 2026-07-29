import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DateRangeKey } from "@/types/api"

const OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: "today", label: "Hoje" },
  { key: "yesterday", label: "Ontem" },
  { key: "last7days", label: "Últimos 7 dias" },
  { key: "this_month", label: "Este mês" },
  { key: "last_month", label: "Mês passado" },
]

export function DateRangeFilter({
  value,
  onChange,
}: {
  value: DateRangeKey
  onChange: (range: DateRangeKey) => void
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={value}
      onValueChange={(next) => next && onChange(next as DateRangeKey)}
      className="flex-wrap"
    >
      {OPTIONS.map((o) => (
        <ToggleGroupItem key={o.key} value={o.key} className="text-xs">
          {o.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
