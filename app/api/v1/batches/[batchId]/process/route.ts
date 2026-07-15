import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { importBatches, processingJobs, sourcePhotos } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { InventoryError, runInventory } from "@/lib/inventory";
import { getOpenAIKey } from "@/lib/openai";

type RouteContext = { params: Promise<{ batchId: string }> };
type ProcessingMode = "economy" | "quality";

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { batchId } = await context.params;
  const [batch] = await getDb().select({ id: importBatches.id, status: importBatches.status }).from(importBatches).where(and(
    eq(importBatches.id, batchId),
    eq(importBatches.ownerId, identity.ownerId),
  )).limit(1);
  if (!batch) return Response.json({ error: "batch_not_found" }, { status: 404 });
  return Response.json({
    configured: Boolean(getOpenAIKey()),
    batchStatus: batch.status,
    modes: [
      { id: "economy", label: "Económico", model: "gpt-4o-mini", detail: "high" },
      { id: "quality", label: "Máxima precisión", model: "gpt-5.6", detail: "original" },
    ],
    privacy: {
      trainsModelsByDefault: false,
      storeApplicationState: false,
      abuseMonitoringRetentionDays: 30,
      zeroDataRetentionMayReduceRetention: true,
    },
  }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { batchId } = await context.params;
  const payload = await safeJson(request);
  const mode: ProcessingMode | null = payload?.mode === "quality" ? "quality" : payload?.mode === "economy" ? "economy" : null;
  if (!mode || payload?.consent !== true || payload?.acknowledgesOpenAIRetention !== true) {
    return Response.json({ error: "explicit_processing_consent_required" }, { status: 400 });
  }
  if (!getOpenAIKey()) {
    return Response.json({ error: "processing_not_configured" }, { status: 503 });
  }

  const db = getDb();
  const [batch] = await db.select().from(importBatches).where(and(
    eq(importBatches.id, batchId),
    eq(importBatches.ownerId, identity.ownerId),
  )).limit(1);
  if (!batch) return Response.json({ error: "batch_not_found" }, { status: 404 });
  if (!inArrayStatus(batch.status, ["uploaded", "processing", "failed"])) {
    return Response.json({ error: "batch_not_ready" }, { status: 409 });
  }
  const [job] = await db.select().from(processingJobs).where(and(
    eq(processingJobs.batchId, batchId),
    eq(processingJobs.ownerId, identity.ownerId),
    eq(processingJobs.kind, "inventory"),
  )).limit(1);
  if (!job) return Response.json({ error: "inventory_job_not_found" }, { status: 409 });
  if (job.status === "running") return Response.json({ error: "inventory_already_running" }, { status: 409 });
  if (job.status === "completed") {
    return Response.json({ ok: true, status: "completed", garmentCount: parseGarmentCount(job.resultJson) });
  }

  const now = new Date().toISOString();
  const model = mode === "quality" ? "gpt-5.6" : "gpt-4o-mini";
  await db.batch([
    db.update(importBatches).set({ status: "processing", processingMode: mode, processingApprovedAt: now, updatedAt: now }).where(eq(importBatches.id, batchId)),
    db.update(processingJobs).set({ status: "running", progress: 5, attempts: job.attempts + 1, model, errorCode: null, errorMessage: null, startedAt: now, updatedAt: now }).where(eq(processingJobs.id, job.id)),
  ]);

  try {
    const photos = await db.select().from(sourcePhotos).where(and(
      eq(sourcePhotos.batchId, batchId),
      eq(sourcePhotos.ownerId, identity.ownerId),
      inArray(sourcePhotos.status, ["uploaded", "normalized", "analyzed"]),
    ));
    if (photos.length !== batch.photoCount) throw new InventoryError("photos_incomplete", "Not all source photos are available.");
    const result = await runInventory(identity.ownerId, batchId, photos, mode);
    const completedAt = new Date().toISOString();
    await db.batch([
      db.update(processingJobs).set({
        status: "completed",
        progress: 100,
        model: result.model,
        resultJson: JSON.stringify({ garmentCount: result.garmentCount, chunks: result.rawResults.length }),
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        completedAt,
        updatedAt: completedAt,
      }).where(eq(processingJobs.id, job.id)),
      db.update(importBatches).set({ status: "review", updatedAt: completedAt }).where(eq(importBatches.id, batchId)),
    ]);
    return Response.json({ ok: true, status: "review", garmentCount: result.garmentCount, inputTokens: result.inputTokens, outputTokens: result.outputTokens });
  } catch (error) {
    const failedAt = new Date().toISOString();
    const code = error instanceof InventoryError ? error.code : "inventory_failed";
    const message = error instanceof Error ? error.message.slice(0, 1000) : "Inventory processing failed.";
    await db.batch([
      db.update(processingJobs).set({ status: "failed", errorCode: code, errorMessage: message, updatedAt: failedAt }).where(eq(processingJobs.id, job.id)),
      db.update(importBatches).set({ status: "failed", updatedAt: failedAt }).where(eq(importBatches.id, batchId)),
    ]);
    return Response.json({ error: code }, { status: 502 });
  }
}

function inArrayStatus<T extends string>(value: string, values: readonly T[]): value is T {
  return values.includes(value as T);
}

function parseGarmentCount(value: string | null) {
  try { return Number(JSON.parse(value || "{}")?.garmentCount) || 0; } catch { return 0; }
}

async function safeJson(request: Request): Promise<{ mode?: string; consent?: boolean; acknowledgesOpenAIRetention?: boolean } | null> {
  try { return await request.json() as { mode?: string; consent?: boolean; acknowledgesOpenAIRetention?: boolean }; } catch { return null; }
}

