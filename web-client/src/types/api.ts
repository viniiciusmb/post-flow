export type UserRole = "admin" | "client"

export interface SessionUser {
  id: number
  email: string
  role: UserRole
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
  counts: {
    clients: number
    postings: number
    youtubeChannels: number
    videosInProgress: number
    clipsToday: number
  }
  postings: AdminPosting[]
}

export interface AdminPostingsResponse {
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
}

export interface ClientUsageResponse {
  videosThisMonth: number
  minutesThisMonth: number
  history: { date: string; videosCount: number }[]
}

export type TikTokAccountResponse =
  | { connected: true; displayName: string; avatarUrl: string | null; connectedAt: string }
  | { connected: false }

export interface ClientDashboardResponse {
  tiktokAccount: { connected: true; displayName: string } | { connected: false }
  counts: {
    youtubeChannels: number
    videosThisMonth: number
    clipsThisMonth: number
    clipsPostedThisMonth: number
  }
  postings: ClientPosting[]
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
  channelName: string | null
  publishedAt: string | null
  durationSeconds: number | null
  status: SourceVideoStatus
  errorMessage: string | null
  clipCount: number
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
