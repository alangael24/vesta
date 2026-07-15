import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { garments, processingJobs } from "@/db/schema";
import { requireDevice } from "@/lib/device-auth";
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

  const bytes = await request.arrayBuffer();
  if (!bytes.byteLength || bytes.byteLength > maximumImageBytes) {
    return Response.json({ error: "invalid_generated_image" }, { status: 400 });
  }
  const key = garmentCutoutKey(identity.ownerId, garmentId);
  await getMediaBucket().put(key, bytes, {
    httpMetadata: { contentType: "image/png" },
    customMetadata: { ownerId: identity.ownerId, garmentId, purpose: "subscription-generated-catalog" },
  });
  const now = new Date().toISOString();
  const garmentUpdate = db.update(garments).set({
      cutoutKey: key,
      reconstructionModel: "gpt-image-2",
      reconstructionQuality: "draft",
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
      resultJson: JSON.stringify({ provider: "chatgpt-codex-experimental", outputBytes: bytes.byteLength }),
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
