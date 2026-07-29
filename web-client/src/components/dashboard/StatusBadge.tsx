import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import type { PostingStatus } from "@/types/api"

const STATUS_DOT: Record<PostingStatus, string> = {
  pending: "bg-status-pending",
  queued: "bg-status-queued",
  processing: "bg-status-processing",
  posted: "bg-status-posted",
  error: "bg-status-error",
}

export function StatusBadge({ status }: { status: PostingStatus }) {
  return (
    <Badge variant="outline" className="gap-1.5">
      <span className={cn("size-1.5 rounded-full", STATUS_DOT[status])} />
      {status}
    </Badge>
  )
}
