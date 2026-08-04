import { TonePill } from "@/components/ui/tone-pill"
import { POSTING_STATUS_TONE } from "@/lib/statusTones"
import type { PostingStatus } from "@/types/api"
import { useT } from "@/i18n"

export function StatusBadge({ status }: { status: PostingStatus }) {
  const t = useT()
  const { tone, label, spin } = POSTING_STATUS_TONE[status]
  return (
    <TonePill tone={tone} spin={spin}>
      {t(label)}
    </TonePill>
  )
}
