import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import type { DateRangeKey } from "@/types/api"
import { useT, type ChaveDeTraducao } from "@/i18n"

// Guarda a CHAVE, não o texto: este array é montado uma vez quando o módulo
// carrega, antes de existir idioma escolhido.
const OPTIONS: { key: DateRangeKey; label: ChaveDeTraducao }[] = [
  { key: "today", label: "comum.hoje" },
  { key: "yesterday", label: "comum.ontem" },
  { key: "last7days", label: "periodo.ultimos7" },
  { key: "this_month", label: "periodo.esteMes" },
  { key: "last_month", label: "periodo.mesPassado" },
]

// Opções que só algumas telas querem. "Máximo" e "Personalizado" fazem
// sentido num relatório de custo por cliente, e não num painel de "como foi
// meu dia" - por isso entram por escolha de quem usa o componente, em vez de
// aparecerem em todos os dashboards de uma vez.
const EXTRAS: Record<string, ChaveDeTraducao> = {
  all: "periodo.maximo",
  custom: "periodo.personalizado",
}

export function DateRangeFilter({
  value,
  onChange,
  extras = [],
}: {
  value: DateRangeKey
  onChange: (range: DateRangeKey) => void
  extras?: DateRangeKey[]
}) {
  const t = useT()
  const opcoes = [
    ...OPTIONS,
    ...extras.filter((k) => EXTRAS[k]).map((k) => ({ key: k, label: EXTRAS[k] })),
  ]
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
        {opcoes.map((o) => (
          <ToggleGroupItem key={o.key} value={o.key} className="shrink-0 text-xs">
            {t(o.label)}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  )
}
