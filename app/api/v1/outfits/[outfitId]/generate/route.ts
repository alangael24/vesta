import { waitUntil } from "cloudflare:workers";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outfitRenderJobs, outfits } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
import { recordConsumedUsage, requireUsageCapacity, SubscriptionUsageError } from "@/lib/subscription-usage-server";
import { generateVirtualTryOn, TryOnQuality, VirtualTryOnError } from "@/lib/virtual-try-on";

type RouteContext = { params: Promise<{ outfitId: string }> };

export async function GET(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { outfitId } = await context.params;
  const [job] = await getDb().select().from(outfitRenderJobs).where(and(
    eq(outfitRenderJobs.ownerId, identity.ownerId),
    eq(outfitRenderJobs.outfitId, outfitId),
  )).orderBy(desc(outfitRenderJobs.createdAt)).limit(1);
  if (!job) return Response.json({ status: "idle" }, { headers: privateHeaders() });
  return Response.json({
    requestId: job.id,
    status: job.status,
    error: job.errorCode,
    renderPath: job.resultPath,
  }, { headers: privateHeaders() });
}

export async function POST(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  const { outfitId } = await context.params;
  const body = await safeJson(request);
  const requestId = cleanRequestId(body?.requestId);
  const quality: TryOnQuality = body?.quality === "medium" ? "medium" : "low";
  if (!requestId) return failure("render_request_id_required", 400);

  const db = getDb();
  const [outfit] = await db.select({ id: outfits.id, status: outfits.status, renderKey: outfits.renderKey })
    .from(outfits).where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, identity.ownerId))).limit(1);
  if (!outfit) return failure("outfit_not_found", 404);

  const [requestCollision] = await db.select({ ownerId: outfitRenderJobs.ownerId }).from(outfitRenderJobs)
    .where(eq(outfitRenderJobs.id, requestId)).limit(1);
  if (requestCollision && requestCollision.ownerId !== identity.ownerId) return failure("render_request_conflict", 409);
  const [existingJob] = await db.select().from(outfitRenderJobs).where(and(
    eq(outfitRenderJobs.id, requestId),
    eq(outfitRenderJobs.ownerId, identity.ownerId),
    eq(outfitRenderJobs.outfitId, outfitId),
  )).limit(1);
  if (existingJob?.status === "completed" && existingJob.resultPath) {
    return Response.json({ status: "completed", renderPath: existingJob.resultPath }, { headers: privateHeaders() });
  }
  if (existingJob?.status === "running") {
    return Response.json({ status: "running", requestId }, { status: 202, headers: privateHeaders() });
  }
  if (outfit.renderKey && body?.force !== true) {
    return Response.json({ status: "completed", renderPath: `/api/v1/media/outfits/${outfitId}` }, { headers: privateHeaders() });
  }

  let entitlement;
  try {
    entitlement = await requireUsageCapacity(identity.ownerId, "look_generation", 1);
  } catch (error) {
    if (error instanceof SubscriptionUsageError) return failure(error.code, error.status, error.limit);
    throw error;
  }

  const now = new Date().toISOString();
  await db.insert(outfitRenderJobs).values({
    id: requestId,
    ownerId: identity.ownerId,
    outfitId,
    quality,
    status: "running",
    createdAt: now,
    updatedAt: now,
    startedAt: now,
  }).onConflictDoUpdate({
    target: outfitRenderJobs.id,
    set: { quality, status: "running", errorCode: null, resultPath: null, updatedAt: now, startedAt: now, completedAt: null },
  });
  await db.update(outfits).set({ status: "rendering", updatedAt: now })
    .where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, identity.ownerId)));

  waitUntil(runRenderJob(identity.ownerId, outfitId, requestId, quality, entitlement));
  return Response.json({ status: "running", requestId }, { status: 202, headers: privateHeaders() });
}

async function runRenderJob(
  ownerId: string,
  outfitId: string,
  requestId: string,
  quality: TryOnQuality,
  entitlement: Awaited<ReturnType<typeof requireUsageCapacity>>,
) {
  const db = getDb();
  try {
    const result = await generateVirtualTryOn(ownerId, outfitId, quality);
    await recordConsumedUsage(ownerId, "look_generation", 1, `look:${requestId}`, entitlement);
    const completedAt = new Date().toISOString();
    await db.update(outfitRenderJobs).set({
      status: "completed",
      resultPath: result.renderPath,
      errorCode: null,
      completedAt,
      updatedAt: completedAt,
    }).where(and(eq(outfitRenderJobs.id, requestId), eq(outfitRenderJobs.ownerId, ownerId)));
  } catch (error) {
    const code = error instanceof VirtualTryOnError ? error.code : "try_on_generation_failed";
    const failedAt = new Date().toISOString();
    await db.batch([
      db.update(outfitRenderJobs).set({ status: "failed", errorCode: code, updatedAt: failedAt })
        .where(and(eq(outfitRenderJobs.id, requestId), eq(outfitRenderJobs.ownerId, ownerId))),
      db.update(outfits).set({ status: "saved", updatedAt: failedAt })
        .where(and(eq(outfits.id, outfitId), eq(outfits.ownerId, ownerId))),
    ]);
  }
}

async function safeJson(request: Request) {
  try {
    return await request.json() as { requestId?: unknown; quality?: unknown; force?: unknown };
  } catch {
    return null;
  }
}

function cleanRequestId(value: unknown) {
  if (typeof value !== "string") return null;
  const cleaned = value.replace(/[^a-z0-9_-]/giu, "").slice(0, 120);
  return cleaned.length >= 8 ? cleaned : null;
}

function failure(error: string, status: number, limit?: number) {
  return Response.json({ error, limit }, { status, headers: privateHeaders() });
}

function privateHeaders() {
  return { "Cache-Control": "private, no-store" };
}
