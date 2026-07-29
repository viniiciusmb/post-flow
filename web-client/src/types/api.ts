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

export interface AdminPosting {
  id: number
  clientName: string
  filename: string
  status: PostingStatus
  createdAt: string
}

export interface AdminDashboardResponse {
  counts: { clients: number; postings: number }
  postings: AdminPosting[]
}

export interface ClientPosting {
  id: number
  filename: string
  status: PostingStatus
  updatedAt: string
}

export interface ClientDashboardResponse {
  tiktokAccount: { connected: true; displayName: string } | { connected: false }
  postings: ClientPosting[]
}
