export type UserRole = "admin" | "client"

export interface SessionUser {
  id: number
  email: string
  role: UserRole
}

/** "all" = desde sempre; "custom" = intervalo escolhido à mão (manda since/until). */
export type DateRangeKey = "today" | "yesterday" | "last7days" | "this_month" | "last_month" | "all" | "custom"

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

// Teto de CRIADORES ATIVOS por 24h que o TikTok concede ao app. Não é o
// limite de posts (esse é ~15 por conta): é quantas contas distintas podem
// publicar por dia, e ele não aparece em lugar nenhum até começar a recusar.
export interface TiktokCapacity {
  contas_conectadas: number
  criadores_ativos_24h: number
  pico_30_dias: number
  limite: number
  limiteConfirmado: boolean
  percentual: number
  alertar: boolean
  dispensadoAte: string | null
}

export interface AdminDashboardResponse {
  range: RangeInfo
  tiktokCapacity: TiktokCapacity
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

export interface ClientOrigin {
  referrerName: string | null
  affiliateLinkLabel: string | null
  utmSource: string | null
  utmCampaign: string | null
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
  origin: ClientOrigin | null
  tiktokAccountCount: number
  /** Plano da assinatura ativa, ou "Free" quando não há nenhuma. */
  plano: { chave: string; nome: string; status: string }
  /** Custo que este cliente gerou no período: Whisper + IA + banda de proxy pago. */
  custoUsd: number
  /** Cortes publicados no TikTok para este cliente no período. */
  clipsPosted: number
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
  /** Quantos vídeos o sistema corta ao mesmo tempo, e os limites aceitos. */
  processamento: { maxSimultaneos: number; minimo: number; maximo: number }
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
  /** 'inbox' = chega como rascunho no app do TikTok; 'direct' = vai direto pro perfil. */
  publishMode: "inbox" | "direct"

