import type { ReactNode } from "react"

/**
 * Cabeçalho de página do painel.
 *
 * Antes cada tela começava direto no primeiro cartão, e a única pista de onde
 * você estava era o título minúsculo na barra do topo. O resultado é uma tela
 * que abre "no meio do assunto": sem uma frase dizendo o que dá pra fazer ali,
 * e sem um lugar óbvio pra ação principal, que acabava perdida no meio dos
 * cartões.
 *
 * Este bloco resolve os três de uma vez: nome da tela, uma linha explicando, e
 * a ação principal alinhada à direita. É o padrão de Stripe, Linear e do
 * console da própria Apple, e é o que faz uma sequência de telas parecer um
 * produto só em vez de páginas soltas.
 */
export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3 pb-1">
      <div className="min-w-0">
        <h1 className="font-heading text-xl font-semibold tracking-[-0.02em]">{title}</h1>
        {description && (
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {action && <div className="flex shrink-0 items-center gap-2">{action}</div>}
    </div>
  )
}

/**
 * Divisor de assunto dentro de uma tela longa.
 *
 * Uma linha fina com um rótulo pequeno separa melhor que empilhar mais um
 * cartão com borda: o olho entende que mudou de assunto sem que a tela ganhe
 * mais uma moldura.
 */
export function SectionLabel({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-end justify-between gap-4 border-b pb-2">
      <h2 className="text-xs font-semibold uppercase tracking-[0.07em] text-muted-foreground">
        {children}
      </h2>
      {action}
    </div>
  )
}
