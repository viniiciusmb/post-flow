import { TonePill } from "@/components/ui/tone-pill"
import { POSTING_STATUS_TONE } from "@/lib/statusTones"
import type { PostingStatus } from "@/types/api"

export function StatusBadge({ status }: { status: PostingStatus }) {
  const { tone, label, spin } = POSTING_STATUS_TONE[status]
  return (
    <TonePill tone={tone} spin={spin}>
      {label}
    </TonePill>
  )
}