  pendingCount: number
  postedCount: number
  errorCount: number
  /** true = a conta já tem padrão de publicação definido (libera "postar agora"). */
  hasPublishDefaults: boolean
  /** O próximo corte que sai nessa conta. null = fila vazia. */
  nextInQueue: NextInQueue | null
}

export interface NextInQueue {
  postingId: number
  clipId: number
  clipTitle: string
  thumbnailUrl: string | null
  channelName: string | null
  startSeconds: number
  endSeconds: number
  scheduledFor: string | null
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
  paused: boolean
  // retentionHours é informativo: o prazo é fixo no sistema (3 dias), o
  // cliente só é avisado dele. Ver src/config/constants.js.
  options: { retentionHours: number; maxPostsPerDay: number }
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

/**
 * Padrão de publicação direta da conta: escolhido uma vez, vale pra todo corte.
 * Enquanto `definido` for false, nenhum corte é publicado direto — a TikTok
 * proíbe publicar com uma configuração que o criador nunca viu.
 */
export interface PublishDefaults {
  definido: boolean
  definidoEm: string | null
  privacyLevel: string | null
  disableComment: boolean
  disableDuet: boolean
  disableStitch: boolean
  brandOrganicToggle: boolean
  brandContentToggle: boolean
}

export interface PostingQueueItem {
  id: number
  clipId: number
  /** true = este corte tem opções próprias, diferentes do padrão da conta. */
  optionsCustom: boolean
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

export type VideoCaptionStyle =
  | "classic" | "bold" | "minimal" | "none" | "bubble_purple" | "bubble_dark"
  | "neon_verde" | "vermelho_forte" | "amarelo_caixa" | "branco_caixa" | "contorno_grosso"
  // Caixa na cor escolhida pelo cliente. "papel_rasgado" só existe para
  // título: a legenda aparece palavra por palavra, e uma faixa larga atrás
  // de uma palavra só ficaria desproporcional.
  | "caixa_colorida" | "papel_rasgado"
export type VideoClipLength = "short" | "balanced" | "long" | "extra_long"
/** "full_parts" = fatiar o vídeo inteiro em partes sequenciais (Parte 1, Parte 2...). */
export type VideoClipMode = "ai_choice" | "full_parts" | "fixed_count"
export type FullPartsMode = "duration" | "count"
export type VideoDescriptionMode = "auto" | "fixed" | "none"
export type CropStyleMode = "auto" | "manual"
export type PartLabelPosition = "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right"

export interface ClientVideoSettings {
  captionStyle: VideoCaptionStyle
  captionFont: string
  titleFont: string
  /** Cor da caixa / do papel rasgado, em #RRGGBB. */
  titleBoxColor: string
  captionBoxColor: string
  // Altura na tela, em % da altura do vídeo, contada a partir da borda mais
  // próxima: a legenda sobe de baixo, o título desce de cima.
  captionHeightPercent: number
  titleHeightPercent: number
  clipLength: VideoClipLength
  clipMode: VideoClipMode
  /**
   * Como dividir o vídeo no modo "full_parts": "duration" = o cliente fixa a
   * duração média de cada parte, "count" = o cliente fixa quantas partes quer.
   * Uma decide a outra.
   */
  fullPartsMode: FullPartsMode
  /** Duração média de cada parte, em minutos. Só usada quando fullPartsMode é "duration". */
  fullPartsMinutes: number
  /** Quantas partes gerar. Só usada quando fullPartsMode é "count". */
  fullPartsCount: number
  maxClips: number
  showTitle: boolean
  titleSeconds: number
  descriptionMode: VideoDescriptionMode
  descriptionTemplate: string | null
  cropStyleMode: CropStyleMode
  cropZoomPercent: number
  showPartLabel: boolean
  partLabelPosition: PartLabelPosition
  /** Tamanho do adesivo "Parte N", em % do tamanho-base. 50 a 200. */
  partLabelSizePercent: number
  titleStyle: VideoCaptionStyle
  /**
   * O que aparece atrás do vídeo quando ele não ocupa a tela inteira.
   * "thumbnail" é diferente dos outros: não é fundo, é uma faixa com a capa
   * daquele vídeo colada ao vídeo (ver thumbnailPosition).
   */
  backgroundStyle: "blur" | "black" | "white" | "template" | "thumbnail" | "frame"
  hasBackgroundTemplate: boolean
  backgroundVideoHeightPercent: number
  backgroundVideoOffsetPercent: number
  /** De que lado fica a faixa da capa. Só vale para backgroundStyle "thumbnail". */
  thumbnailPosition: "top" | "bottom"
  /**
   * Qual trilha de áudio baixar quando o canal publica o vídeo dublado em
   * vários idiomas. "original" = a trilha padrão do YouTube. Um vídeo que não
   * tenha o idioma pedido cai no original — não falha.
   */
  audioLanguage: string
}

export interface ClientVideoSettingsResponse extends ClientVideoSettings {
  options: {
    captionStyles: VideoCaptionStyle[]
    fonts: string[]
    clipLengths: VideoClipLength[]
    clipModes: VideoClipMode[]
    descriptionModes: VideoDescriptionMode[]
    cropStyleModes: CropStyleMode[]
    partLabelPositions: PartLabelPosition[]
    titleStyles: VideoCaptionStyle[]
    fullPartsModes: FullPartsMode[]
    fullPartsMinMinutes: number
    fullPartsMaxMinutes: number
    fullPartsMinCount: number
    fullPartsMaxCount: number
    partLabelMinSize: number
    partLabelMaxSize: number
    audioLanguages: { codigo: string; nome: string }[]
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
  /** Só pega vídeo novo quando a fila de postagem deste canal está quase vazia. */
  processOnlyWhenQueueClear: boolean
  tiktokAccountId: number | null
  tiktokAccountName: string | null
  /**
   * Vídeos deste canal parados por serem exclusivos de membros. Não é erro:
   * eles entram na fila sozinhos se o canal abrir para todo mundo.
   */
  membersOnlyCount: number
}

/** Por que um vídeo está parado esperando cobrança. Só vem preenchido junto de `aguardando_creditos`. */
export type BillingBlockReason = "sem_credito" | "cobranca_falhou"

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
  | "aguardando_conexao"
  /** Exclusivo de membros do canal: não é erro, e entra na fila sozinho se abrir. */
  | "somente_membros"

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
  billingBlockReason: BillingBlockReason | null
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
  /** true = só baixar com o computador do cliente ligado; false = usar nossa banda quando ele estiver desligado. */
  requireClientTunnel: boolean
}

export interface ClientTunnelResponse {
  tunnel: ClientTunnel | null
}

// "reuse" = o vídeo já estava em disco porque outro cliente monitora o
// mesmo canal do YouTube. Sempre com 0 bytes: reaproveitar não gasta banda.
export type BandwidthEgressType = "client_tunnel" | "founder_tunnel" | "proxy" | "direct" | "reuse"

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

export interface BandwidthEconomia {
  downloadsReaproveitados: number
  bytesEconomizados: number
  transcricoesReaproveitadas: number
  whisperUsdEconomizado: number
}

export interface AdminBandwidthResponse {
  /**
   * Se o cliente enxerga qualquer coisa sobre usar a internet dele. É só
   * exibição: o túnel continua funcionando para quem já pareou o programa.
   */
  mostrarTunelParaClientes: boolean
  range: RangeInfo
  byEgress: BandwidthByEgress[]
  byClient: BandwidthByClient[]
  economia: BandwidthEconomia
  founderTunnel: { id: number; enabled: boolean; connected: boolean; lastCheckedAt: string | null } | null
  proxy: {
    configured: boolean
    enabled: boolean
    purchasedBytes: number
    consumedAllTimeBytes: number
    remainingBytes: number
  }
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
  /** Mensalidade cheia — o que passa a ser cobrado a partir do 2º mês. */
  priceCents: number
  /** Preço promocional do 1º mês. null = plano sem promoção. */
  firstMonthPriceCents?: number | null
  weeklyMinutesNormal: number
  weeklyMinutesBonus: number
  maxYoutubeChannels: number | null
  maxTiktokAccounts: number | null
  /** Quanto custa o minuto que passa da cota, neste plano. */
  overageCentsNormal?: number
  overageCentsBonus?: number
  /** Preço mensal de 1 conexão extra. null = o plano não vende conexões extras. */
  extraSlotPriceCents?: number | null
}

/** O que está sendo comprado na tela de checkout, lido da barra de endereço. */
export type CheckoutItem =
  | { tipo: "plano"; planKey: string }
  | { tipo: "creditos"; minutos: number }
  | { tipo: "extras"; quantidade: number }
  | { tipo: "cartao" }

export interface CheckoutContexto {
  asaasDisponivel: boolean
  plans: BillingPlan[]
  subscription: {
    planKey: string | null
    planName: string | null
    status: SubscriptionStatus
    /** false = a promoção de 1º mês já foi usada; a tela não pode anunciá-la. */
    promoDisponivel: boolean
    extraSlots: number
    extraSlotPriceCents: number | null
    limites: { canais: number | null; contas: number | null }
    emUso: { canais: number; contas: number }
    overageCardEnabled: boolean
  }
  /** Cartão tokenizado no Asaas, quando já existe um salvo. */
  card: { brand: string | null; last4: string | null; exp: string | null } | null
  perfil: { nome: string; email: string; cpfCnpj: string }
  package: { minMinutes: number; stepMinutes: number; maxMinutes: number; centsPerMinute: number }
  overage: { rateCentsNormal: number; rateCentsBonus: number }
  empresa: { nome: string; cnpj: string }
  maxSlotsPorCompra: number
}

export interface CheckoutPagamento {
  /** false = cartão em análise. Não é falha: o resultado chega pelo webhook. */
  pago: boolean
  tipo?: "plano" | "creditos" | "extras" | "cartao"
  status?: string
  paymentId?: string
  planName?: string | null
  minutes?: number
  slots?: number
  pixCopiaECola?: string
  qrCodeBase64?: string
}

export interface SavedCard {
  id: string
  brand: string
  last4: string
  expMonth: number
  expYear: number
  isDefault: boolean
}

/** avulso = crédito comprado; excedente = passou da cota; plano = mensalidade. */
export type StatementKind = "avulso" | "excedente" | "plano" | "outro"

export interface StatementEntry {
  id: string
  createdAt: string
  kind: StatementKind
  minutes: number | null
  amountCents: number
  refundedCents: number
  status: "pago" | "falhou" | "reembolsado"
  card: { brand: string; last4: string } | null
  receiptUrl: string | null
}

export interface ClientPaymentsResponse {
  cards: SavedCard[]
  statement: StatementEntry[]
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
  asaasConfigured: boolean
  subscription: {
    planKey: string | null
    planName: string | null
    status: SubscriptionStatus
    overageCardEnabled: boolean
    promoDisponivel: boolean
    extraSlots: number
    extraSlotPriceCents: number | null
    /** Limite EFETIVO: o que o plano dá mais as conexões compradas. */
    limiteCanais: number | null
    limiteContas: number | null
  }
  /** Cartão tokenizado no Asaas (independente do cartão antigo da Stripe). */
  asaasCard: { brand: string | null; last4: string | null; exp: string | null } | null
  credits: { normal: CreditBucketView; bonus: CreditBucketView }
  /** true = conta do dono do sistema: não gasta crédito nem depende de plano. */
  isExempt: boolean
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
  /**
   * Trilhas de áudio dubladas que este vídeo oferece (códigos ISO). Vem vazia
   * quando o vídeo tem uma trilha só — e também quando não deu pra ler (ler as
   * trilhas depende do túnel/proxy, e é melhor esforço). Vazia = a tela não
   * pergunta idioma nenhum.
   */
  audioLanguages: string[]
  /** Qual deixar marcado: o idioma do painel, se o vídeo tiver. */
  audioLanguageSuggestion: string
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

// --- Comissões / afiliados ---

export type PixKeyType = "cpf" | "cnpj" | "email" | "telefone" | "aleatoria"
export type WithdrawalStatus = "pendente" | "pago" | "recusado"

export interface CommissionEntry {
  id: number
  referredEmail: string
  referredBusinessName: string | null
  amountPaidCents: number
  commissionPercent: number
  commissionCents: number
  createdAt: string
}

export interface ReferralEntry {
  id: number
  email: string
  businessName: string | null
  subscriptionStatus: SubscriptionStatus | null
  createdAt: string
}

export interface WithdrawalEntry {
  id: number
  amountCents: number
  status: WithdrawalStatus
  requestedAt: string
  resolvedAt: string | null
}

export interface ClientCommissionsOverviewResponse {
  range: RangeInfo
  link: { code: string; url: string }
  balance: { availableCents: number; reservedCents: number; totalEarnedCents: number }
  referralCount: number
  periodReferralCount: number
  activeSubscriptionCount: number
  periodTotalCents: number
  minWithdrawCents: number
  pix: { key: string | null; type: PixKeyType | null }
  recentCommissions: CommissionEntry[]
  recentReferrals: ReferralEntry[]
  recentWithdrawals: WithdrawalEntry[]
}

export interface AdminCommissionsOverviewResponse {
  range: RangeInfo
  periodCommissionCents: number
  periodCommissionCount: number
  lifetimeCommissionCents: number
  affiliateCount: number
  totalReferrals: number
  totalActiveSubscriptions: number
  totalPendingWithdrawalCents: number
}

export interface AdminAffiliate {
  userId: number
  email: string
  businessName: string | null
  commissionPercentOverride: number | null
  referralCount: number
  activeSubscriptionCount: number
  totalEarnedCents: number
  balanceAvailableCents: number
  balanceReservedCents: number
}

export interface AdminAffiliatesResponse {
  affiliates: AdminAffiliate[]
}

export interface AdminWithdrawal {
  id: number
  affiliateUserId: number
  email: string
  businessName: string | null
  amountCents: number
  pixKey: string
  pixKeyType: PixKeyType
  status: WithdrawalStatus
  adminNote: string | null
  requestedAt: string
  resolvedAt: string | null
}

export interface AdminWithdrawalsResponse {
  withdrawals: AdminWithdrawal[]
}

export interface AffiliateSettings {
  percentDefault: number
  minWithdrawCents: number
  maxMonths: number
}

export interface AdminAffiliateLink {
  id: number
  code: string
  /** Endereço completo, pronto pra colar. Vem montado do servidor: o domínio
   *  é configuração, não o endereço de onde a tela por acaso foi aberta. */
  url: string
  label: string | null
  referralCount: number
  activeCount: number
  createdAt: string
}

export interface AdminAffiliateLinksResponse {
  /** Endereço do site, para montar a prévia antes de o link existir. */
  baseUrl: string
  links: AdminAffiliateLink[]
}

/** Em que ponto da configuração inicial o cliente está (GET /api/client/onboarding). */
export interface OnboardingStatus {
  tiktokConectado: boolean
  estiloConfigurado: boolean
  canalMonitorado: boolean
  /** true quando os três passos terminaram — o checklist some da tela inicial. */
  concluido: boolean
  contasTiktok: number
  canais: number
}

/** Ordenação da lista de clientes do admin. */
export type OrdemDeCliente = "recentes" | "antigos" | "maior_custo"
