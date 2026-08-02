import type { ReactNode } from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Tone } from "@/components/ui/tone-pill"

/**
 * Cartão de número do painel.
 *
 * O ícone era um quadradinho colorido, com uma cor diferente por cartão. Cinco
 * deles lado a lado viravam uma fileira de confete: a cor não significava nada
 * (não indicava bom nem ruim), só disputava atenção com o número, que é a
 * única coisa que a pessoa vem ler aqui.
 *
 * Agora o ícone é discreto e o número fica com todo o contraste. Cor neste
 * sistema é sinal, não enfeite: aparece em pílula de status e em alerta, onde
 * de fato quer dizer alguma coisa.
 */
export function StatCard({
  label,
  value,
  icon,
  href,
  hrefLabel,
}: {
  label: string
  value: number | string
  icon?: ReactNode
  /** Mantido por compatibilidade com as chamadas existentes; não pinta mais nada. */
  tone?: Tone
  href?: string
  hrefLabel?: string
}) {
  return (
    <Card className="@container/card gap-3">
      <CardHeader className="gap-2">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="font-heading text-3xl font-semibold tabular-nums">
              {value}
            </CardTitle>
            <CardDescription className="mt-1">{label}</CardDescription>
          </div>
          {icon && <div className="mt-1 text-muted-foreground/50 [&_svg]:size-4">{icon}</div>}
        </div>
        {href && (
          <a
            href={href}
            className="mt-1 inline-flex w-fit items-center gap-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          >
            {hrefLabel ?? "Ver mais"}
            <span aria-hidden="true">&rarr;</span>
          </a>
        )}
      </CardHeader>
    </Card>
  )
}
