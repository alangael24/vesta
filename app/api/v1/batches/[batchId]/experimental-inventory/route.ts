import { and, count, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, importBatches, processingJobs, sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import {
  InventoryError,
  InventoryResult,
  persistExperimentalInventory,
} from "@/lib/inventory";

type RouteContext = { params: Promise<{ batchId: string }> };
type ExperimentalPayload = {
  provider?: string;
  model?: string;
  consent?: boolean;
  results?: unknown;
  usage?: unknown;
};

type ExperimentalUsage = {
  photoCount: number;
  requestCount: number;
  elapsedMs: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
  totalTokens: number;
  rateLimit?: Record<string, unknown>;
};

const supportedModels = new Set(["gpt-5.6-luna", "gpt-5.4-mini", "gpt-5.4", "gpt-5.5"]);
const categories = new Set(["tops", "layers", "bottoms", "footwear", "accessories", "one_piece", "unknown"]);
const visibilities = new Set(["clear", "partial", "held"]);

export async function POST(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;

  const { batchId } = await context.params;
  const payload = await safeJson(request);
  if (
    payload?.provider !== "chatgpt-codex-experimental" ||
    payload.consent !== true ||
    !payload.model ||
    !supportedModels.has(payload.model) ||
    !isInventoryResults(payload.results) ||
    !isExperimentalUsage(payload.usage)
  ) {
    return Response.json({ error: "invalid_experimental_inventory" }, { status: 400 });
  }

  const db = getDb();
  const [batch] = await db.select().from(importBatches).where(and(
    eq(importBatches.id, batchId),
    eq(importBatches.ownerId, identity.ownerId),
  )).limit(1);
  if (!batch) return Response.json({ error: "batch_not_found" }, { status: 404 });
  if (!["uploaded", "processing", "failed", "review"].includes(batch.status)) {
    return Response.json({ error: "batch_not_ready" }, { status: 409 });
  }

  const [existing] = await db.select({ value: count() }).from(garments).where(and(
    eq(garments.ownerId, identity.ownerId),
    eq(garments.batchId, batchId),
  ));
  if ((existing?.value ?? 0) > 0) {
    return Response.json({ ok: true, status: "review", garmentCount: existing.value, alreadyPersisted: true });
  }

  const [job] = await db.select().from(processingJobs).where(and(
    eq(processingJobs.batchId, batchId),
    eq(processingJobs.ownerId, identity.ownerId),
    eq(processingJobs.kind, "inventory"),
  )).limit(1);
  if (!job) return Response.json({ error: "inventory_job_not_found" }, { status: 409 });
  if (job.status === "running") return Response.json({ error: "inventory_already_running" }, { status: 409 });

  const now = new Date().toISOString();
  await db.batch([
    db.update(importBatches).set({ status: "processing", processingApprovedAt: now, updatedAt: now }).where(eq(importBatches.id, batchId)),
    db.update(processingJobs).set({
      status: "running",
      progress: 70,
      attempts: job.attempts + 1,
      model: payload.model,
      errorCode: null,
      errorMessage: null,
      startedAt: now,
      updatedAt: now,
    }).where(eq(processingJobs.id, job.id)),
  ]);

  try {
    const photos = await db.select().from(sourcePhotos).where(and(
      eq(sourcePhotos.batchId, batchId),
      eq(sourcePhotos.ownerId, identity.ownerId),
      inArray(sourcePhotos.status, ["uploaded", "normalized", "analyzed"]),
    ));
    if (photos.length !== batch.photoCount) {
      throw new InventoryError("photos_incomplete", "Not all source photos are available.");
    }
    const photoIds = new Set(photos.map((photo) => photo.id));
    if (payload.results.some((result) => result.garments.some((garment) => garment.evidence.some((item) => !photoIds.has(item.photo_id))))) {
      throw new InventoryError("invalid_photo_evidence", "Inventory evidence references an unknown photo.");
    }

    const persisted = await persistExperimentalInventory(identity.ownerId, batchId, photos, payload.results);
    const garmentCount = persisted.garmentCount;
    const completedAt = new Date().toISOString();
    await db.batch([
      db.update(processingJobs).set({
        status: "completed",
        progress: 100,
        model: payload.model,
        resultJson: JSON.stringify({ garmentCount, chunks: payload.results.length, provider: payload.provider, usage: payload.usage }),
        inputTokens: payload.usage.inputTokens,
        outputTokens: payload.usage.outputTokens,
        completedAt,
        updatedAt: completedAt,
      }).where(eq(processingJobs.id, job.id)),
      db.update(importBatches).set({ status: "review", updatedAt: completedAt }).where(eq(importBatches.id, batchId)),
    ]);
    return Response.json({ ok: true, status: "review", garmentCount, garments: persisted.garments, duplicateCount: 0, deduplicationStatus: "not_run" });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const code = error instanceof InventoryError ? error.code : "experimental_inventory_failed";
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Experimental inventory failed.";
    await db.batch([
      db.update(processingJobs).set({ status: "failed", errorCode: code, errorMessage: message, updatedAt: failedAt }).where(eq(processingJobs.id, job.id)),
      db.update(importBatches).set({ status: "failed", updatedAt: failedAt }).where(eq(importBatches.id, batchId)),
    ]);
    return Response.json({ error: code, detail: message }, { status: 502 });
  }
}

function isExperimentalUsage(value: unknown): value is ExperimentalUsage {
  if (!isRecord(value)) return false;
  const countFields = ["photoCount", "requestCount", "inputTokens", "cachedInputTokens", "outputTokens", "reasoningOutputTokens", "totalTokens"];
  if (countFields.some((field) => !integerBetween(value[field], 0, 100_000_000))) return false;
  if (!integerBetween(value.elapsedMs, 0, 86_400_000)) return false;
  if (value.photoCount < 1 || value.requestCount < 1) return false;
  return value.rateLimit === undefined || isRecord(value.rateLimit);
}

function isInventoryResults(value: unknown): value is InventoryResult[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 10) return false;
  let garmentCount = 0;
  for (const result of value) {
    if (!isRecord(result) || !Array.isArray(result.garments) || result.garments.length > 40) return false;
    garmentCount += result.garments.length;
    if (garmentCount > 120) return false;
    for (const garment of result.garments) {
      if (!isRecord(garment)) return false;
      if (!shortString(garment.candidate_key, 120) || !shortString(garment.name, 100)) return false;
      if (!shortString(garment.category, 24) || !categories.has(garment.category)) return false;
      if (!shortString(garment.type, 80) || !boundedString(garment.color, 80)) return false;
      if (!boundedString(garment.material, 80) || !boundedString(garment.description, 500)) return false;
      if (!integerBetween(garment.confidence, 0, 100)) return false;
      if (!shortString(garment.visibility, 16) || !visibilities.has(garment.visibility)) return false;
      if (!Array.isArray(garment.evidence) || garment.evidence.length < 1 || garment.evidence.length > 40) return false;
      for (const evidence of garment.evidence) {
        if (!isRecord(evidence) || !shortString(evidence.photo_id, 100) || !isRecord(evidence.bbox)) return false;
        if (!integerBetween(evidence.bbox.x, 0, 1000) || !integerBetween(evidence.bbox.y, 0, 1000)) return false;
        if (!integerBetween(evidence.bbox.width, 1, 1000) || !integerBetween(evidence.bbox.height, 1, 1000)) return false;
      }
    }
  }
  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function shortString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum;
}

function boundedString(value: unknown, maximum: number): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function integerBetween(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}

async function safeJson(request: Request): Promise<ExperimentalPayload | null> {
  try {
    return await request.json() as ExperimentalPayload;
  } catch {
    return null;
  }
}
