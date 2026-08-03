import type { ReactNode } from "react"
import { cn } from "@/lib/utils"

export type Tone = "indigo" | "cyan" | "success" | "danger" | "violet" | "neutral"

const TONE_CLASS: Record<Tone, string> = {
  indigo: "bg-tone-indigo-wash text-tone-indigo-ink",
  cyan: "bg-tone-cyan-wash text-tone-cyan-ink",
  success: "bg-tone-success-wash text-tone-success-ink",
  danger: "bg-tone-danger-wash text-tone-danger-ink",
  violet: "bg-tone-violet-wash text-tone-violet-ink",
  neutral: "bg-tone-neutral-wash text-tone-neutral-ink",
}

export function TonePill({
  tone,
  dot = true,
  icon,
  spin = false,
  children,
  className,
}: {
  tone: Tone
  dot?: boolean
  icon?: ReactNode
  spin?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    // max-w-full + wrap: a pilha é usada tanto pra rótulo curto ("Pronto")
    // quanto pra aviso de frase inteira. Com whitespace-nowrap fixo, o aviso
    // longo virava uma faixa de 434px que empurrava a página inteira pro lado
    // no celular. O ícone/bolinha não encolhe, só o texto quebra.
    <span
      className={cn(
        "inline-flex w-fit max-w-full items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold",
        TONE_CLASS[tone],
        className,
      )}
    >
      {icon}
      {dot && !icon && (
        <span className={cn("size-1.5 shrink-0 rounded-full bg-current", spin && "animate-pulse")} />
      )}
      <span className="min-w-0">{children}</span>
    </span>
  )
}
