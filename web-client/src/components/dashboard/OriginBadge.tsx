import { IconBrandGoogleDrive, IconBrandYoutube } from "@tabler/icons-react"
import { TonePill } from "@/components/ui/tone-pill"
import { ORIGIN_LABEL } from "@/lib/statusTones"
import type { PostingOrigin } from "@/types/api"
import { useT } from "@/i18n"

export function OriginBadge({ origin }: { origin: PostingOrigin }) {
  const t = useT()
  const isYoutube = origin === "youtube_clip"
  return (
    <TonePill tone={isYoutube ? "danger" : "success"} dot={false} icon={
      isYoutube ? <IconBrandYoutube className="size-3.5" /> : <IconBrandGoogleDrive className="size-3.5" />
    }>
      {t(ORIGIN_LABEL[origin])}
    </TonePill>
  )
}
