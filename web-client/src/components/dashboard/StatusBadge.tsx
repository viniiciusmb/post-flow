import { cn } from "@/lib/utils"
import type { PostingStatus } from "@/types/api"

const STATUS_LABEL: Record<PostingStatus, string> = {
  pending: "pending",
  queued: "queued",
  processing: "processing",
  posted: "posted",
  error: "error",
}

const STATUS_DOT: Record<PostingStatus, string> = {
  pending: "bg-status-pending",
  queued: "bg-status-queued",
  processing: "bg-status-processing",
  posted: "bg-status-posted",
  error: "bg-status-error",
}

export function StatusBadge({ status }: { status: PostingStatus }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-secondary px-2.5 py-0.5 text-xs font-medium text-secondary-foreground">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {STATUS_LABEL[status]}
    </span>
  )
}
