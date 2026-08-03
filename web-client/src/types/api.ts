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
  | "skipped"

export type PostingOrigin = "drive_client" | "youtube_clip"

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
  /** Período que cada painel realmente usou (o servidor devolve a chave já validada). */
  ranges: { volume: DateRangeKey; pipeline: DateRangeKey; cost: DateRangeKey; ranking: DateRangeKey }
  clients: { active: number; inactive: number }
  volume: {
    videosDetected: number
    clipsGenerated: number
    clipsPosted: number
    aproveitamentoRate: number | null
  }
  pipeline: {
    errorRate: number
    totalFinished: number
    avgProcessingSeconds: number | null
    avgQueueWaitSeconds: number | null
    /** Retrato do instante: quantos estão na fila agora. Não tem período. */
    queueDepth: number
  }
  cost: {
    whisperCostUsd: number
    claudeCostUsd: number
    totalCostUsd: number
    avgCostPerVideo: number | null
    videosWithCost: number
    /** Sempre com base nos últimos 7 dias: seguir o filtro tornaria a projeção sem sentido. */
    projectedMonthlyUsd: number
  }
  ranking: { name: string; videosCount: number }[]
  services: { name: string; lastHeartbeatAt: string; isUp: boolean }[]
  system: {
    latest: {
      sampledAt: string
      loadAvg1m: number
      cpuCores: number
      memUsedMb: number
      memTotalMb: number
      diskUsedGb: number | null
      diskTotalGb: number | null
    } | null
    history: { sampledAt: string; loadAvg1m: number; cpuCores: number; memUsedMb: number; memTotalMb: number }[]
  }
  tunnels: { connectedClients: number }
  backup: {
    status: "ok" | "atrasado" | "erro" | "nunca"
    lastAt: string | null
    ageHours: number | null
    sizeBytes?: number | null
    detail: string | null
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

export interface TikTokAccountSummary extends TikTokAccountStats {
  id: number
  displayName: string
  avatarUrl: string | null
  connectedAt: string
  autoPostEnabled: boolean
  pendingCount: number
  postedCount: number
  errorCount: number
}

export interface TikTokAccountsResponse {
  accounts: TikTokAccountSummary[]
}

export type PostingScheduleMode = "auto" | "manual"

export interface PostingScheduleResponse {
  mode: PostingScheduleMode
  videosPerDay: number
  manualTimes: string[]
  timezone: string
  autoDeleteAfterHours: number | null
  paused: boolean
  options: { retentionPresetsHours: number[] }
}

export interface CreatorOptions {
  creatorNickname: string | null
  creatorUsername: string | null
  creatorAvatarUrl: string | null
  /** Só o que ESTA conta permite. Oferecer outro nível faz a publicação falhar. */
  privacyLevelOptions: string[]
  commentDisabled: boolean
  duetDisabled: boolean
  stitchDisabled: boolean
  maxVideoPostDurationSec: number | null
  publishMode: "inbox" | "direct"
}

export interface PostingQueueItem {
  id: number
  clipId: number
  /** false = o criador ainda não escolheu as opções; a publicação direta não sai. */
  optionsConfirmed: boolean
  privacyLevel: string | null
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandOrganicToggle: boolean
  brandContentToggle: boolean
  clipTitle: string
  caption: string | null
  thumbnailUrl: string | null
  startSeconds: number
  endSeconds: number
  createdAt: string
  scheduledFor: string | null
  channelId: number | null
  channelName: string | null
}

export interface PostedItem {
  id: number
  clipTitle: string
  thumbnailUrl: string | null
  postedAt: string
  tiktokPostId: string | null
}

export interface ErrorPostingItem {
  id: number
  clipTitle: string
  thumbnailUrl: string | null
  errorMessage: string | null
  updatedAt: string
  channelId: number | null
  channelName: string | null
}

export interface ClientDashboardResponse {
  range: RangeInfo
  tiktokAccounts: { id: number; displayName: string; avatarUrl: string | null }[]
  counts: {
    youtubeChannels: number
    videosThisMonth: number
    videosInRange: number
    clipsInRange: number
    clipsPostedInRange: number
    pendingInQueue: number
  }
  postings: ClientPosting[]
}

export interface ClientProfileResponse {
  businessName: string | null
  email: string
}

export interface DriveStatusResponse {
  connected: boolean
  googleAccountEmail: string | null
  folder: { id: string; name: string | null; lastPolledAt?: string | null; tiktokAccountIds: number[] } | null
}

export type VideoAspectRatio = "9:16" | "1:1" | "16:9" | "4:5"
export type VideoFraming = "crop" | "blur_pad"
export type VideoQuality = "high" | "medium"
export type VideoCaptionStyle = "classic" | "bold" | "minimal" | "none" | "bubble_purple" | "bubble_dark"
export type VideoClipLength = "short" | "balanced" | "long"
export type VideoClipMode = "ai_choice" | "full_video" | "fixed_count"
export type VideoDescriptionMode = "auto" | "fixed" | "none"
export type CropStyleMode = "auto" | "manual"
export type PartLabelPosition = "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right"

export interface ClientVideoSettings {
  aspectRatio: VideoAspectRatio
  framing: VideoFraming
  quality: VideoQuality
  captionStyle: VideoCaptionStyle
  clipLength: VideoClipLength
  clipMode: VideoClipMode
  maxClips: number
  showTitle: boolean
  titleSeconds: number
  descriptionMode: VideoDescriptionMode
  descriptionTemplate: string | null
  cropStyleMode: CropStyleMode
  cropZoomPercent: number
  showPartLabel: boolean
  partLabelPosition: PartLabelPosition
  titleStyle: VideoCaptionStyle
  hasBackgroundTemplate: boolean
  backgroundVideoHeightPercent: number
  backgroundVideoOffsetPercent: number
}

export interface ClientVideoSettingsResponse extends ClientVideoSettings {
  options: {
    aspectRatios: VideoAspectRatio[]
    framings: VideoFraming[]
    qualities: VideoQuality[]
    captionStyles: VideoCaptionStyle[]
    clipLengths: VideoClipLength[]
    clipModes: VideoClipMode[]
    descriptionModes: VideoDescriptionMode[]
    cropStyleModes: CropStyleMode[]
    partLabelPositions: PartLabelPosition[]
    titleStyles: VideoCaptionStyle[]
  }
  /** null = a configuração de todos os canais. */
  channelId: number | null
  /** true quando o canal escolhido ainda não tem estilo próprio. */
  usesDefault: boolean
  channels: { id: number; name: string; hasOwnStyle: boolean }[]
}

export type DriveExportMode = "auto" | "manual"

export interface YoutubeChannel {
  id: number
  channelName: string | null
  channelUrl: string
  avatarUrl: string | null
  isActive: boolean
  /** Última vez que conseguimos LER o canal (não avança quando a checagem falha). */
  lastPolledAt: string | null
  /** Última TENTATIVA de checagem, tenha dado certo ou não. */
  lastCheckAt: string | null
  lastCheckOk: boolean | null
  lastCheckError: string | null
  /** Falhas seguidas. Zera a cada sucesso. */
  checkFailCount: number
  exportFolder: { id: string; name: string | null } | null
  driveExportMode: DriveExportMode
  tiktokAccountId: number | null
  tiktokAccountName: string | null
}

export type SourceVideoStatus =
  | "detected"
  | "downloading"
  | "transcribing"
  | "selecting_clips"
  | "cutting"
  | "ready"
  | "error"
  | "cancelled"
  | "paused"
  | "aguardando_creditos"

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
  readyClipCount: number
  processingStartedAt: string | null
  tiktokAccountNames: string[]
}

