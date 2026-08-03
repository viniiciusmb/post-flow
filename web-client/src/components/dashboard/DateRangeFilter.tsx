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
    // No celular os 5 botões não cabem numa linha. Deixar quebrar linha ficava
    // feio de um jeito específico: este controle junta as bordas dos vizinhos
    // (só o primeiro e o último têm canto arredondado), então o botão que
    // começava a segunda linha aparecia com o canto reto, solto, parecendo
    // defeito. Rolar dentro da própria faixa mantém o controle inteiro - e a
    // página continua sem rolagem lateral.
    <div className="-mx-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      <ToggleGroup
        type="single"
        variant="outline"
        value={value}
        onValueChange={(next) => next && onChange(next as DateRangeKey)}
        className="w-max flex-nowrap"
      >
        {OPTIONS.map((o) => (
          <ToggleGroupItem key={o.key} value={o.key} className="shrink-0 text-xs">
            {o.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
