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

export interface ClientPosting {
  id: number
  filename: string
  status: PostingStatus
  origin: PostingOrigin
  updatedAt: string
}

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