export interface SourceVideosResponse {
  avgProcessingSeconds: number
  videos: SourceVideo[]
}

export type ClipStatus = "pending" | "rendering" | "ready" | "error"

export interface Clip {
  id: number
  title: string
  description: string | null
  startSeconds: number
  endSeconds: number
  status: ClipStatus
  errorMessage: string | null
  renderProgressPercent: number
  thumbnailUrl: string | null
  exportedToDrive: boolean
}

export interface TunnelTestResult {
  testedAt: string
  directIp?: string
  directError?: string
  proxiedIp?: string
  proxiedError?: string
  success: boolean
}

export interface ClientTunnel {
  id: number
  label: string | null
  connected: boolean
  lastCheckedAt: string | null
  lastTestResult: TunnelTestResult | null
  paired: boolean
}

export interface ClientTunnelResponse {
  tunnel: ClientTunnel | null
}

export type BandwidthEgressType = "client_tunnel" | "founder_tunnel" | "proxy" | "direct"

export interface BandwidthByEgress {
  egressType: BandwidthEgressType
  bytes: number
  videos: number
}

export interface BandwidthByClient {
  clientUserId: number
  name: string
  ownTunnelBytes: number
  fallbackBytes: number
  videos: number
}

export interface AdminBandwidthResponse {
  range: RangeInfo
  byEgress: BandwidthByEgress[]
  byClient: BandwidthByClient[]
  founderTunnel: { id: number; enabled: boolean; connected: boolean; lastCheckedAt: string | null } | null
  proxy: { configured: boolean; enabled: boolean }
  clientTunnels: { id: number; clientUserId: number; label: string | null; enabled: boolean; connected: boolean }[]
}

