import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Fileira de números do painel.
 *
 * Antes eram cinco cartões separados, cada um com borda, sombra e um ícone
 * colorido diferente. Cinco molduras lado a lado disputando atenção é o visual
 * padrão de painel de template, e a moldura não acrescenta nada: os números
 * pertencem ao mesmo assunto, então a leitura natural é uma linha só.
 *
 * Aqui é um bloco único dividido por linhas de 1px. O olho percorre a linha
 * inteira de uma vez, os números ficam alinhados na mesma base e a tela ganha
 * uma horizontal forte logo abaixo do título. É como o painel da Stripe mostra
 * saldo, cobranças e reembolsos.
 */
export function StatRow({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-2 divide-x divide-y overflow-hidden rounded-xl border bg-card sm:grid-cols-3 sm:divide-y-0 lg:grid-cols-5">
      {children}
    </div>
  )
}

export function Stat({
  label,
  value,
  hint,
  href,
  hrefLabel,
  emphasis = false,
}: {
  label: string
  value: ReactNode
  hint?: string
  href?: string
  hrefLabel?: string
  /** Destaca o número principal da linha (fica maior que os vizinhos). */
  emphasis?: boolean
}) {
  const conteudo = (
    <>
      <div
        className={cn(
          "font-heading font-semibold tabular-nums tracking-[-0.03em]",
          emphasis ? "text-[2rem] leading-none" : "text-2xl leading-none"
        )}
      >
        {value}
      </div>
      <div className="mt-2 text-xs leading-snug text-muted-foreground">{label}</div>
      {hint && <div className="mt-1 text-[0.6875rem] text-muted-foreground/70">{hint}</div>}
    </>
  )

  if (!href) {
    return <div className="px-5 py-5">{conteudo}</div>
  }

  return (
    <a
      href={href}
      aria-label={hrefLabel ?? label}
      className="group/stat block px-5 py-5 transition-colors hover:bg-muted/60"
    >
      {conteudo}
      <span className="mt-2 inline-flex items-center gap-1 text-[0.6875rem] font-medium text-muted-foreground/0 transition-colors group-hover/stat:text-muted-foreground">
        {hrefLabel ?? "Ver"}
        <span aria-hidden="true">&rarr;</span>
      </span>
    </a>
  )
}
