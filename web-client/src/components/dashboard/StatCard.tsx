import type { ReactNode } from "react"
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { Tone } from "@/components/ui/tone-pill"
import { cn } from "@/lib/utils"

const ICON_TONE_CLASS: Record<Tone, string> = {
  indigo: "bg-tone-indigo-wash text-tone-indigo-ink",
  cyan: "bg-tone-cyan-wash text-tone-cyan-ink",
  success: "bg-tone-success-wash text-tone-success-ink",
  danger: "bg-tone-danger-wash text-tone-danger-ink",
  violet: "bg-tone-violet-wash text-tone-violet-ink",
  neutral: "bg-tone-neutral-wash text-tone-neutral-ink",
}

export function StatCard({
  label,
  value,
  icon,
  tone = "indigo",
  href,
  hrefLabel,
}: {
  label: string
  value: number | string
  icon?: ReactNode
  tone?: Tone
  href?: string
  hrefLabel?: string
}) {
  return (
    <Card className="@container/card gap-3 shadow-xs">
      <CardHeader className="gap-3">
        {icon && (
          <div className={cn("flex size-8 items-center justify-center rounded-lg [&_svg]:size-4", ICON_TONE_CLASS[tone])}>
            {icon}
          </div>
        )}
        <div>
          <CardTitle className="text-2xl font-semibold tabular-nums @[250px]/card:text-3xl">
            {value}
          </CardTitle>
          <CardDescription>{label}</CardDescription>
        </div>
        {href && (
          <a href={href} className="-mt-1 text-xs font-semibold text-primary hover:underline">
            {hrefLabel ?? "Ver mais"} →
          </a>
        )}
      </CardHeader>
    </Card>
  )
}
