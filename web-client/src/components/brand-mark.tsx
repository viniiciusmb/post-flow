import { cn } from "@/lib/utils"

export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "relative flex shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-600 to-cyan-500",
        className,
      )}
    >
      <svg viewBox="0 0 24 24" className="h-1/2 w-1/2" fill="none">
        <rect x="10.2" y="4" width="2.4" height="12" rx="1.2" transform="rotate(18 11.4 10)" fill="white" />
        <rect x="13.4" y="4" width="2.4" height="12" rx="1.2" transform="rotate(-18 14.6 10)" fill="white" />
      </svg>
    </div>
  )
}
