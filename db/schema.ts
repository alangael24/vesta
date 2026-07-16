import { sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

const timestamp = () => text().notNull().default(sql`CURRENT_TIMESTAMP`);

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  avatarKey: text("avatar_key"),
  avatarVersion: text("avatar_version"),
  avatarUpdatedAt: text("avatar_updated_at"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
}, (table) => [uniqueIndex("users_email_unique").on(table.email)]);

export const devices = sqliteTable("devices", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  platform: text("platform", { enum: ["ios", "android"] }).notNull(),
  tokenHash: text("token_hash").notNull(),
  createdAt: timestamp(),
  lastSeenAt: text("last_seen_at"),
  revokedAt: text("revoked_at"),
}, (table) => [
  uniqueIndex("devices_token_hash_unique").on(table.tokenHash),
  index("devices_owner_idx").on(table.ownerId),
]);

export const pairingCodes = sqliteTable("pairing_codes", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull(),
  expiresAt: text("expires_at").notNull(),
  createdAt: timestamp(),
  consumedAt: text("consumed_at"),
}, (table) => [uniqueIndex("pairing_code_hash_unique").on(table.codeHash)]);

export const importBatches = sqliteTable("import_batches", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  deviceId: text("device_id").references(() => devices.id, { onDelete: "set null" }),
  photoCount: integer("photo_count").notNull(),
  totalBytes: integer("total_bytes").notNull(),
  status: text("status", { enum: ["created", "uploading", "uploaded", "processing", "review", "completed", "failed"] }).notNull().default("created"),
  originalsPolicy: text("originals_policy", { enum: ["retain_private", "delete_after_extraction"] }).notNull().default("retain_private"),
  processingMode: text("processing_mode", { enum: ["economy", "quality"] }),
  processingApprovedAt: text("processing_approved_at"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  completedAt: text("completed_at"),
}, (table) => [index("import_batches_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const sourcePhotos = sqliteTable("source_photos", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  r2Key: text("r2_key").notNull(),
  normalizedKey: text("normalized_key"),
  filename: text("filename").notNull(),
  contentType: text("content_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  width: integer("width"),
  height: integer("height"),
  sha256: text("sha256"),
  status: text("status", { enum: ["awaiting_upload", "uploaded", "normalized", "analyzed", "deleted", "failed"] }).notNull().default("awaiting_upload"),
  createdAt: timestamp(),
  uploadedAt: text("uploaded_at"),
  deletedAt: text("deleted_at"),
}, (table) => [
  index("source_photos_batch_idx").on(table.batchId),
  index("source_photos_owner_status_idx").on(table.ownerId, table.status),
]);

export const processingJobs = sqliteTable("processing_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  batchId: text("batch_id").notNull().references(() => importBatches.id, { onDelete: "cascade" }),
  garmentId: text("garment_id"),
  kind: text("kind", { enum: ["inventory", "reconstruct", "remove_background", "deduplicate", "quality_check", "outfits", "try_on"] }).notNull(),
  status: text("status", { enum: ["queued", "running", "waiting_review", "completed", "failed", "cancelled"] }).notNull().default("queued"),
  progress: integer("progress").notNull().default(0),
  attempts: integer("attempts").notNull().default(0),
  model: text("model"),
  resultJson: text("result_json"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  errorCode: text("error_code"),
  errorMessage: text("error_message"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (table) => [
  index("processing_jobs_batch_status_idx").on(table.batchId, table.status),
  index("processing_jobs_garment_idx").on(table.garmentId),
]);

export const garments = sqliteTable("garments", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  batchId: text("batch_id").references(() => importBatches.id, { onDelete: "set null" }),
  name: text("name").notNull(),
  category: text("category").notNull(),
  type: text("type").notNull(),
  color: text("color"),
  secondaryColor: text("secondary_color"),
  tagsJson: text("tags_json"),
  material: text("material"),
  description: text("description"),
  sourceType: text("source_type", { enum: ["photos", "internet"] }).notNull().default("photos"),
  sourceUrl: text("source_url"),
  confidence: integer("confidence"),
  isBasic: integer("is_basic", { mode: "boolean" }).notNull().default(false),
  fingerprint: text("fingerprint"),
  duplicateOfId: text("duplicate_of_id"),
  dedupConfidence: integer("dedup_confidence"),
  dedupRationale: text("dedup_rationale"),
  cutoutKey: text("cutout_key"),
  previewKey: text("preview_key"),
  reconstructionModel: text("reconstruction_model"),
  reconstructionQuality: text("reconstruction_quality", { enum: ["draft", "final"] }),
  reconstructionApprovedAt: text("reconstruction_approved_at"),
  reconstructedAt: text("reconstructed_at"),
  cutoutWidth: integer("cutout_width"),
  cutoutHeight: integer("cutout_height"),
  transparentPixelRatio: integer("transparent_pixel_ratio"),
  qaStatus: text("qa_status", { enum: ["pending", "pass", "review", "fail"] }),
  qaJson: text("qa_json"),
  status: text("status", { enum: ["candidate", "reconstructing", "qa", "approved", "held", "duplicate", "rejected"] }).notNull().default("candidate"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
}, (table) => [
  index("garments_owner_status_idx").on(table.ownerId, table.status),
  index("garments_fingerprint_idx").on(table.ownerId, table.fingerprint),
  index("garments_duplicate_idx").on(table.ownerId, table.duplicateOfId),
]);

export const garmentEvidence = sqliteTable("garment_evidence", {
  id: text("id").primaryKey(),
  garmentId: text("garment_id").notNull().references(() => garments.id, { onDelete: "cascade" }),
  photoId: text("photo_id").notNull().references(() => sourcePhotos.id, { onDelete: "cascade" }),
  bboxX: integer("bbox_x").notNull(),
  bboxY: integer("bbox_y").notNull(),
  bboxWidth: integer("bbox_width").notNull(),
  bboxHeight: integer("bbox_height").notNull(),
  confidence: integer("confidence"),
  createdAt: timestamp(),
}, (table) => [index("garment_evidence_garment_idx").on(table.garmentId)]);

export const outfits = sqliteTable("outfits", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  occasion: text("occasion").notNull(),
  rationale: text("rationale").notNull(),
  renderKey: text("render_key"),
  piecesSnapshotJson: text("pieces_snapshot_json"),
  avatarVersion: text("avatar_version"),
  status: text("status", { enum: ["suggested", "rendering", "ready", "saved", "rejected"] }).notNull().default("suggested"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
}, (table) => [index("outfits_owner_created_idx").on(table.ownerId, table.createdAt)]);

export const outfitItems = sqliteTable("outfit_items", {
  outfitId: text("outfit_id").notNull().references(() => outfits.id, { onDelete: "cascade" }),
  garmentId: text("garment_id").notNull().references(() => garments.id, { onDelete: "cascade" }),
  position: integer("position").notNull(),
}, (table) => [primaryKey({ columns: [table.outfitId, table.garmentId] })]);

export const scheduledOutfits = sqliteTable("scheduled_outfits", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  outfitId: text("outfit_id").notNull().references(() => outfits.id, { onDelete: "cascade" }),
  scheduledDate: text("scheduled_date").notNull(),
  note: text("note"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
}, (table) => [
  uniqueIndex("scheduled_outfits_owner_outfit_date_unique").on(table.ownerId, table.outfitId, table.scheduledDate),
  index("scheduled_outfits_owner_date_idx").on(table.ownerId, table.scheduledDate),
]);

export const outfitRenderJobs = sqliteTable("outfit_render_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  outfitId: text("outfit_id").notNull().references(() => outfits.id, { onDelete: "cascade" }),
  quality: text("quality", { enum: ["low", "medium"] }).notNull().default("low"),
  status: text("status", { enum: ["queued", "running", "completed", "failed"] }).notNull().default("queued"),
  errorCode: text("error_code"),
  resultPath: text("result_path"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  startedAt: text("started_at"),
  completedAt: text("completed_at"),
}, (table) => [
  index("outfit_render_jobs_owner_outfit_idx").on(table.ownerId, table.outfitId, table.createdAt),
  index("outfit_render_jobs_status_idx").on(table.status, table.updatedAt),
]);

export const avatarGenerationJobs = sqliteTable("avatar_generation_jobs", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: text("status", { enum: ["running", "completed", "failed"] }).notNull().default("running"),
  errorCode: text("error_code"),
  avatarVersion: text("avatar_version"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
  completedAt: text("completed_at"),
}, (table) => [
  index("avatar_generation_jobs_owner_created_idx").on(table.ownerId, table.createdAt),
  index("avatar_generation_jobs_status_idx").on(table.status, table.updatedAt),
]);

export const subscriptionEntitlements = sqliteTable("subscription_entitlements", {
  ownerId: text("owner_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  productId: text("product_id").notNull(),
  originalTransactionId: text("original_transaction_id").notNull(),
  transactionId: text("transaction_id").notNull(),
  environment: text("environment", { enum: ["Sandbox", "Production"] }).notNull(),
  purchasedAt: text("purchased_at").notNull(),
  expiresAt: text("expires_at").notNull(),
  status: text("status", { enum: ["active", "expired", "revoked"] }).notNull(),
  verifiedAt: text("verified_at").notNull(),
  updatedAt: timestamp(),
}, (table) => [
  uniqueIndex("subscription_entitlements_original_transaction_unique").on(table.originalTransactionId),
  index("subscription_entitlements_status_expiry_idx").on(table.status, table.expiresAt),
]);

export const subscriptionUsage = sqliteTable("subscription_usage", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  originalTransactionId: text("original_transaction_id").notNull(),
  kind: text("kind", { enum: ["wardrobe_addition", "look_generation"] }).notNull(),
  amount: integer("amount").notNull().default(1),
  idempotencyKey: text("idempotency_key").notNull(),
  periodStart: text("period_start").notNull(),
  periodEnd: text("period_end").notNull(),
  status: text("status", { enum: ["reserved", "consumed", "released"] }).notNull().default("reserved"),
  createdAt: timestamp(),
  updatedAt: timestamp(),
}, (table) => [
  uniqueIndex("subscription_usage_owner_idempotency_unique").on(table.ownerId, table.idempotencyKey),
  index("subscription_usage_owner_period_kind_idx").on(table.ownerId, table.periodStart, table.kind, table.status),
]);
