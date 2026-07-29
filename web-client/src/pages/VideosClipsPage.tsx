import { useEffect, useState } from "react"
import { IconChevronDown, IconChevronRight } from "@tabler/icons-react"
import { DashboardLayout } from "@/components/dashboard/DashboardLayout"
import { Card, CardContent } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { TonePill } from "@/components/ui/tone-pill"
import { useAuth } from "@/hooks/useAuth"
import { api } from "@/lib/api"
import { CLIP_STATUS_TONE, SOURCE_VIDEO_STATUS_TONE } from "@/lib/statusTones"
import type { Clip, SourceVideo } from "@/types/api"

function formatDuration(seconds: number | null) {
  if (!seconds) return "—"
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return `${m}:${String(s).padStart(2, "0")}`
}

function VideoRow({ video }: { video: SourceVideo }) {
  const [open, setOpen] = useState(false)
  const [clips, setClips] = useState<Clip[] | null>(null)

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && !clips) {
      const data = await api.get<{ clips: Clip[] }>(`/api/client/source-videos/${video.id}/clips`)
      setClips(data.clips)
    }
  }

  return (
    <Card>
      <button
        type="button"
        onClick={toggle}
        className="flex w-full items-center gap-4 p-4 text-left"
        disabled={video.clipCount === 0 && video.status !== "ready"}
      >
        {video.clipCount > 0 || video.status === "ready" ? (
          open ? (
            <IconChevronDown className="size-4 shrink-0 text-muted-foreground" />
          ) : (
            <IconChevronRight className="size-4 shrink-0 text-muted-foreground" />
          )
        ) : (
          <span className="size-4 shrink-0" />
        )}

        {video.thumbnailUrl && (
          <img src={video.thumbnailUrl} alt="" className="h-12 w-20 shrink-0 rounded-md object-cover" />
        )}

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{video.title}</p>
          <p className="text-xs text-muted-foreground">
            {video.channelName} · {formatDuration(video.durationSeconds)}
            {video.publishedAt && ` · ${new Date(video.publishedAt).toLocaleDateString("pt-BR")}`}
          </p>
        </div>

        <TonePill tone={SOURCE_VIDEO_STATUS_TONE[video.status].tone} spin={SOURCE_VIDEO_STATUS_TONE[video.status].spin}>
          {SOURCE_VIDEO_STATUS_TONE[video.status].label}
        </TonePill>
      </button>

      {video.errorMessage && (
        <p className="border-t border-border px-4 py-2 text-xs text-destructive">{video.errorMessage}</p>
      )}

      {open && (
        <CardContent className="border-t border-border pt-4">
          {!clips ? (
            <Skeleton className="h-16" />
          ) : clips.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum corte gerado ainda.</p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {clips.map((clip) => (
                <div key={clip.id} className="rounded-lg border border-border p-3">
                  <p className="mb-2 line-clamp-2 text-sm font-medium">{clip.title}</p>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      {formatDuration(clip.endSeconds - clip.startSeconds)}
                    </span>
                    <TonePill tone={CLIP_STATUS_TONE[clip.status].tone} spin={CLIP_STATUS_TONE[clip.status].spin} className="px-2 py-0.5 text-[10px]">
                      {CLIP_STATUS_TONE[clip.status].label}
                    </TonePill>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  )
}

export function VideosClipsPage() {
  const { user, loading: authLoading, logout } = useAuth()
  const [videos, setVideos] = useState<SourceVideo[] | null>(null)

  useEffect(() => {
    if (!user) return
    api.get<{ videos: SourceVideo[] }>("/api/client/source-videos").then((data) => setVideos(data.videos))
  }, [user])

  if (authLoading || !user) return null

  return (
    <DashboardLayout user={user} onLogout={logout} title="Vídeos & Cortes">
      {!videos ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      ) : videos.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
          Nenhum video detectado ainda. Cadastre um canal em "Canais do YouTube" pra comecar.
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {videos.map((video) => (
            <VideoRow key={video.id} video={video} />
          ))}
        </div>
      )}
    </DashboardLayout>
  )
}
