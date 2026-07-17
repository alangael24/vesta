export type GarmentId = string;
export type OutfitId = string;

export type GarmentCategory =
  | "tops"
  | "layers"
  | "bottoms"
  | "footwear"
  | "accessories"
  | "one_piece";

export type GarmentSlot = "head" | "top" | "outer" | "one_piece" | "bottom" | "feet" | "accessory";
export type WeatherKind = "hot" | "mild" | "cold" | "rain";
export type OccasionKind = "daily" | "work" | "date" | "event" | "travel" | "weekend";
export type StyleDirection = "minimal" | "relaxed" | "polished" | "bold";
export type PlanMode = "balanced" | "expressive" | "rotation";
export type FeedbackKind = "like" | "dislike" | "save" | "wear" | "skip";

export type WardrobeItem = {
  id: string | number;
  name: string;
  category: GarmentCategory | string;
  type: string;
  color?: string | null;
  secondaryColor?: string | null;
  material?: string | null;
  description?: string | null;
  tags?: string[];
  sourceType?: "photos" | "internet";
  confidence?: number | null;
  isBasic?: boolean;
  status?: string;
  reconstructionQuality?: "draft" | "final" | null;
  qaStatus?: "pending" | "pass" | "review" | "fail" | null;
  imagePath?: string | null;
  localImageUri?: string | null;
  imageKind?: "cutout" | "evidence";
};

export type Outfit = {
  id: string;
  name: string;
  occasion: string;
  note: string;
  pieces: WardrobeItem[];
  renderPath?: string | null;
  localRenderUri?: string | null;
  avatarVersion?: string | null;
  status?: string;
};

export type CalendarEntry = {
  id: string;
  outfitId: string;
  scheduledDate: string;
  note?: string | null;
};

export type CloudAvatar = {
  mediaPath: string;
  version: string;
  updatedAt?: string | null;
  localUri?: string | null;
};

export type SubscriptionStatus = {
  active: boolean;
  plan?: string | null;
  lookGenerationsRemaining?: number | null;
};

export type CloudSession = {
  apiUrl: string;
  dispatchToken: string;
  deviceToken: string;
  deviceId: string;
};

export type NativeSnapshot = {
  wardrobe: WardrobeItem[];
  outfits: Outfit[];
  calendar: CalendarEntry[];
  avatar: CloudAvatar | null;
  subscription: SubscriptionStatus | null;
  updatedAt: string;
};

export type DayBrief = {
  date: string;
  label: string;
  occasion: OccasionKind;
  weather: WeatherKind;
  direction: StyleDirection;
  temperatureC?: number | null;
  rainProbability?: number | null;
  anchorGarmentIds: GarmentId[];
  avoidGarmentIds: GarmentId[];
  locked: boolean;
};

export type FeatureContribution = {
  key: string;
  label: string;
  value: number;
};

export type CandidateScore = {
  total: number;
  harmony: number;
  context: number;
  personal: number;
  rotation: number;
  novelty: number;
  completeness: number;
  confidence: number;
  uncertainty: number;
};

export type OutfitCandidate = {
  id: string;
  signature: string;
  garmentIds: GarmentId[];
  garments: WardrobeItem[];
  name: string;
  rationale: string;
  signals: string[];
  score: CandidateScore;
  features: number[];
  contributions: FeatureContribution[];
  alternatives: Array<{
    removeGarmentId: GarmentId;
    addGarmentId: GarmentId;
    delta: number;
    explanation: string;
  }>;
};

export type PlannedDay = {
  brief: DayBrief;
  candidate: OutfitCandidate;
  outfitId?: OutfitId | null;
  renderPath?: string | null;
  localRenderUri?: string | null;
  renderJobId?: string | null;
  locked: boolean;
};

export type WeekPlanStats = {
  score: number;
  uniqueGarments: number;
  repeatedCorePieces: number;
  underusedGarmentsRecovered: number;
  colorFamilies: number;
  renderedDays: number;
};

export type WeekPlan = {
  id: string;
  createdAt: string;
  mode: PlanMode;
  days: PlannedDay[];
  score: number;
  stats: WeekPlanStats;
  explanation: string;
};

export type WardrobeGraphNode = {
  garmentId: GarmentId;
  weightedDegree: number;
  centrality: number;
  community: number;
  redundancy: number;
  versatility: number;
};

export type WardrobeGraphEdge = {
  a: GarmentId;
  b: GarmentId;
  weight: number;
};

export type WardrobeAnalysis = {
  nodes: WardrobeGraphNode[];
  edges: WardrobeGraphEdge[];
  palette: Array<{ family: string; count: number; share: number }>;
  communities: Array<{ id: number; garmentIds: GarmentId[]; label: string }>;
  heroes: WardrobeGraphNode[];
  orphans: WardrobeGraphNode[];
  redundantClusters: Array<{ garmentIds: GarmentId[]; explanation: string }>;
  gaps: string[];
  potentialOutfits: number;
  coverage: number;
  styleDNA: StyleDNA;
};

export type StyleDNA = {
  minimal: number;
  relaxed: number;
  polished: number;
  bold: number;
  warm: number;
  cool: number;
  tonal: number;
  layered: number;
};

export type StyleProfile = {
  version: 1;
  weights: number[];
  precision: number[];
  actionCount: number;
  wornGarmentCounts: Record<GarmentId, number>;
  lastWornAt: Record<GarmentId, string>;
  savedSignatures: string[];
  rejectedSignatures: string[];
  updatedAt: string;
};

export type StyleFeedback = {
  kind: FeedbackKind;
  candidate: OutfitCandidate;
  at: string;
};

export type RenderJobStage =
  | "queued"
  | "ensuring_outfit"
  | "submitting"
  | "polling"
  | "downloading"
  | "ready"
  | "failed"
  | "cancelled";

export type RenderQuality = "low" | "medium";

export type RenderJob = {
  id: string;
  signature: string;
  garmentIds: GarmentId[];
  outfitId?: OutfitId | null;
  quality: RenderQuality;
  stage: RenderJobStage;
  attempts: number;
  requestId: string;
  renderPath?: string | null;
  localRenderUri?: string | null;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RenderQueueState = {
  version: 1;
  jobs: RenderJob[];
  updatedAt: string;
};

export type LegacyRoute = {
  view: "home" | "profile" | "closet" | "builder" | "looks" | "calendar" | "wishlist";
  action?: "import" | "avatar" | "create" | "profile";
  garmentIds?: string[];
  outfitId?: string;
  garmentId?: string;
  autoRender?: boolean;
};

export type Notice = {
  id: number;
  title: string;
  message?: string;
  tone: "info" | "success" | "error";
};
