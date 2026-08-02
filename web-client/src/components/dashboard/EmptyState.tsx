import type { ReactNode } from "react"

/**
 * Tela vazia.
 *
 * As telas vazias eram uma caixa tracejada gigante com uma frase cinza no meio,
 * o que parece erro de carregamento. Tela vazia é convite para agir, não aviso
 * de falta: ganha um ícone discreto, uma frase que diz o que fazer e o botão
 * que faz. Sem borda tracejada, que é o desenho universal de "aqui deveria ter
 * algo e não tem".
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  compact = false,
}: {
  icon?: ReactNode
  title: string
  description?: ReactNode
  action?: ReactNode
  compact?: boolean
}) {
  return (
    <div
      className={`flex flex-col items-center justify-center rounded-xl bg-card shadow-[var(--shadow-flat)] dark:border dark:border-border text-center ${
        compact ? "px-6 py-10" : "px-6 py-16"
      }`}
    >
      {icon && (
        <div className="mb-4 flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">
          {icon}
        </div>
      )}
      <p className="font-heading text-[0.9375rem] font-semibold">{title}</p>
      {description && (
        <p className="mt-1.5 max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}
