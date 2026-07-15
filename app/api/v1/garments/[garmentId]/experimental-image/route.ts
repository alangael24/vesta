import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, processingJobs } from "@/db/schema";
import { ChromaError, removeChroma } from "@/lib/chroma";
import { requireDevice } from "@/lib/device-auth";
import { chromaForGarment } from "@/lib/garment-background";
import { garmentCutoutKey, getMediaBucket } from "@/lib/storage";

type RouteContext = { params: Promise<{ garmentId: string }> };

const maximumImageBytes = 15 * 1024 * 1024;

export async function PUT(request: Request, context: RouteContext) {
  const identity = await requireDevice(request);
  if (identity instanceof Response) return identity;
  if (request.headers.get("content-type")?.toLowerCase() !== "image/png") {
    return Response.json({ error: "png_required" }, { status: 400 });
  }
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > maximumImageBytes) {
    return Response.json({ error: "generated_image_too_large" }, { status: 413 });
  }

  const { garmentId } = await context.params;
  const db = getDb();
  const [garment] = await db.select().from(garments).where(and(
    eq(garments.id, garmentId),
    eq(garments.ownerId, identity.ownerId),
  )).limit(1);
  if (!garment) return Response.json({ error: "garment_not_found" }, { status: 404 });

  const sourceBytes = new Uint8Array(await request.arrayBuffer());
  if (!sourceBytes.byteLength || sourceBytes.byteLength > maximumImageBytes) {
    return Response.json({ error: "invalid_generated_image" }, { status: 400 });
  }
  let cutout: ReturnType<typeof removeChroma>;
  try {
    cutout = removeChroma(sourceBytes, chromaForGarment(garment.color || "").rgb);
  } catch (error) {
    if (error instanceof ChromaError) {
      return Response.json({ error: error.code }, { status: 400 });
    }
    throw error;
  }
  const { png: cutoutPng, stats } = cutout;
  const backgroundWasRemoved = stats.transparentPixelRatio >= 10
    && stats.transparentPixelRatio <= 94
    && stats.foregroundPixelRatio >= 4;
  if (!backgroundWasRemoved) {
    return Response.json({ error: "generated_background_removal_failed" }, { status: 422 });
  }
  const key = garmentCutoutKey(identity.ownerId, garmentId);
  await getMediaBucket().put(key, cutoutPng, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId: identity.ownerId, garmentId, purpose: "subscription-generated-transparent-cutout" },
  });
  const now = new Date().toISOString();
  const garmentUpdate = db.update(garments).set({
      cutoutKey: key,
      reconstructionModel: "gpt-image-2",
      reconstructionQuality: "draft",
      cutoutWidth: stats.width,
      cutoutHeight: stats.height,
      transparentPixelRatio: stats.transparentPixelRatio,
      qaStatus: "pending",
      updatedAt: now,
    }).where(eq(garments.id, garmentId));
  if (garment.batchId) {
    await db.batch([garmentUpdate, db.insert(processingJobs).values({
      id: `job_${crypto.randomUUID()}`,
      ownerId: identity.ownerId,
      batchId: garment.batchId,
      garmentId,
      kind: "reconstruct",
      status: "completed",
      progress: 100,
      attempts: 1,
      model: "gpt-image-2",
      resultJson: JSON.stringify({
        provider: "chatgpt-codex-experimental",
        sourceBytes: sourceBytes.byteLength,
        outputBytes: cutoutPng.byteLength,
        transparentPixelRatio: stats.transparentPixelRatio,
        foregroundPixelRatio: stats.foregroundPixelRatio,
      }),
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      completedAt: now,
    })]);
  } else {
    await garmentUpdate;
  }
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
