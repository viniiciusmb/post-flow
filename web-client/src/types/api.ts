export type UserRole = "admin" | "client"

export interface SessionUser {
  id: number
  email: string
  role: UserRole
}

export type DateRangeKey = "today" | "yesterday" | "last7days" | "this_month" | "last_month"

export interface RangeInfo {
  key: DateRangeKey
  since: string
  until: string
}

export type PostingStatus =
  | "pending"
  | "queued"
  | "processing"
  | "posted"
  | "error"

export type PostingOrigin = "drive_general" | "drive_client" | "youtube_clip"

export interface AdminPosting {
  id: number
  clientName: string
  filename: string
  status: PostingStatus
  origin: PostingOrigin
  channelName: string | null
  tiktokDisplayName: string | null
  errorMessage: string | null
  createdAt: string
}

export interface AdminDashboardResponse {
  range: RangeInfo
  counts: {
    clients: number
    postings: number
    youtubeChannels: number
    videosInProgress: number
    clipsInRange: number
  }
  postings: AdminPosting[]
}

export interface AdminPostingsResponse {
  range: RangeInfo
  postings: AdminPosting[]
}

export interface AdminClient {
  id: number
  businessName: string | null
  email: string
  isActive: boolean
  createdAt: string
  channelCount: number
  tiktokConnected: boolean
  tiktokDisplayName: string | null
}

export interface AdminClientsResponse {
  clients: AdminClient[]
}

export interface ClientPosting {
  id: number
  filename: string
  status: PostingStatus
  origin: PostingOrigin
  channelName: string | null
  updatedAt: string
}

export interface AdminMetricsResponse {
  range: RangeInfo
  clients: { active: number; inactive: number }
  volume: {
    videosDetected7d: number
    videosDetected30d: number
    clipsGenerated30d: number
    clipsPosted30d: number
    aproveitamentoRate: number | null
  }
  ranking: { name: string; videosCount: number }[]
  pipeline: {
    errorRate30d: number
    totalFinished30d: number
    avgProcessingSeconds: number | null
    avgQueueWaitSeconds: number | null
    queueDepth: number
  }
  cost: {
    whisperCostUsd7d: number
    claudeCostUsd7d: number
    totalCostUsd7d: number
    avgCostPerVideo30d: number | null
    projectedMonthlyUsd: number
  }
  services: { name: string; lastHeartbeatAt: string; isUp: boolean }[]
  selected: {
    videosDetected: number
    clipsGenerated: number
    clipsPosted: number
    aproveitamentoRate: number | null
    errorRate: number
    totalFinished: number
    avgProcessingSeconds: number | null
    totalCostUsd: number
    avgCostPerVideo: number | null
    ranking: { name: string; videosCount: number }[]
  }
}

export interface ClientUsageResponse {
  range: RangeInfo
  videosInRange: number
  minutesInRange: number
  history: { date: string; videosCount: number }[]
}

export interface TikTokAccountStats {
  followerCount: number | null
  followingCount: number | null
  likesCount: number | null
  videoCount: number | null
  statsUpdatedAt: string | null
}

export type TikTokAccountResponse =
  | ({ connected: true; displayName: string; avatarUrl: string | null; connectedAt: string; autoPostEnabled: boolean } & TikTokAccountStats)
  | { connected: false }

export interface ClientDashboardResponse {
  range: RangeInfo
  tiktokAccount:
    | ({ connected: true; displayName: string; avatarUrl: string | null } & TikTokAccountStats)
    | { connected: false }
  counts: {
    youtubeChannels: number
    videosThisMonth: number
    videosInRange: number
    clipsInRange: number
    clipsPostedInRange: number
  }
  postings: ClientPosting[]
}

export interface DriveStatusResponse {
  connected: boolean
  googleAccountEmail: string | null
  folder: { id: string; name: string | null; lastPolledAt: string | null } | null
}

export type VideoAspectRatio = "9:16" | "1:1" | "16:9" | "4:5"
export type VideoFraming = "crop" | "blur_pad"
export type VideoQuality = "high" | "medium"
export type VideoCaptionStyle = "classic" | "bold" | "minimal" | "none"
export type VideoClipLength = "short" | "balanced" | "long"
export type VideoClipMode = "best_parts" | "full_video" | "unlimited"

export interface ClientVideoSettings {
  aspectRatio: VideoAspectRatio
  framing: VideoFraming
  quality: VideoQuality
  captionStyle: VideoCaptionStyle
  clipLength: VideoClipLength
  clipMode: VideoClipMode
  maxClips: number
}

export interface ClientVideoSettingsResponse extends ClientVideoSettings {
  options: {
    aspectRatios: VideoAspectRatio[]
    framings: VideoFraming[]
    qualities: VideoQuality[]
    captionStyles: VideoCaptionStyle[]
    clipLengths: VideoClipLength[]
    clipModes: VideoClipMode[]
  }
}

export interface YoutubeChannel {
  id: number
  channelName: string | null
  channelUrl: string
  avatarUrl: string | null
  isActive: boolean
  lastPolledAt: string | null
}

export type SourceVideoStatus =
  | "detected"
  | "downloading"
  | "transcribing"
  | "selecting_clips"
  | "cutting"
  | "ready"
  | "error"

export interface SourceVideo {
  id: number
  title: string
  thumbnailUrl: string | null
  channelId: number | null
  channelName: string | null
  publishedAt: string | null
  durationSeconds: number | null
  status: SourceVideoStatus
  errorMessage: string | null
  clipCount: number
  processingStartedAt: string | null
}

export interface SourceVideosResponse {
  avgProcessingSeconds: number
  videos: SourceVideo[]
}

export type ClipStatus = "pending" | "rendering" | "ready" | "error"

export interface Clip {
  id: number
  title: string
  startSeconds: number
  endSeconds: number
  status: ClipStatus
  errorMessage: string | null
}