export type CreditBucket = "normal" | "bonus"
export type SubscriptionStatus = "sem_plano" | "ativo" | "inadimplente" | "cancelado"

export interface CreditBucketView {
  quotaMinutes: number
  usedMinutes: number
  extraMinutes: number
  availableMinutes: number
}

export interface BillingPlan {
  key: string
  name: string
  priceCents: number
  weeklyMinutesNormal: number
  weeklyMinutesBonus: number
  maxYoutubeChannels: number | null
  maxTiktokAccounts: number | null
}

export interface CreditTransactionView {
  id: number
  sourceVideoId: number
  bucket: CreditBucket
  status: "reservado" | "confirmado" | "liberado"
  minutesCharged: number
  downloadPath: string | null
  createdAt: string
}

export interface ClientBillingOverviewResponse {
  stripeConfigured: boolean
  subscription: {
    planKey: string | null
    planName: string | null
    status: SubscriptionStatus
    overageCardEnabled: boolean
  }
  credits: { normal: CreditBucketView; bonus: CreditBucketView }
  plans: BillingPlan[]
  overage: { rateCentsNormal: number; rateCentsBonus: number; pendingCents: number }
  package: { minMinutes: number; stepMinutes: number; maxMinutes: number; centsPerMinute: number }
  recentPurchases: { id: number; bucket: CreditBucket; minutes: number; amountCents: number; status: string; createdAt: string }[]
  recentTransactions: CreditTransactionView[]
}

export interface AdminBillingClient {
  clientUserId: number
  email: string
  businessName: string | null
  planKey: string | null
  planName: string | null
  status: SubscriptionStatus
  overageCardEnabled: boolean
}

export interface AdminBillingClientsResponse {
  clients: AdminBillingClient[]
}

export interface AdminBillingPlansResponse {
  plans: BillingPlan[]
}

export interface LatestChannelVideo {
  videoId: string
  title: string
  thumbnailUrl: string | null
  durationSeconds: number | null
  publishedAt: string | null
}

export interface AdminOverageSummaryResponse {
  clients: { clientUserId: number; email: string; businessName: string | null; pendingCents: number; billedCents: number }[]
}

export interface SystemError {
  id: number
  operation: string
  operationLabel: string
  entityType: string | null
  entityLabel: string | null
  entityId: number | null
  clientName: string | null
  message: string
  detail: string | null
  occurrences: number
  firstSeenAt: string
  lastSeenAt: string
  status: "aberto" | "retentando" | "resolvido"
  retryCount: number
  lastRetryAt: string | null
  /** false = não é uma operação que dê pra refazer sozinha (backup, teste de conexão). */
  canRetry: boolean
}

export interface SystemErrorsResponse {
  errors: SystemError[]
  counts: { abertos: number; resolvidos: number; ocorrenciasAbertas: number }
}
